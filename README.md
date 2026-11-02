# SlideCold for Node.js

Official Node.js tools for the [SlideCold](https://slidecold.com) API (Instagram cold-DM outreach):

| Package | What it is |
| --- | --- |
| [`slidecold`](packages/slidecold) | Typed SDK and the `slidecold` CLI. Zero runtime dependencies. |
| [`slidecold-mcp`](packages/slidecold-mcp) | MCP server that gives Claude, Cursor and other MCP clients every API operation as a tool. |

Everything is generated from [`openapi.yaml`](openapi.yaml), so the SDK, CLI and MCP server always cover the same 49 operations. Node.js 18 or newer.

## Install

```sh
npm install slidecold          # SDK (+ CLI via npx slidecold)
npm install -g slidecold       # CLI on your PATH
```

Create an API key (`cs_...`) at <https://slidecold.com/settings>.

## SDK quickstart

```ts
import { SlideCold } from 'slidecold';

const client = new SlideCold(); // or new SlideCold({ apiKey: 'cs_...' })

const campaigns = await client.campaigns.list();
const stats = await client.campaigns.stats('cmp_123');

await client.audiences.create({ name: 'Coffee shops', sourceType: 'HASHTAG', sourceValue: 'coffee' });
await client.audiences.importMembers('aud_123', { usernames: ['alice', 'bob'] });
const csv: string = await client.audiences.export('aud_123');

const { jobId } = await client.accounts.create({ username: 'myshop', password: '...', proxyId: 'prx_1' });
const job = await client.waitForLoginJob(jobId, { intervalMs: 2000, timeoutMs: 120_000 });
if (job.state === 'failed') console.error(job.error);

await client.conversations.reply('conv_1', { message: 'Thanks!' });
await client.conversations.sendPhoto('conv_1', { photo: await fs.promises.readFile('pic.jpg') });
```

Methods are grouped by resource (`campaigns`, `audiences`, `conversations`, `accounts`, `proxies`, `folders`). Arguments are path ids first, then the request body, then optional query parameters, then per-request options (`{ timeoutMs, maxRetries, signal, headers }`). Every request and response is typed from the OpenAPI spec. Any operation can also be called by its `operationId`: `client.request('getCampaignStats', { path: { id } })`.

### Configuration

| Option | Default |
| --- | --- |
| `apiKey` | `SLIDECOLD_API_KEY`, then `apiKey` in the config file |
| `baseUrl` | `SLIDECOLD_BASE_URL`, then `baseUrl` in the config file, then `https://slidecold.com/api/v1` |
| `timeoutMs` | `30000` |
| `maxRetries` | `2` (GET only, on 429, 5xx and network errors, with exponential backoff) |

The config file is shared by the SDK, CLI and MCP server and is written by `slidecold login`:
`$XDG_CONFIG_HOME/slidecold/config.json` (default `~/.config/slidecold/config.json`), or `%APPDATA%\slidecold\config.json` on Windows.

```json
{ "apiKey": "cs_...", "baseUrl": "https://slidecold.com/api/v1" }
```

## CLI quickstart

```sh
slidecold login                                   # prompts for the key, validates it, saves it (0600)
slidecold campaigns list
slidecold campaigns list --archived true
slidecold campaigns stats cmp_123
slidecold campaigns update cmp_123 --name "Q4 push" --dailyLimit 40
slidecold campaigns create --data @campaign.json
slidecold accounts login-status --jobId job_1
slidecold audiences export aud_1 > members.csv
slidecold audiences import-members aud_1 --file members.csv
slidecold conversations send-photo conv_1 --file pic.jpg
slidecold conversations delete-message conv_1 msg_9
slidecold campaigns create --help                 # params, body fields, scope, endpoint
slidecold help
```

Shape: `slidecold <resource> <action> [ids...] [--param value ...] [--data '<json>' | --data @file.json] [--file path]`.
Path ids are positional; query parameters and top-level body fields are `--flags` (`--job-id` works too); `--data` is merged under the flags.
Output is pretty JSON on stdout (raw CSV for exports). Errors go to stderr with exit code 1. `--api-key` and `--base-url` override the environment and config file. `slidecold logout` deletes the config file.

## MCP server

`slidecold-mcp` is a stdio MCP server with one tool per operation (49 tools, e.g. `list_campaigns`, `get_campaign_stats`, `send_conversation_reply`). Tool descriptions include the required scope; read-only, destructive and idempotent operations are annotated. Uploads take a local `file_path`. It reads the API key the same way as the SDK (`SLIDECOLD_API_KEY`, then the config file from `slidecold login`).

**Claude Code**

```sh
claude mcp add slidecold -e SLIDECOLD_API_KEY=cs_... -- npx -y slidecold-mcp
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "slidecold": {
      "command": "npx",
      "args": ["-y", "slidecold-mcp"],
      "env": { "SLIDECOLD_API_KEY": "cs_..." }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project): the same `mcpServers` JSON as Claude Desktop.

Give the MCP server a key with only the scopes you want an assistant to have. A read-only key (`*:read`) is a good start.

## Scopes

Each API key carries scopes `<resource>:<read|write>` for `accounts`, `audiences`, `campaigns` and `conversations`; `:write` also grants `:read`. Proxies use the `accounts` scopes; folders use the scope of their folder type. Each SDK method's doc comment, `slidecold <resource> <action> --help` and each MCP tool description show the scope it needs. A missing scope returns 403 (`PermissionError`) with a message such as `This API key is missing the campaigns:write scope`.

## Error handling

```ts
import { SlideCold, AuthenticationError, PermissionError, NotFoundError, RateLimitError, APIError, SlideColdError } from 'slidecold';

try {
  await client.campaigns.create(body);
} catch (err) {
  if (err instanceof AuthenticationError) { /* 401: bad key */ }
  else if (err instanceof PermissionError) { /* 403: missing scope or plan limit */ }
  else if (err instanceof NotFoundError) { /* 404 */ }
  else if (err instanceof RateLimitError) { /* 429 */ }
  else if (err instanceof APIError) { /* other 4xx/5xx, e.g. 400 validation */ }
  if (err instanceof SlideColdError) console.error(err.status, err.message, err.body, err.requestId);
}
```

`err.message` is the API's `error` field. Network failures and timeouts throw `APIConnectionError` (no `status`). Only GET requests are retried, so a failed POST is never sent twice.

## Webhook verification

SlideCold signs each webhook with `X-SlideCold-Signature`: the hex HMAC-SHA256 of the raw JSON body, keyed with the endpoint secret (`whsec_...`). Verify it against the raw body, before parsing:

```ts
import express from 'express';
import { verifyWebhookSignature } from 'slidecold';

app.post('/webhooks/slidecold', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifyWebhookSignature(req.body, req.get('X-SlideCold-Signature'), process.env.SLIDECOLD_WEBHOOK_SECRET!)) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body.toString('utf8'));
  res.sendStatus(200);
});
```

The comparison is constant time.

## Development

```sh
npm ci
npm run generate   # regenerate packages/slidecold/src/generated from openapi.yaml
npm run build
npm run typecheck
npm test
```

Generated code is committed; CI fails if it is stale. Releases are cut by pushing a `vX.Y.Z` tag after bumping both package versions (and `slidecold-mcp`'s dependency on `slidecold`) together.

## License

MIT
