'use strict';

/**
 * Checks that action.yml, the code, and the README have not drifted apart.
 *
 * This is the check that catches the most embarrassing class of bug in a
 * published Action: an input documented in the README that the code ignores,
 * or an output declared in metadata that is never written.
 *
 * The reader below understands only the small, indentation-based subset of
 * YAML that action.yml actually uses. It is not a general YAML parser and does
 * not pretend to be; CI runs a real YAML parser as a separate gate.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function readActionYml() {
  const file = path.join(ROOT, 'action.yml');
  if (!fs.existsSync(file)) {
    fail('action.yml is missing from the repository root');
    return null;
  }
  if (fs.existsSync(path.join(ROOT, 'action.yaml'))) {
    fail('both action.yml and action.yaml exist; Marketplace requires exactly one');
  }
  return { file, text: fs.readFileSync(file, 'utf8') };
}

/** Collect the direct child keys of a top level block. */
function childKeys(text, blockName) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `${blockName}:`);
  if (start === -1) return null;
  const keys = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!line.startsWith(' ')) break;
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function topLevelScalar(text, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function nestedScalar(text, parent, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `${parent}:`);
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (!lines[i].startsWith(' ')) break;
    const match = new RegExp(`^ {2}${key}:\\s*(.*)$`).exec(lines[i]);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function main() {
  const action = readActionYml();
  if (!action) return report();
  const { text } = action;

  // Required Marketplace metadata
  for (const key of ['name', 'description', 'runs']) {
    if (!new RegExp(`^${key}:`, 'm').test(text)) fail(`action.yml is missing the "${key}" key`);
  }

  const name = topLevelScalar(text, 'name');
  const description = topLevelScalar(text, 'description');
  if (name && name.length > 60) fail(`action name is ${name.length} characters; keep it short`);
  if (description && description.length > 200) {
    fail(`action description is ${description.length} characters, which Marketplace will truncate`);
  }
  if (description && !/[.!]$/.test(description)) {
    notes.push('action description does not end with a full stop');
  }

  // Branding is required for a Marketplace listing
  const icon = nestedScalar(text, 'branding', 'icon');
  const color = nestedScalar(text, 'branding', 'color');
  if (!icon) fail('action.yml has no branding.icon, which Marketplace requires');
  if (!color) fail('action.yml has no branding.color, which Marketplace requires');
  const ALLOWED_COLORS = ['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark'];
  if (color && !ALLOWED_COLORS.includes(color)) {
    fail(`branding.color "${color}" is not one of: ${ALLOWED_COLORS.join(', ')}`);
  }

  // The entrypoint must exist
  const runsUsing = nestedScalar(text, 'runs', 'using');
  const runsMain = nestedScalar(text, 'runs', 'main');
  if (!runsUsing) fail('action.yml has no runs.using');
  if (!runsMain) {
    fail('action.yml has no runs.main');
  } else if (!fs.existsSync(path.join(ROOT, runsMain))) {
    fail(`runs.main points at ${runsMain}, which does not exist`);
  }
  if (runsUsing && !/^node\d+$/.test(runsUsing)) {
    fail(`runs.using "${runsUsing}" is not a JavaScript runtime this project supports`);
  }

  // Inputs must match the code exactly
  const declaredInputs = childKeys(text, 'inputs') || [];
  const { INPUT_NAMES } = require('../src/inputs');
  const codeInputs = [...INPUT_NAMES].sort();
  const metaInputs = [...declaredInputs].sort();

  for (const input of metaInputs) {
    if (!codeInputs.includes(input)) fail(`action.yml declares input "${input}" that the code never reads`);
  }
  for (const input of codeInputs) {
    if (!metaInputs.includes(input)) fail(`the code reads input "${input}" that action.yml does not declare`);
  }

  // Every input needs a description and a default
  for (const input of declaredInputs) {
    const block = new RegExp(`^ {2}${input}:\\n(?: {4}.*\\n?)*`, 'm').exec(text);
    if (!block) continue;
    if (!/^ {4}description:/m.test(block[0])) fail(`input "${input}" has no description`);
    if (!/^ {4}default:/m.test(block[0])) notes.push(`input "${input}" has no default`);
  }

  // Outputs must match what the entrypoint actually writes
  const declaredOutputs = (childKeys(text, 'outputs') || []).sort();
  const indexSource = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  const writeBlock = /writeOutputs\(\{([\s\S]*?)\}\);/.exec(indexSource);
  if (!writeBlock) {
    fail('could not find the writeOutputs call in src/index.js');
  } else {
    const written = [...writeBlock[1].matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]).sort();
    for (const output of declaredOutputs) {
      if (!written.includes(output)) fail(`action.yml declares output "${output}" that is never written`);
    }
    for (const output of written) {
      if (!declaredOutputs.includes(output)) fail(`src/index.js writes output "${output}" that action.yml does not declare`);
    }
  }

  // Every input and output must appear in the README
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const input of declaredInputs) {
    if (!readme.includes(`\`${input}\``)) fail(`input "${input}" is not documented in README.md`);
  }
  for (const output of declaredOutputs) {
    if (!readme.includes(`\`${output}\``)) fail(`output "${output}" is not documented in README.md`);
  }

  // Every rule must be documented
  const { RULE_IDS } = require('../src/constants');
  const rulesDoc = fs.readFileSync(path.join(ROOT, 'docs', 'RULES.md'), 'utf8');
  for (const id of RULE_IDS) {
    if (!rulesDoc.includes(id)) fail(`rule ${id} is not documented in docs/RULES.md`);
    if (!readme.includes(id)) fail(`rule ${id} is not listed in README.md`);
  }

  // Version consistency
  const { VERSION } = require('../src/constants');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.version !== VERSION) {
    fail(`package.json version ${pkg.version} does not match src/constants.js ${VERSION}`);
  }
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(VERSION)) fail(`CHANGELOG.md does not mention version ${VERSION}`);

  // Zero dependency claim must stay true
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail('package.json declares runtime dependencies; the zero dependency claim would be false');
  }
  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    fail('node_modules exists in the repository root and must not be committed');
  }

  return report();
}

function report() {
  for (const note of notes) process.stdout.write(`note: ${note}\n`);
  if (failures.length === 0) {
    process.stdout.write(`metadata check passed (${notes.length} note(s))\n`);
    return 0;
  }
  for (const failure of failures) process.stdout.write(`FAIL: ${failure}\n`);
  process.stdout.write(`\nmetadata check failed with ${failures.length} problem(s)\n`);
  return 1;
}

process.exitCode = main();
