import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv, buildCall, findOperation } from '../dist/cli-core.js';
import { mockServer } from './mock-server.mjs';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
    child.stdin.end();
  });
}

const call = (argv) => buildCall(findOperation(argv[0], argv[1]), parseArgv(argv));

test('parseArgv splits positionals and flags', () => {
  assert.deepEqual(parseArgv(['campaigns', 'get', 'c1', '--x', 'y', '--a=b=c', '--help', 'z', '--', '--raw']), {
    positionals: ['campaigns', 'get', 'c1', 'z', '--raw'],
    flags: { x: 'y', a: 'b=c', help: true },
  });
  assert.deepEqual(parseArgv(['-h']).flags, { help: true });
});

test('buildCall maps ids, query, body fields and --data', () => {
  assert.deepEqual(call(['campaigns', 'stats', 'c1']).path, { id: 'c1' });
  assert.deepEqual(call(['conversations', 'delete-message', 't1', 'm1']).path, { id: 't1', messageId: 'm1' });
  assert.deepEqual(call(['accounts', 'login-status', '--jobId', 'j1']).query, { jobId: 'j1' });
  assert.deepEqual(call(['accounts', 'login-status', '--job-id', 'j1']).query, { jobId: 'j1' });
  assert.deepEqual(call(['campaigns', 'list', '--archived', 'true']).query, { archived: 'true' });

  const update = call(['campaigns', 'update', 'c1', '--name', '123', '--dailyLimit', '40']);
  assert.deepEqual(update.body, { name: '123', dailyLimit: 40 });

  const merged = call(['campaigns', 'update', 'c1', '--data', '{"name":"a","startHour":9}', '--name', 'b']);
  assert.deepEqual(merged.body, { name: 'b', startHour: 9 });

  const dir = mkdtempSync(join(tmpdir(), 'slidecold-cli-'));
  writeFileSync(join(dir, 'b.json'), '{"usernames":["x"]}');
  assert.deepEqual(call(['audiences', 'import-members', 'a1', '--data', `@${join(dir, 'b.json')}`]).body, { usernames: ['x'] });
  assert.equal(call(['conversations', 'send-photo', 't1', '--file', 'p.jpg']).file, 'p.jpg');
});

test('buildCall rejects bad input', () => {
  assert.throws(() => call(['campaigns', 'stats']), /Missing <id>/);
  assert.throws(() => call(['campaigns', 'stats', 'a', 'b']), /Too many arguments/);
  assert.throws(() => call(['accounts', 'login-status']), /Missing --jobId/);
  assert.throws(() => call(['campaigns', 'stats', 'c1', '--bogus', '1']), /Unknown option --bogus/);
  assert.throws(() => call(['campaigns', 'list', '--file', 'x']), /does not accept --file/);
});

test('end to end against a mock API', async (t) => {
  const mock = await mockServer((req) => {
    if (req.url.includes('/export')) return { csv: 'username\nalice\n' };
    if (req.url.includes('/missing')) return { status: 404, json: { error: 'Campaign not found' } };
    if (req.method === 'PATCH') return { status: 403, json: { error: 'This API key is missing the campaigns:write scope' } };
    return { json: [{ id: 'c1', name: 'Launch' }] };
  });
  t.after(() => mock.close());
  const env = { SLIDECOLD_API_KEY: 'cs_cli', SLIDECOLD_BASE_URL: mock.url, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'sc-')) };

  const ok = await runCli(['campaigns', 'list', '--archived', 'true'], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), [{ id: 'c1', name: 'Launch' }]);
  assert.equal(mock.requests[0].url, '/api/v1/campaigns?archived=true');
  assert.equal(mock.requests[0].headers.authorization, 'Bearer cs_cli');

  const csv = await runCli(['audiences', 'export', 'a1'], env);
  assert.equal(csv.stdout, 'username\nalice\n');

  const denied = await runCli(['campaigns', 'update', 'c1', '--name', 'x'], env);
  assert.equal(denied.code, 1);
  assert.equal(denied.stdout, '');
  assert.match(denied.stderr, /Error \(403\): This API key is missing the campaigns:write scope/);

  const overridden = await runCli(['campaigns', 'get', 'missing', '--api-key', 'cs_flag', '--base-url', mock.url], {
    ...env,
    SLIDECOLD_BASE_URL: 'http://127.0.0.1:1',
  });
  assert.equal(overridden.code, 1);
  assert.match(overridden.stderr, /Campaign not found/);
  assert.equal(mock.requests.at(-1).headers.authorization, 'Bearer cs_flag');

  const help = await runCli(['campaigns', 'stats', '--help'], env);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Scope: +campaigns:read/);
  assert.match((await runCli(['--help'], env)).stdout, /slidecold <resource> <action>/);
  assert.equal((await runCli(['nope'], env)).code, 1);
});

test('login validates the key and writes a 0600 config; logout removes it', async (t) => {
  const mock = await mockServer((req) =>
    req.headers.authorization === 'Bearer cs_bad'
      ? { status: 401, json: { error: 'Invalid API key' } }
      : { status: 403, json: { error: 'This API key is missing the accounts:read scope' } },
  );
  t.after(() => mock.close());
  const xdg = mkdtempSync(join(tmpdir(), 'sc-login-'));
  const file = join(xdg, 'slidecold', 'config.json');
  const env = { XDG_CONFIG_HOME: xdg };

  const bad = await runCli(['login', '--key', 'cs_bad', '--base-url', mock.url], env);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Invalid API key/);
  assert.equal(existsSync(file), false);

  const good = await runCli(['login', '--key', 'cs_scoped', '--base-url', mock.url], env);
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /valid but scoped/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { apiKey: 'cs_scoped', baseUrl: mock.url });
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);

  assert.equal((await runCli(['logout'], env)).code, 0);
  assert.equal(existsSync(file), false);
});
