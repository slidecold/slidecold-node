export { SlideCold, VERSION, type ClientOptions, type LoginJobStatus } from './client.js';
export {
  SlideColdError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  APIError,
  APIConnectionError,
} from './errors.js';
export { verifyWebhookSignature } from './webhooks.js';
export { configPath, readConfig, writeConfig, deleteConfig, resolveConfig, DEFAULT_BASE_URL, type ConfigFile } from './config.js';
export { operations, type OperationId } from './generated/operations.js';
export * from './generated/resources.js';
export type { paths, components, operations as OperationTypes } from './generated/schema.js';
export type {
  BodyOf,
  QueryOf,
  ResponseOf,
  RequestArgs,
  RequestOptions,
  OperationDef,
  Uploadable,
  Requester,
} from './types.js';
