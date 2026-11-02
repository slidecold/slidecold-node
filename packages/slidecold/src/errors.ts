/** Base class for every error thrown by the SlideCold SDK. */
export class SlideColdError extends Error {
  /** HTTP status, or `undefined` when the request never got a response. */
  readonly status: number | undefined;
  /** Parsed response body (`{ error: string, ... }` for API errors). */
  readonly body: unknown;
  /** Request id from the `x-request-id` header or body, when present. */
  readonly requestId: string | undefined;

  constructor(message: string, opts: { status?: number; body?: unknown; requestId?: string; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.status = opts.status;
    this.body = opts.body;
    this.requestId = opts.requestId;
  }
}

/** 401: missing or invalid API key. */
export class AuthenticationError extends SlideColdError {}
/** 403: the key lacks the required scope, the team member lacks access, or a plan limit was hit. */
export class PermissionError extends SlideColdError {}
/** 404: resource not found. */
export class NotFoundError extends SlideColdError {}
/** 429: rate limited. */
export class RateLimitError extends SlideColdError {}
/** Any other non-2xx response (400, 409, 5xx, ...). */
export class APIError extends SlideColdError {}
/** Network failure or timeout; no HTTP response was received. */
export class APIConnectionError extends SlideColdError {}

const KEY_HINT = 'Create an API key at https://slidecold.com/settings';

export function errorFromResponse(status: number, body: unknown, headers: Headers): SlideColdError {
  const apiMessage =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : typeof body === 'string' && body
        ? body
        : `HTTP ${status}`;
  const requestId =
    headers.get('x-request-id') ??
    (body && typeof body === 'object' && typeof (body as { requestId?: unknown }).requestId === 'string'
      ? (body as { requestId: string }).requestId
      : undefined);
  const opts = { status, body, requestId };
  if (status === 401) return new AuthenticationError(`${apiMessage}. ${KEY_HINT}`, opts);
  if (status === 403) return new PermissionError(apiMessage, opts);
  if (status === 404) return new NotFoundError(apiMessage, opts);
  if (status === 429) return new RateLimitError(apiMessage, opts);
  return new APIError(apiMessage, opts);
}

export const MISSING_KEY_MESSAGE = `No SlideCold API key found. Pass { apiKey }, set SLIDECOLD_API_KEY, or run \`slidecold login\`. ${KEY_HINT}`;
