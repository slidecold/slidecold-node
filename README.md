# slidecold

Official Node.js SDK for the [SlideCold](https://slidecold.com) API (Instagram cold-DM outreach). Every request and response is typed from [`openapi.yaml`](openapi.yaml), covering all 49 operations. Zero runtime dependencies, Node.js 18 or newer.

Looking for something else?

- **CLI**: [slidecold/slidecold-cli](https://github.com/slidecold/slidecold-cli) (`slidecold login`, `slidecold campaigns list`, ...)
- **MCP server** for Claude, Cursor and other MCP clients: [slidecold/slidecold-mcp](https://github.com/slidecold/slidecold-mcp)

## Install

```sh
npm install slidecold
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

The config file is shared with the [SlideCold CLI](https://github.com/slidecold/slidecold-cli) and the [MCP server](https://github.com/slidecold/slidecold-mcp), and is written by the CLI's `slidecold login`:
`$XDG_CONFIG_HOME/slidecold/config.json` (default `~/.config/slidecold/config.json`), or `%APPDATA%\slidecold\config.json` on Windows.

```json
{ "apiKey": "cs_...", "baseUrl": "https://slidecold.com/api/v1" }
```

## Scopes

Each API key carries scopes `<resource>:<read|write>` for `accounts`, `audiences`, `campaigns` and `conversations`; `:write` also grants `:read`. Proxies use the `accounts` scopes; folders use the scope of their folder type. Each SDK method's doc comment shows the scope it needs. A missing scope returns 403 (`PermissionError`) with a message such as `This API key is missing the campaigns:write scope`.

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
npm run generate   # regenerate src/generated from openapi.yaml
npm run build
npm run typecheck
npm test
```

Generated code is committed; CI fails if it is stale. Releases are cut by bumping `version` in `package.json`, adding a CHANGELOG entry and pushing a matching `vX.Y.Z` tag; CI tests, publishes to npm with provenance and creates the GitHub release.

## License

MIT
