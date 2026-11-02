# slidecold

Official Node.js SDK and CLI for the [SlideCold](https://slidecold.com) API. Typed from the OpenAPI spec, zero runtime dependencies, Node.js 18+.

```sh
npm install slidecold
```

Create an API key (`cs_...`) at <https://slidecold.com/settings>.

## SDK

```ts
import { SlideCold, PermissionError, verifyWebhookSignature } from 'slidecold';

const client = new SlideCold(); // SLIDECOLD_API_KEY, or the config file from `slidecold login`

const campaigns = await client.campaigns.list();
const stats = await client.campaigns.stats('cmp_123');
const csv = await client.audiences.export('aud_123'); // string
const { jobId } = await client.accounts.create({ username: 'myshop', password: '...', proxyId: 'prx_1' });
const job = await client.waitForLoginJob(jobId);
```

Errors are `SlideColdError` subclasses: `AuthenticationError` (401), `PermissionError` (403, missing scope or plan limit), `NotFoundError` (404), `RateLimitError` (429), `APIError` (other), `APIConnectionError` (network/timeout). GET requests are retried twice with backoff; the default timeout is 30 s.

`verifyWebhookSignature(rawBody, req.headers['x-slidecold-signature'], 'whsec_...')` checks webhook signatures in constant time.

## CLI

```sh
npx slidecold login
npx slidecold campaigns list --archived true
npx slidecold campaigns stats cmp_123
npx slidecold campaigns create --data @campaign.json
npx slidecold audiences export aud_1 > members.csv
npx slidecold conversations send-photo conv_1 --file pic.jpg
npx slidecold campaigns create --help
```

Full docs, scopes, and the MCP server: <https://github.com/slidecold/slidecold-node>.

## License

MIT
