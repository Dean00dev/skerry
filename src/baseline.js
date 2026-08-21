'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RULE_IDS } = require('./constants');

const BASELINE_SCHEMA = 'skerry-baseline/1';
const MAX_BASELINE_BYTES = 16 * 1024 * 1024;
const MAX_BASELINE_ENTRIES = 100000;
class BaselineError extends Error {}

function keyFor(finding) {
  return `${finding.rule} ${finding.path}`;
}

function validateEntry(entry) {
  if (typeof entry !== 'string' || /[\r\n\u0000]/.test(entry)) {
    throw new BaselineError('every baseline entry must be a single-line string');
  }
  const separator = entry.indexOf(' ');
  if (separator < 1 || !RULE_IDS.includes(entry.slice(0, separator)) || separator === entry.length - 1) {
    throw new BaselineError('every baseline entry must contain a known rule id and a non-empty path');
  }
}

function load(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    throw new BaselineError(`cannot read baseline: ${String(err.message).split('\n')[0].slice(0, 160)}`);
  }
  if (!stat.isFile()) throw new BaselineError('baseline path must name a regular file');
  if (stat.size > MAX_BASELINE_BYTES) throw new BaselineError('baseline file exceeds the 16 MiB safety limit');

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new BaselineError('baseline file is not valid JSON');
    throw new BaselineError(`cannot read baseline: ${String(err.message).split('\n')[0].slice(0, 160)}`);
  }
  if (!parsed || parsed.schema !== BASELINE_SCHEMA) {
    throw new BaselineError(`baseline file must declare "schema": "${BASELINE_SCHEMA}"`);
  }
  if (!Array.isArray(parsed.entries)) throw new BaselineError('baseline file must contain an "entries" array');
  if (parsed.entries.length > MAX_BASELINE_ENTRIES) {
    throw new BaselineError(`baseline contains more than ${MAX_BASELINE_ENTRIES} entries`);
  }
  for (const entry of parsed.entries) validateEntry(entry);
  const entries = new Set(parsed.entries);
  if (entries.size !== parsed.entries.length) throw new BaselineError('baseline entries must be unique');
  if (!Number.isSafeInteger(parsed.count) || parsed.count !== entries.size) {
    throw new BaselineError('baseline count must equal the number of entries');
  }
  return entries;
}

function serialise(findings) {
  const entries = [...new Set(findings.map(keyFor))].sort();
  return `${JSON.stringify({ schema: BASELINE_SCHEMA, count: entries.length, entries }, null, 2)}\n`;
}

function write(file, findings) {
  const target = path.resolve(process.cwd(), file);
  const text = serialise(findings);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  } catch (err) {
    throw new BaselineError(`cannot write baseline: ${String(err.message).split('\n')[0].slice(0, 160)}`);
  }
  return { path: target, count: JSON.parse(text).count };
}

function apply(result, baseline) {
  const findings = [];
  const baselinedFindings = [];
  const matched = new Set();
  for (const finding of result.findings) {
    const key = keyFor(finding);
    if (baseline.has(key)) {
      matched.add(key);
      baselinedFindings.push(finding);
    } else findings.push(finding);
  }
  const counts = { error: 0, warning: 0, notice: 0, total: findings.length };
  for (const finding of findings) counts[finding.severity] += 1;
  return {
    ...result,
    findings,
    counts,
    total: findings.length,
    baselined: baselinedFindings.length,
    baselinedFindings,
    stale: [...baseline].filter((key) => !matched.has(key)).sort(),
  };
}

module.exports = {
  load, write, apply, serialise, keyFor, BaselineError, BASELINE_SCHEMA,
  MAX_BASELINE_BYTES, MAX_BASELINE_ENTRIES,
};
