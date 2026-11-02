import { resolveConfig } from './config.js';
import { APIConnectionError, MISSING_KEY_MESSAGE, SlideColdError, errorFromResponse } from './errors.js';
import { operations, type OperationId } from './generated/operations.js';
import { ResourceClient } from './generated/resources.js';
import type { OperationDef, RequestArgs, RequestOptions, ResponseOf, Uploadable } from './types.js';

declare const __SDK_VERSION__: string;
export const VERSION: string = __SDK_VERSION__;

export interface ClientOptions {
  /** API key (`cs_...`). Defaults to `SLIDECOLD_API_KEY`, then the config file written by `slidecold login`. */
  apiKey?: string;
  /** Defaults to `SLIDECOLD_BASE_URL`, then the config file, then `https://slidecold.com/api/v1`. */
  baseUrl?: string;
  /** Per-request timeout. Default 30000. */
  timeoutMs?: number;
  /** Retries for GET requests on 429, 5xx and network errors. Default 2. */
  maxRetries?: number;
}

export type LoginJobStatus = ResponseOf<'getLoginStatus'>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isUploadable = (v: unknown): v is Uploadable =>
  v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v);
const toBlob = (v: Uploadable) => (v instanceof Blob ? v : new Blob([v as ArrayBuffer]));

function encodeBody(op: OperationDef, body: unknown): { body?: BodyInit; contentType?: string } {
  if (body === undefined) return {};
  if (body instanceof FormData) return { body };
  const field = op.body?.multipartField;
  if (field && body && typeof body === 'object' && isUploadable((body as Record<string, unknown>)[field])) {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (isUploadable(v)) form.append(k, toBlob(v), k);
      else if (v !== undefined) form.append(k, String(v));
    }
    return { body: form };
  }
  return { body: JSON.stringify(body), contentType: 'application/json' };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * SlideCold API client.
 *
 * ```ts
 * const client = new SlideCold(); // reads SLIDECOLD_API_KEY or ~/.config/slidecold/config.json
 * const campaigns = await client.campaigns.list();
 * ```
 */
export class SlideCold extends ResourceClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly #apiKey: string;

  constructor(options: ClientOptions = {}) {
    super();
    const { apiKey, baseUrl } = resolveConfig(options);
    if (!apiKey) throw new SlideColdError(MISSING_KEY_MESSAGE);
    this.#apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  /** Calls any operation by its `operationId`. The resource methods (`client.campaigns.list()`) wrap this. */
  async request<K extends OperationId>(
    operationId: K,
    args: RequestArgs = {},
    options: RequestOptions = {},
  ): Promise<ResponseOf<K>> {
    const op: OperationDef | undefined = operations[operationId];
    if (!op) throw new SlideColdError(`Unknown operation "${operationId}"`);

    const path = op.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = args.path?.[name];
      if (value === undefined || value === null || value === '') {
        throw new SlideColdError(`Missing path parameter "${name}" for ${operationId}`);
      }
      return encodeURIComponent(String(value));
    });
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(args.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const { body, contentType } = encodeBody(op, args.body);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      'User-Agent': `slidecold-node/${VERSION}`,
      Accept: op.responseTypes.length ? op.responseTypes.join(', ') : 'application/json',
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...options.headers,
    };
    const retryable = op.httpMethod === 'GET';
    const maxRetries = retryable ? (options.maxRetries ?? this.maxRetries) : 0;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const backoff = 500 * 2 ** attempt;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      let res: Response;
      try {
        res = await fetch(url, { method: op.httpMethod, headers, body, signal: controller.signal });
      } catch (err) {
        if (options.signal?.aborted) throw err;
        if (attempt < maxRetries) {
          await sleep(backoff);
          continue;
        }
        const message = controller.signal.aborted
          ? `Request timed out after ${timeoutMs}ms`
          : `Connection error: ${(err as Error).message}`;
        throw new APIConnectionError(message, { cause: err });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }

      const data = await readBody(res);
      if (res.ok) return data as ResponseOf<K>;
      if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : backoff);
        continue;
      }
      throw errorFromResponse(res.status, data, res.headers);
    }
  }

  /**
   * Polls `getLoginStatus` until the job is `completed` or `failed` and returns the final status.
   * Throws a `SlideColdError` if it does not finish within `timeoutMs` (default 120s).
   */
  async waitForLoginJob(
    jobId: string,
    { intervalMs = 2000, timeoutMs = 120_000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<LoginJobStatus> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await this.accounts.loginStatus(jobId);
      if (status.state === 'completed' || status.state === 'failed') return status;
      if (Date.now() + intervalMs > deadline) {
        throw new SlideColdError(`Login job ${jobId} did not finish within ${timeoutMs}ms (last state: ${status.state})`);
      }
      await sleep(intervalMs);
    }
  }
}
