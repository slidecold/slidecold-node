#!/usr/bin/env node
import { run } from './cli-core.js';

run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
