import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  SlideCold,
  SlideColdError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  APIError,
  APIConnectionError,
  verifyWebhookSignature,
  configPath,
  operations,
  VERSION,
} from '../dist/index.js';
import { mockServer } from './mock-server.mjs';

const pkg = createRequire(import.meta.url)('../package.json');

async function withMock(handler, fn) {
  const mock = await mockServer(handler);
  try {
    await fn(mock, new SlideCold({ apiKey: 'cs_test', baseUrl: mock.url, maxRetries: 2 }));
  } finally {
    await mock.close();
  }
}

test('operations table covers the whole spec', () => {
  assert.equal(Object.keys(operations).length, 49);
});

test('sends auth, user agent, path and query', () =>
  withMock(
    () => ({ json: [{ id: 'c1' }] }),
    async (mock, client) => {
      const res = await client.campaigns.list({ archived: 'true', folderId: 'root' });
      assert.deepEqual(res, [{ id: 'c1' }]);
      const [req] = mock.requests;
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/api/v1/campaigns?archived=true&folderId=root');
      assert.equal(req.headers.authorization, 'Bearer cs_test');
      assert.equal(req.headers['user-agent'], `slidecold-node/${pkg.version}`);
      assert.equal(VERSION, pkg.version);
    },
  ));

test('path params, required query params, JSON bodies and CSV', () =>
  withMock(
    (req) => (req.url.endsWith('/export') ? { csv: 'username\nalice\n' } : { status: 201, json: { ok: true } }),
    async (mock, client) => {
      await client.campaigns.stats('c/1');
      await client.accounts.loginStatus('job1');
      await client.campaigns.update('c1', { name: 'New' });
      await client.conversations.deleteMessage('t1', 'm1');
      assert.equal(await client.audiences.export('a1'), 'username\nalice\n');
      const [stats, login, update, del] = mock.requests;
      assert.equal(stats.url, '/api/v1/campaigns/c%2F1/stats');
      assert.equal(login.url, '/api/v1/accounts/login-status?jobId=job1');
      assert.equal(update.method, 'PATCH');
      assert.equal(update.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(update.body), { name: 'New' });
      assert.equal(del.method, 'DELETE');
      assert.equal(del.url, '/api/v1/conversations/t1/messages/m1');
    },
  ));

test('multipart uploads', () =>
  withMock(
    () => ({ status: 202, json: { jobId: 'j1' } }),
    async (mock, client) => {
      assert.deepEqual(await client.conversations.sendPhoto('t1', { photo: new Uint8Array([1, 2, 3]) }), { jobId: 'j1' });
      await client.audiences.importMembers('a1', { file: Buffer.from('username\nbob\n') });
      await client.audiences.importMembers('a1', { usernames: ['bob'] });
      const [photo, csv, json] = mock.requests;
      assert.match(photo.headers['content-type'], /^multipart\/form-data/);
      assert.match(photo.body, /name="photo"/);
      assert.match(csv.body, /name="file"[\s\S]*username\nbob/);
      assert.equal(json.headers['content-type'], 'application/json');
    },
  ));

test('maps error statuses to error classes', async () => {
  const cases = [
    [401, AuthenticationError, { error: 'Invalid API key' }],
    [403, PermissionError, { error: 'This API key is missing the campaigns:write scope' }],
    [404, NotFoundError, { error: 'Not found' }],
    [429, RateLimitError, { error: 'Slow down' }],
    [400, APIError, { error: 'name: Required' }],
    [500, APIError, { error: 'boom' }],
  ];
  for (const [status, Cls, json] of cases) {
    await withMock(
      () => ({ status, json, headers: { 'x-request-id': 'req_1' } }),
      async (_mock, client) => {
        const err = await client.campaigns.create({}, { maxRetries: 0 }).catch((e) => e);
        assert.ok(err instanceof Cls, `${status} -> ${Cls.name}`);
        assert.ok(err instanceof SlideColdError);
        assert.equal(err.status, status);
        assert.deepEqual(err.body, json);
        assert.equal(err.requestId, 'req_1');
        assert.ok(err.message.startsWith(json.error));
        if (status === 401) assert.match(err.message, /https:\/\/slidecold\.com\/settings/);
      },
    );
  }
});

test('retries GET on 5xx/429 with backoff', () =>
  withMock(
    (_req, n) => (n === 1 ? { status: 503, json: { error: 'down' } } : n === 2 ? { status: 429, json: {} } : { json: [] }),
    async (mock, client) => {
      assert.deepEqual(await client.audiences.list(), []);
      assert.equal(mock.requests.length, 3);
    },
  ));

test('gives up after maxRetries', () =>
  withMock(
    () => ({ status: 502, json: { error: 'bad gateway' } }),
    async (mock, client) => {
      const err = await client.audiences.list().catch((e) => e);
      assert.ok(err instanceof APIError);
      assert.equal(err.message, 'bad gateway');
      assert.equal(mock.requests.length, 3);
    },
  ));

