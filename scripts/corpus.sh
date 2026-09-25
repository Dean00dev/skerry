#!/usr/bin/env bash
# Real-world corpus run. Maintainer tool; not part of the Action or of CI.
#
#   scripts/corpus.sh <out-dir> owner/repo [owner/repo...]
#
# Each repository is cloned shallow and blobless with no checkout, so only
# path names are downloaded, never file contents. `git read-tree HEAD` then
# fills the index, and Skerry scans it through its normal `git` source. One
# tab-separated line is printed per repository:
#   repo  commit  paths  errors  warnings  seconds  peak-RSS  findings-by-rule
# Full JSON reports are kept in <out-dir>/reports.
set -euo pipefail
out=$1; shift
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out/clones" "$out/reports"
for spec in "$@"; do
  name=${spec//\//__}
  dir="$out/clones/$name"
  if [ ! -d "$dir" ]; then
    git clone -q --filter=blob:none --no-checkout --depth 1 "https://github.com/$spec.git" "$dir"
    git -C "$dir" read-tree HEAD
  fi
  node - "$root" "$dir" "$out/reports/$name.json" "$spec" <<'JS'
const [root, dir, report, spec] = process.argv.slice(2);
const { execFileSync } = require('node:child_process');
const { run } = require(`${root}/src/index.js`);
const log = console.log;
console.log = () => {};
process.stdout.write = () => true;
const start = process.hrtime.bigint();
let code;
try {
  code = run(['--path', dir, '--source', 'git', '--annotations', 'false', '--fail-on', 'never',
    '--max-findings', '100000', '--report-json', report]);
} catch (err) {
  code = err.message;
}
if (code !== 0 && code !== 1) {
  process.stderr.write(`${spec}\tERROR\t${code}\n`);
  process.exit(0);
}
const secs = (Number(process.hrtime.bigint() - start) / 1e9).toFixed(2);
const r = require(report);
const byRule = {};
for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
process.stderr.write([spec, sha, r.scanned, r.counts.error, r.counts.warning, `${secs}s`,
  `${Math.round(process.resourceUsage().maxRSS / 1024)}MB`, JSON.stringify(byRule)].join('\t') + '\n');
JS
done
