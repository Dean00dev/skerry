'use strict';

/**
 * Scans every tracked file for anything that looks like a committed credential.
 *
 * The patterns are assembled from fragments so that this file does not itself
 * contain the literal token prefixes it looks for. That means the scanner can
 * scan itself rather than being excluded, which is the honest arrangement: a
 * scanner with a blind spot over its own source is not much of a scanner.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const PATTERNS = [
  { name: 'GitHub personal access token', regex: new RegExp(`\\bgh[pousr]${'_'}[A-Za-z0-9]{36,}`) },
  { name: 'GitHub fine grained token', regex: new RegExp(`\\bgithub${'_'}pat${'_'}[A-Za-z0-9_]{20,}`) },
  { name: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'private key block', regex: new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----`) },
  { name: 'Slack token', regex: new RegExp(`\\bxox[baprs]${'-'}[A-Za-z0-9-]{10,}`) },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', regex: new RegExp(`\\bnpm${'_'}[A-Za-z0-9]{36}\\b`) },
  { name: 'JSON web token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'assigned secret literal',
    regex: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out.split('\u0000').filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // not a git work tree yet
  }
  return walk(ROOT, '');
}

function walk(dir, rel) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), childRel));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 4096);
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

function main() {
  const files = trackedFiles();
  const hits = [];
  let scanned = 0;

  for (const file of files) {
    const abs = path.join(ROOT, file);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    const buffer = fs.readFileSync(abs);
    if (looksBinary(buffer)) continue;
    scanned += 1;

    const lines = buffer.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(lines[i])) {
          hits.push({ file, line: i + 1, name: pattern.name });
        }
      }
    }
  }

  process.stdout.write(`secret scan: ${scanned} text file(s) scanned, ${PATTERNS.length} pattern(s)\n`);
  if (hits.length === 0) {
    process.stdout.write('secret scan: clean\n');
    return 0;
  }
  for (const hit of hits) {
    // The match itself is never printed, only its location and category.
    process.stdout.write(`FAIL: possible ${hit.name} at ${hit.file}:${hit.line}\n`);
  }
  return 1;
}

process.exitCode = main();
