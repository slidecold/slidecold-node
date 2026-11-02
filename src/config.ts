import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://slidecold.com/api/v1';

export interface ConfigFile {
  apiKey?: string;
  baseUrl?: string;
}

/** Path of the shared SlideCold config file used by the SDK, the slidecold CLI and the MCP server. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') {
    return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'slidecold', 'config.json');
  }
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'slidecold', 'config.json');
}

/** Reads the config file; returns `{}` when it is missing or unreadable. */
export function readConfig(path = configPath()): ConfigFile {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Writes the config file with 0600 permissions. */
export function writeConfig(config: ConfigFile, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600); // mode is ignored when the file already exists
}

export function deleteConfig(path = configPath()): void {
  rmSync(path, { force: true });
}

/** Resolves credentials: explicit option, then env var, then config file, then the production URL. */
export function resolveConfig(opts: ConfigFile = {}, env: NodeJS.ProcessEnv = process.env): ConfigFile & { baseUrl: string } {
  const file = opts.apiKey && opts.baseUrl ? {} : readConfig(configPath(env));
  return {
    apiKey: opts.apiKey || env.SLIDECOLD_API_KEY || file.apiKey,
    baseUrl: (opts.baseUrl || env.SLIDECOLD_BASE_URL || file.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
}
