// Local HTTP server standing in for the SlideCold API in tests.
import http from 'node:http';

/**
 * handler(req, n) returns { status?, json?, csv?, headers?, destroy?, delayMs? } for the n-th request (1-based).
 * Every request is recorded in `requests` as { method, url, headers, body }.
 */
export async function mockServer(handler = () => ({ json: {} })) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rec = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') };
    requests.push(rec);
    const out = (await handler(rec, requests.length)) ?? { json: {} };
    if (out.destroy) return req.socket.destroy();
    if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
    const isCsv = out.csv !== undefined;
    res.writeHead(out.status ?? 200, { 'content-type': isCsv ? 'text/csv' : 'application/json', ...out.headers });
    res.end(isCsv ? out.csv : JSON.stringify(out.json ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}
