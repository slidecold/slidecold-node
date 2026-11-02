import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { SlideCold, SlideColdError, operations, type OperationDef } from 'slidecold';

declare const __MCP_VERSION__: string;
export const VERSION: string = __MCP_VERSION__;

// Operations whose effect cannot be undone (a DM reaches a real person), on top of every DELETE.
const IRREVERSIBLE = new Set(['sendConversationReply', 'sendConversationPhoto']);

/** `listCampaigns` -> `list_campaigns`, `verifyAccount2fa` -> `verify_account_2fa`. */
export const toolName = (operationId: string) =>
  operationId.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/([a-zA-Z])(\d)/g, '$1_$2').toLowerCase();

export function toolFor(op: OperationDef): Tool {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const p of op.pathParams) {
    properties[p] = { type: 'string', description: `Path parameter \`${p}\`.` };
    required.push(p);
  }
  for (const q of op.queryParams) {
    properties[q.name] = { ...q.schema, ...(q.description ? { description: q.description } : {}) };
    if (q.required) required.push(q.name);
  }
  const field = op.body?.multipartField;
  if (op.body?.json) {
    properties.body = { ...op.body.schema, description: 'JSON request body.' };
    if (op.body.required && !field) required.push('body');
  }
  if (field) {
    properties.file_path = {
      type: 'string',
      description: `Path to a local file, uploaded as the multipart \`${field}\` field.${op.body?.json ? ' Use either this or `body`.' : ''}`,
    };
    if (!op.body?.json) required.push('file_path');
  }
  const isGet = op.httpMethod === 'GET';
  return {
    name: toolName(op.operationId),
    title: op.summary,
    description: [`${op.summary}.`, `Required API key scope: ${op.scope}.`, `${op.httpMethod} ${op.path}`, op.description]
      .filter(Boolean)
      .join('\n'),
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    annotations: {
      title: op.summary,
      readOnlyHint: isGet,
      ...(isGet
        ? {}
        : { destructiveHint: op.httpMethod === 'DELETE' || IRREVERSIBLE.has(op.operationId) }),
      idempotentHint: ['GET', 'PUT', 'PATCH', 'DELETE'].includes(op.httpMethod),
    },
  };
}

export const tools: Tool[] = (Object.values(operations) as OperationDef[]).map(toolFor);

async function callTool(client: SlideCold, op: OperationDef, args: Record<string, unknown>): Promise<CallToolResult> {
  const path: Record<string, string> = {};
  for (const p of op.pathParams) path[p] = String(args[p] ?? '');
  const query: Record<string, unknown> = {};
  for (const q of op.queryParams) if (args[q.name] !== undefined) query[q.name] = args[q.name];
  let body: unknown = args.body;
  const field = op.body?.multipartField;
  if (field && typeof args.file_path === 'string') {
    const form = new FormData();
    form.append(field, new Blob([new Uint8Array(await readFile(args.file_path))]), basename(args.file_path));
    body = form;
  } else if (field && !op.body?.json) {
    throw new SlideColdError('`file_path` is required');
  }
  const result: unknown = await client.request(op.operationId as never, { path, query, body });
  const text = typeof result === 'string' ? result : result === undefined ? 'OK' : JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text }] };
}

export interface ServerOptions {
  /** Client to use. By default one is created from SLIDECOLD_API_KEY / the config file on first call. */
  client?: SlideCold;
}

/** Creates the SlideCold MCP server (not yet connected to a transport). */
export function createServer(options: ServerOptions = {}): Server {
  // Low-level Server: tools come from the generated table as plain JSON Schema, which McpServer can't take.
  const server = new Server({ name: 'slidecold', version: VERSION }, { capabilities: { tools: {} } });
  const byName = new Map((Object.values(operations) as OperationDef[]).map((op) => [toolName(op.operationId), op]));
  let client = options.client;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const op = byName.get(req.params.name);
    if (!op) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] };
    try {
      client ??= new SlideCold();
      return await callTool(client, op, req.params.arguments ?? {});
    } catch (err) {
      const e = err as SlideColdError;
      const text = e.status ? `SlideCold API error ${e.status}: ${e.message}` : `Error: ${e.message ?? String(err)}`;
      return { isError: true, content: [{ type: 'text', text }] };
    }
  });
  return server;
}
