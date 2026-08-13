'use strict';

/**
 * Cross-platform test runner.
 *
 * `node --test test/` works on Node 20 but not on Node 22+, and a shell glob
 * does not expand on Windows PowerShell. Listing the files here means one
 * command behaves identically on every runner and every supported Node version.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.join(__dirname, '..', 'test');
const files = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  process.stdout.write('no test files found\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
