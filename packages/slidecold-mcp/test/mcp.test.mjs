import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mockServer } from '../../slidecold/test/mock-server.mjs';
import { toolName } from '../dist/index.js';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

test('toolName', () => {
  assert.equal(toolName('listCampaigns'), 'list_campaigns');
  assert.equal(toolName('verifyAccount2fa'), 'verify_account_2fa');
  assert.equal(toolName('getAccountsProxyHealth'), 'get_accounts_proxy_health');
});

test('stdio server lists and calls tools', async (t) => {
  const mock = await mockServer((req) => {
    if (req.url.includes('/missing')) return { status: 404, json: { error: 'Campaign not found' } };
    if (req.url.includes('/photo')) return { status: 202, json: { jobId: 'job_photo' } };
    return { json: [{ id: 'c1', name: 'Launch' }] };
  });
  t.after(() => mock.close());

  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: { PATH: process.env.PATH, SLIDECOLD_API_KEY: 'cs_mcp', SLIDECOLD_BASE_URL: mock.url, XDG_CONFIG_HOME: tmpdir() },
    }),
  );
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, 49);
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  assert.ok(byName.verify_account_2fa);

  const list = byName.list_campaigns;
  assert.match(list.description, /campaigns:read/);
  assert.deepEqual(list.annotations, { title: 'List campaigns', readOnlyHint: true, idempotentHint: true });
  assert.deepEqual(Object.keys(list.inputSchema.properties), ['folderId', 'archived']);
  assert.equal(byName.delete_campaign.annotations.destructiveHint, true);
  assert.equal(byName.send_conversation_reply.annotations.destructiveHint, true);
  assert.equal(byName.create_campaign.annotations.destructiveHint, false);
  assert.equal(byName.update_campaign.annotations.idempotentHint, true);
  assert.deepEqual(byName.get_campaign.inputSchema.required, ['id']);
  assert.deepEqual(byName.create_campaign.inputSchema.required, ['body']);
  assert.deepEqual(byName.send_conversation_photo.inputSchema.required, ['id', 'file_path']);
  assert.ok(byName.import_audience_members.inputSchema.properties.file_path);
  assert.deepEqual(byName.get_login_status.inputSchema.required, ['jobId']);

  const res = await client.callTool({ name: 'list_campaigns', arguments: { archived: 'true' } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), [{ id: 'c1', name: 'Launch' }]);
  assert.equal(mock.requests[0].url, '/api/v1/campaigns?archived=true');
  assert.equal(mock.requests[0].headers.authorization, 'Bearer cs_mcp');

  const err = await client.callTool({ name: 'get_campaign', arguments: { id: 'missing' } });
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /404: Campaign not found/);

  const photo = join(mkdtempSync(join(tmpdir(), 'sc-mcp-')), 'pic.jpg');
  writeFileSync(photo, 'JPEGDATA');
  const sent = await client.callTool({ name: 'send_conversation_photo', arguments: { id: 't1', file_path: photo } });
  assert.deepEqual(JSON.parse(sent.content[0].text), { jobId: 'job_photo' });
  const upload = mock.requests.at(-1);
  assert.match(upload.headers['content-type'], /^multipart\/form-data/);
  assert.match(upload.body, /name="photo"; filename="pic.jpg"[\s\S]*JPEGDATA/);
});
