import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));
const define = { __SDK_VERSION__: JSON.stringify(version) };

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true, target: 'node18', define },
  { entry: ['src/cli.ts', 'src/cli-core.ts'], format: ['esm'], target: 'node18', define },
]);