test('does not retry non-GET requests', () =>
  withMock(
    () => ({ status: 503, json: { error: 'down' } }),
    async (mock, client) => {
      await assert.rejects(client.audiences.create({ name: 'x', sourceType: 'FOLLOWERS', sourceValue: 'y' }), APIError);
      assert.equal(mock.requests.length, 1);
    },
  ));

test('retries GET on network errors', () =>
  withMock(
    (_req, n) => (n === 1 ? { destroy: true } : { json: { ok: 1 } }),
    async (mock, client) => {
      assert.deepEqual(await client.proxies.list(), { ok: 1 });
      assert.equal(mock.requests.length, 2);
    },
  ));

test('times out', () =>
  withMock(
    () => ({ delayMs: 300, json: {} }),
    async (_mock, client) => {
      const err = await client.proxies.list({ timeoutMs: 50, maxRetries: 0 }).catch((e) => e);
      assert.ok(err instanceof APIConnectionError);
      assert.match(err.message, /timed out/);
    },
  ));

test('waitForLoginJob polls until completed', () =>
  withMock(
    (_req, n) => ({ json: n < 3 ? { state: 'active' } : { state: 'completed', result: { id: 'acc1' } } }),
    async (mock, client) => {
      const res = await client.waitForLoginJob('j1', { intervalMs: 5 });
      assert.equal(res.state, 'completed');
      assert.equal(mock.requests.length, 3);
      assert.ok(mock.requests.every((r) => r.url === '/api/v1/accounts/login-status?jobId=j1'));
    },
  ));

test('waitForLoginJob returns failed jobs and times out', () =>
  withMock(
    (req) => ({ json: { state: req.url.includes('bad') ? 'failed' : 'waiting', error: 'challenge' } }),
    async (_mock, client) => {
      assert.equal((await client.waitForLoginJob('bad', { intervalMs: 5 })).state, 'failed');
      await assert.rejects(client.waitForLoginJob('slow', { intervalMs: 5, timeoutMs: 30 }), /did not finish/);
    },
  ));

test('config resolution: option > env > config file > default', async (t) => {
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  const mock = await mockServer((req) => ({ json: { auth: req.headers.authorization } }));
  t.after(() => mock.close());
  const xdg = mkdtempSync(join(tmpdir(), 'slidecold-test-'));
  delete process.env.SLIDECOLD_API_KEY;
  delete process.env.SLIDECOLD_BASE_URL;
  process.env.XDG_CONFIG_HOME = xdg;
  if (process.platform !== 'win32') assert.equal(configPath(), join(xdg, 'slidecold', 'config.json'));

  assert.throws(() => new SlideCold(), (e) => e instanceof SlideColdError && /SLIDECOLD_API_KEY/.test(e.message));
  assert.equal(new SlideCold({ apiKey: 'cs_x' }).baseUrl, 'https://slidecold.com/api/v1');

  mkdirSync(join(xdg, 'slidecold'), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ apiKey: 'cs_file', baseUrl: mock.url }));
  const auth = async (c) => (await c.proxies.list()).auth;
  assert.equal(await auth(new SlideCold()), 'Bearer cs_file');
  assert.equal(new SlideCold().baseUrl, mock.url);

  process.env.SLIDECOLD_API_KEY = 'cs_env';
  assert.equal(await auth(new SlideCold()), 'Bearer cs_env');
  assert.equal(await auth(new SlideCold({ apiKey: 'cs_opt' })), 'Bearer cs_opt');

  process.env.SLIDECOLD_BASE_URL = 'http://env.example/api/v1/';
  assert.equal(new SlideCold().baseUrl, 'http://env.example/api/v1');
  assert.equal(new SlideCold({ baseUrl: 'http://opt.example' }).baseUrl, 'http://opt.example');
});

test('verifyWebhookSignature', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'lead.imported', data: { id: 'l1' } });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, sig, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from(body), sig.toUpperCase(), secret), true);
  assert.equal(verifyWebhookSignature(body, sig, 'whsec_other'), false);
  assert.equal(verifyWebhookSignature(body + ' ', sig, secret), false);
  assert.equal(verifyWebhookSignature(body, sig.slice(0, -2), secret), false);
  assert.equal(verifyWebhookSignature(body, 'z'.repeat(64), secret), false);
  assert.equal(verifyWebhookSignature(body, '', secret), false);
  assert.equal(verifyWebhookSignature(body, undefined, secret), false);
});

test('CommonJS build loads', () => {
  const cjs = createRequire(import.meta.url)('../dist/index.cjs');
  assert.equal(typeof cjs.SlideCold, 'function');
  assert.equal(typeof cjs.verifyWebhookSignature, 'function');
});
