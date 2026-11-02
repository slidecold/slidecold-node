import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { SlideCold, VERSION } from './client.js';
import { configPath, deleteConfig, readConfig, writeConfig } from './config.js';
import { AuthenticationError, PermissionError, SlideColdError } from './errors.js';
import { operations } from './generated/operations.js';
import type { OperationDef } from './types.js';

const GLOBAL_FLAGS = new Set(['data', 'file', 'api-key', 'base-url', 'help', 'key', 'version']);
const BOOLEAN_FLAGS = new Set(['help', 'version']);

export const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const allOps = Object.values(operations) as OperationDef[];
const resources = [...new Set(allOps.map((o) => o.resource))];
export const findOperation = (resource: string, action: string) =>
  allOps.find((o) => kebab(o.resource) === resource && kebab(o.method) === action);

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Splits argv into positionals and `--flag value` / `--flag=value` pairs. */
export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) flags[key] = a.slice(eq + 1);
      else if (!BOOLEAN_FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) flags[key] = argv[++i]!;
      else flags[key] = true;
    } else positionals.push(a);
  }
  return { positionals, flags };
}

export interface OperationCall {
  op: OperationDef;
  path: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  /** Local file to upload as the operation's multipart field. */
  file?: string;
}

const readData = (value: string) => JSON.parse(value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value);

function coerce(value: string, schema: unknown): unknown {
  const type = (schema as { type?: unknown } | undefined)?.type;
  if (type === 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Maps `<resource> <action> [ids...] --flags` onto an operation's path, query and body. */
export function buildCall(op: OperationDef, args: ParsedArgs): OperationCall {
  const ids = args.positionals.slice(2);
  if (ids.length > op.pathParams.length) throw new SlideColdError(`Too many arguments. Usage: ${usage(op)}`);
  const call: OperationCall = { op, path: {}, query: {} };
  op.pathParams.forEach((p, i) => {
    if (ids[i] !== undefined) call.path[p] = ids[i]!;
  });
  let body: Record<string, unknown> | undefined;
  const properties = (op.body?.schema?.properties ?? {}) as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(args.flags)) {
    if (GLOBAL_FLAGS.has(rawKey)) continue;
    const key = camel(rawKey);
    if (value === true) throw new SlideColdError(`Option --${rawKey} needs a value`);
    if (op.pathParams.includes(key)) call.path[key] = value;
    else if (op.queryParams.some((q) => q.name === key)) call.query[key] = value;
    else if (op.body?.json) (body ??= {})[key] = coerce(value, properties[key]);
    else throw new SlideColdError(`Unknown option --${rawKey}. Usage: ${usage(op)}`);
  }
  for (const p of op.pathParams) if (!call.path[p]) throw new SlideColdError(`Missing <${p}>. Usage: ${usage(op)}`);
  for (const q of op.queryParams) {
    if (q.required && !call.query[q.name]) throw new SlideColdError(`Missing --${q.name}. Usage: ${usage(op)}`);
  }
  if (typeof args.flags.data === 'string') {
    const data = readData(args.flags.data);
    call.body = body && data && typeof data === 'object' && !Array.isArray(data) ? { ...data, ...body } : data;
  } else if (body) call.body = body;
  if (typeof args.flags.file === 'string') {
    if (!op.body?.multipartField) throw new SlideColdError(`${kebab(op.resource)} ${kebab(op.method)} does not accept --file`);
    call.file = args.flags.file;
  }
  return call;
}

function usage(op: OperationDef): string {
  const parts = ['slidecold', kebab(op.resource), kebab(op.method), ...op.pathParams.map((p) => `<${p}>`)];
  for (const q of op.queryParams) parts.push(q.required ? `--${q.name} <value>` : `[--${q.name} <value>]`);
  if (op.body?.json) parts.push(op.body.required ? "--data '<json>'" : "[--data '<json>']");
  if (op.body?.multipartField) parts.push(op.body.json ? '[--file <path>]' : '--file <path>');
  return parts.join(' ');
}

const describeSchema = (s: Record<string, unknown> | undefined) => {
  if (!s) return '';
  if (Array.isArray(s.enum)) return s.enum.join('|');
  const t = Array.isArray(s.type) ? s.type.join('|') : s.type;
  return t === 'array' ? `${(s.items as { type?: string } | undefined)?.type ?? 'any'}[]` : String(t ?? 'any');
};

export function operationHelp(op: OperationDef): string {
  const lines = [`${op.summary}`, '', `Usage: ${usage(op)}`, '', `Endpoint: ${op.httpMethod} ${op.path}`, `Scope:    ${op.scope}`];
  if (op.pathParams.length) lines.push('', 'Arguments:', ...op.pathParams.map((p) => `  <${p}>`));
  if (op.queryParams.length) {
    lines.push('', 'Query options:');
    for (const q of op.queryParams) {
      lines.push(`  --${q.name} <${describeSchema(q.schema)}>${q.required ? ' (required)' : ''}${q.description ? '  ' + q.description : ''}`);
    }
  }
  const props = op.body?.schema?.properties as Record<string, Record<string, unknown>> | undefined;
  if (props) {
    const required = new Set((op.body?.schema?.required as string[] | undefined) ?? []);
    lines.push('', 'Body fields (pass as --field value, or all at once with --data):');
    for (const [name, s] of Object.entries(props)) {
      lines.push(`  --${name} <${describeSchema(s)}>${required.has(name) ? ' (required)' : ''}`);
    }
  } else if (op.body?.json) lines.push('', "Body: pass JSON with --data '<json>' or --data @file.json");
  if (op.body?.multipartField) lines.push('', `Upload: --file <path> is sent as the multipart "${op.body.multipartField}" field`);
  if (op.description) lines.push('', op.description);
  return lines.join('\n');
}

function resourceHelp(resource: string): string {
  const ops = allOps.filter((o) => kebab(o.resource) === resource);
  const width = Math.max(...ops.map((o) => kebab(o.method).length));
  return [
    `Usage: slidecold ${resource} <action> [args] [options]`,
    '',
    'Actions:',
    ...ops.map((o) => `  ${kebab(o.method).padEnd(width)}  ${o.summary}  (${o.scope})`),
    '',
    `Run \`slidecold ${resource} <action> --help\` for details.`,
  ].join('\n');
}

export function mainHelp(): string {
  return [
    `slidecold ${VERSION}: command-line client for the SlideCold API`,
    '',
    'Usage:',
    "  slidecold <resource> <action> [id] [--param value ...] [--data '<json>' | --data @file.json] [--file path]",
    '  slidecold login [--key cs_...] [--base-url url]   Save an API key to ' + configPath(),
    '  slidecold logout                                  Remove the saved API key',
    '  slidecold help [resource]',
    '',
    'Resources:',
    ...resources.map((r) => `  ${kebab(r).padEnd(14)} ${allOps.filter((o) => o.resource === r).map((o) => kebab(o.method)).join(', ')}`),
    '',
    'Global options:',
    '  --api-key <key>    API key (default: SLIDECOLD_API_KEY, then the config file)',
    '  --base-url <url>   API base URL (default: SLIDECOLD_BASE_URL, then the config file, then https://slidecold.com/api/v1)',
    '  -h, --help         Show help',
    '  -v, --version      Show version',
  ].join('\n');
}

export interface IO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Prompts for a line of input (used by `login`). */
  prompt: (question: string) => Promise<string>;
}

