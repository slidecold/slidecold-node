import type { operations as Ops } from './generated/schema.js';
import type { OperationId } from './generated/operations.js';

export type { OperationId };

/** One row of the generated operations table. */
export interface OperationDef {
  operationId: string;
  /** SDK resource group, e.g. `campaigns`. */
  resource: string;
  /** SDK method name inside the resource, e.g. `stats`. */
  method: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  pathParams: string[];
  queryParams: { name: string; required: boolean; description?: string; schema?: Record<string, unknown> }[];
  body: null | {
    required: boolean;
    /** Accepts a JSON body. */
    json: boolean;
    /** Dereferenced JSON Schema of the JSON body. */
    schema: Record<string, unknown> | null;
    /** Form field name when the operation accepts multipart/form-data (e.g. `photo`). */
    multipartField: string | null;
  };
  /** Success response media types, e.g. `["application/json"]` or `["text/csv"]`. */
  responseTypes: string[];
  /** Required API key scope (`campaigns:write`). Some operations list alternatives with `|`. */
  scope: string;
  summary: string;
  description?: string;
}

/** Something that can be sent as a multipart file part. */
export type Uploadable = Blob | ArrayBuffer | ArrayBufferView;

type ContentOf<K extends OperationId> = NonNullable<Ops[K]['requestBody']> extends { content: infer C } ? C : never;
type JsonBodyOf<K extends OperationId> = ContentOf<K> extends { 'application/json': infer B } ? B : never;
type MultipartOf<K extends OperationId> = ContentOf<K> extends { 'multipart/form-data': infer M }
  ? { [P in keyof M]: Uploadable } | FormData
  : never;

/** Request body accepted by an operation (JSON object, or `{ field: Blob | Buffer }` / FormData for uploads). */
export type BodyOf<K extends OperationId> = JsonBodyOf<K> | MultipartOf<K>;

/** Query parameters accepted by an operation. */
export type QueryOf<K extends OperationId> = NonNullable<Ops[K]['parameters']['query']>;

type Ok<R> = R extends { 200: infer X } ? X : R extends { 201: infer X } ? X : R extends { 202: infer X } ? X : never;
type Payload<X> = X extends { content: infer C }
  ? (C extends { 'application/json': infer J } ? J : never) | (C extends { 'text/csv': unknown } ? string : never)
  : unknown;

/** Successful response of an operation. CSV responses are returned as a string. */
export type ResponseOf<K extends OperationId> = Payload<Ok<Ops[K]['responses']>>;

export interface RequestArgs {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface RequestOptions {
  /** Overrides the client timeout for this request. */
  timeoutMs?: number;
  /** Overrides the client retry count for this request (only GET/HEAD are retried). */
  maxRetries?: number;
  /** Aborts the request. */
  signal?: AbortSignal;
  /** Extra headers. */
  headers?: Record<string, string>;
}

export interface Requester {
  request<K extends OperationId>(operationId: K, args?: RequestArgs, options?: RequestOptions): Promise<ResponseOf<K>>;
}