const defaultIO: IO = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  prompt: (q) =>
    new Promise((resolve) => {
      // shortcut: the key is echoed while typing; use --key or a hidden prompt if this matters.
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.on('close', () => resolve('')); // stdin ended without an answer
      rl.question(q, (answer) => {
        resolve(answer);
        rl.close();
      });
    }),
};

async function login(args: ParsedArgs, io: IO): Promise<number> {
  const flagKey = typeof args.flags.key === 'string' ? args.flags.key : args.flags['api-key'];
  const apiKey = (typeof flagKey === 'string' ? flagKey : await io.prompt('SlideCold API key (cs_...): ')).trim();
  if (!apiKey) throw new SlideColdError('No API key given. Create one at https://slidecold.com/settings');
  const baseUrl = typeof args.flags['base-url'] === 'string' ? args.flags['base-url'] : undefined;
  const client = new SlideCold({ apiKey, baseUrl });
  let note = '';
  try {
    await client.accounts.list(undefined, { maxRetries: 0 });
  } catch (err) {
    if (err instanceof AuthenticationError) throw new AuthenticationError(`Invalid API key. ${err.message}`, err);
    if (!(err instanceof PermissionError)) throw err;
    note = ` (key is valid but scoped: ${err.message})`;
  }
  const path = configPath();
  writeConfig({ ...readConfig(path), apiKey, ...(baseUrl ? { baseUrl } : {}) }, path);
  io.stdout(`Saved API key to ${path}${note}\n`);
  return 0;
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], io: IO = defaultIO): Promise<number> {
  const args = parseArgv(argv);
  const [first, second] = args.positionals;
  try {
    if (args.flags.version) return io.stdout(`${VERSION}\n`), 0;
    if (!first || first === 'help') {
      io.stdout((second && resources.some((r) => kebab(r) === second) ? resourceHelp(second) : mainHelp()) + '\n');
      return 0;
    }
    if (first === 'login') return await login(args, io);
    if (first === 'logout') {
      deleteConfig();
      io.stdout(`Removed ${configPath()}\n`);
      return 0;
    }
    if (!resources.some((r) => kebab(r) === first)) {
      io.stderr(`Unknown command "${first}".\n\n${mainHelp()}\n`);
      return 1;
    }
    if (!second) {
      io.stdout(resourceHelp(first) + '\n');
      return args.flags.help ? 0 : 1;
    }
    const op = findOperation(first, second);
    if (!op) {
      io.stderr(`Unknown action "${second}" for ${first}.\n\n${resourceHelp(first)}\n`);
      return 1;
    }
    if (args.flags.help) return io.stdout(operationHelp(op) + '\n'), 0;

    const call = buildCall(op, args);
    const client = new SlideCold({
      apiKey: typeof args.flags['api-key'] === 'string' ? args.flags['api-key'] : undefined,
      baseUrl: typeof args.flags['base-url'] === 'string' ? args.flags['base-url'] : undefined,
    });
    let body = call.body;
    if (call.file) {
      const form = new FormData();
      for (const [k, v] of Object.entries((body as Record<string, unknown>) ?? {})) form.append(k, String(v));
      form.append(op.body!.multipartField!, new Blob([readFileSync(call.file)]), basename(call.file));
      body = form;
    }
    const result: unknown = await client.request(op.operationId as never, { path: call.path, query: call.query, body });
    if (typeof result === 'string') io.stdout(result.endsWith('\n') ? result : result + '\n');
    else if (result !== undefined) io.stdout(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (err) {
    if (err instanceof SlideColdError) {
      io.stderr(`Error${err.status ? ` (${err.status})` : ''}: ${err.message}\n`);
    } else io.stderr(`Error: ${(err as Error).message ?? err}\n`);
    return 1;
  }
}
