# Verification receipt

**Skerry 1.0.1** · original Claude verification, independent integration
review, and live annotation-integrity repair through 14 August 2026

This document exists so that nothing in this repository has to be taken on
trust. It separates what was actually executed from what was simulated and what
has not been demonstrated at all.

Skerry is public on GitHub. Version 1.0.1 is released through the existing
[GitHub Marketplace](https://github.com/marketplace/actions/skerry-path-guard).
Version 1.0.1 ran successfully in GitHub Actions on Ubuntu, macOS and
Windows with Node 20, 22 and 24. Claude's baseline was produced locally on Node
22.22.2 with network disabled. ChatGPT / Super Sol independently reproduced the
baseline, reviewed the implementation, integrated it on GitHub, and verified
the 1.0.1 repairs against GitHub's check-run API. The final local state passed
on Node 24.14.0, Linux x86_64, git 2.51.1.

---

## 1 · Gate results

Every gate was executed in one sequence on the final state of the repository.

| Gate | Command | Result |
| --- | --- | --- |
| Test suite | `npm test` | **176 passed, 0 failed, 0 skipped** |
| Metadata consistency | `node scripts/check-metadata.js` | passed, 0 notes |
| Credential scan | `node scripts/scan-secrets.js` | clean — 56 text files, 9 patterns |
| JavaScript syntax | `node --check` on all 23 `.js` files | all parse |
| YAML parse | Python `yaml.safe_load` on 5 files | all parse |
| Self scan, strictest | `node src/index.js --fail-on warning` | 56 paths, 0 findings, exit 0 |
| GitHub matrix | Ubuntu, macOS, Windows × Node 20, 22, 24 | **9/9 passed** |
| Live Action: clean | Skerry on its own checkout | 56 tracked paths, 0 findings |
| Live Action: catches | Skerry on hazardous manifest | 6 errors, expected failure observed |
| Live intentional-failure annotations | GitHub check-run annotations API | **0 annotations** |
| Live step outputs | Action outputs consumed downstream | `findings=0`, `scanned=56`, `source=git` |

Repository inventory: 56 files, 1,571 lines of source across 8 modules, 1,614
lines of test across 12 files, 9 hazardous fixture manifests, **0 runtime
dependencies**, no `dist/`, no `node_modules/`.

---

## 2 · Implemented and tested

Executed against real code, with assertions.

**Rules** — all eleven fire on their fixtures and stay silent on legitimate
names. Negative coverage is deliberate and specific: `console.js`, `nullable.ts`
and `com10.log` do not trigger SK004; a `👨‍👩‍👧` emoji filename containing
U+200D does not trigger SK011; Arabic, Chinese, Cyrillic and accented names do
not trigger anything.

**Collision logic** — file-level, directory-level, and file-versus-directory
collisions. A badly named directory containing four files produces one finding,
not four. Three-way groups list every other member. NFC/NFD collisions print a
code point spelling so the two names can be told apart.

**Boundary values** — SK008 at exactly 200 characters fires, 199 does not.
`max-path-length: 0` disables it. `max-findings: 1` is accepted, `0` is
rejected. `max-path-length` accepts 0 and 4096 and rejects 4097 and `-5`.

**Input validation** — every invalid value tested produces exit code 2 with a
message naming the input. Unknown rule ids, unknown flags, non-numeric numbers,
`1e5`, unparseable booleans, `source: list` without `paths-file`, and newline or
NUL in a path input are all rejected rather than silently defaulted.

**Adversarial input** — these ran as tests, not as thought experiments:

| Attack | Result |
| --- | --- |
| Filename `::add-mask::hunter2.txt` | Forged command does not survive into the message |
| Filename containing a newline plus `::set-output` | Annotation stays exactly one line |
| Filename with ANSI escape sequences | ESC replaced with `<U+001B>` before printing |
| Filename with bidi override U+202E | Replaced with `<U+202E>`, and flagged as SK009 |
| Filename with `%` and `,` | Escaped; `file=` still parses as one property |
| Filename with control characters | Annotation emitted **without** `file=`, so no annotation points at an unresolvable path |
| Filename `a\|b\|c.txt` in the summary | Rows keep exactly five cell borders |
| Git repository inside a directory named `--upload-pack=touch` | Scanned correctly; the directory is passed as `cwd`, never as an argument |
| Symlink loop | Traversal terminates immediately |
| 60 nested `**/` patterns against a 4,000 character subject | Returns in well under one second |
| 500-plus findings | Output truncated, counts and exit code still correct |

**Determinism** — reversing the input order produces identical findings. Two
separate process invocations produced byte-identical JSON reports:
`sha256 233599c5fe6fd58f2cb82de799093889db2801f59c328c3fb8bd860cbce98983` for
both. Reports contain no timestamp, hostname, run id or absolute path, and a
test asserts this.

**Information disclosure** — the log contains neither `PATH` nor the names of
runner environment variables. A report generated with ignore patterns records
their count but not their text.

---

## 3 · Executed end to end

`test/e2e.test.js` spawns the real entrypoint as a child process with the
environment variables a runner sets — `INPUT_*`, `GITHUB_OUTPUT`,
`GITHUB_STEP_SUMMARY`, `GITHUB_ACTIONS` — and reads back the files it writes.

Confirmed by reading real files from disk:

- A clean workspace exits 0; `passed=true`, `errors=0`
- A hazardous manifest exits 1; `passed=false`, correct counts
- `fail-on: warning` turns a warning into a failure; `fail-on: never` exits 0
  while still reporting the counts
- Truncation never hides a failure: 30 errors capped at 5 findings still exits 1
  and still reports `errors=30`
- Usage errors exit 2 and write **no** step outputs at all
- JSON and SARIF reports are written to the requested paths and parse
- `ignore` patterns are honoured; `annotations: false` emits no workflow
  annotation commands while preserving the failure exit code; `summary: false`
  leaves the summary file untouched
- Every emitted annotation matches `^::(error|warning|notice) [^:]*::`

**A real git repository was created and scanned.** A tracked filename containing
U+202E RIGHT-TO-LEFT OVERRIDE was added to a throwaway repository and Skerry
caught SK009 via `git ls-files`. An untracked hazardous filename was correctly
ignored, proving the git source sees only tracked paths. Host-illegal Windows
names and case collisions remain manifest fixtures because those paths cannot
be represented on every runner filesystem.

**Skerry scanned its own repository as a real GitHub checkout.** The live Action
read 56 tracked paths via the git source and found nothing at `fail-on: warning`.
A downstream step read the real outputs and confirmed `source=git`,
`scanned=56`, `findings=0`.

---

## 4 · Live GitHub execution

GitHub Actions run
[`31818840110`](https://github.com/Dean00dev/skerry/actions/runs/31818840110)
completed successfully at commit `1c42c76e193893cc123be664fa1aa59bb0db213b`.

| Live evidence | Result |
| --- | --- |
| Unit/end-to-end matrix | Ubuntu, macOS and Windows on Node 20, 22 and 24 all passed |
| Metadata and secrets | JavaScript syntax, YAML parsing, metadata and credential scan passed |
| Real Action, clean checkout | 56 tracked paths, 0 findings, strictest setting passed |
| Real Action, hazardous manifest | 6 errors found; the expected failing outcome was asserted |
| Intentional-failure annotation hygiene | Check run `94826964220` returned an empty annotations array |
| Real Action outputs | A downstream step read `findings=0`, `scanned=56`, `source=git` |

The local runner simulation remains useful because it directly reads the
output and summary files and attacks their escaping. The live jobs now also
establish that GitHub accepts `action.yml`, invokes the Node 24 entrypoint,
recognises failure, and exposes step outputs to later steps.

### Disclosed live-run history

Failures are retained because repaired evidence is stronger when its history is
visible.

| Run | Commit | Outcome | What it established |
| --- | --- | --- | --- |
| [#1](https://github.com/Dean00dev/skerry/actions/runs/31697119844) | `6fe12d63` | failed | Linux-specific separators, host-illegal fixtures and a Windows Node 20 junction classification were exposed |
| [#2](https://github.com/Dean00dev/skerry/actions/runs/31697438421) | `30016074` | failed | `/var` versus `/private/var` on macOS and the Windows Node 20 junction case remained |
| [#3](https://github.com/Dean00dev/skerry/actions/runs/31697656821) | `00016293` | passed | All nine OS/Node test cells and four integration jobs passed after the production fix |
| [#4](https://github.com/Dean00dev/skerry/actions/runs/31698018134) | `90f99574` | passed | Live UI exposed seven error annotations for six findings in the intentional failure job |
| [#5](https://github.com/Dean00dev/skerry/actions/runs/31698958965) | `24167520` | passed | Unique Marketplace display-name change preserved all gates |
| [#6](https://github.com/Dean00dev/skerry/actions/runs/31818584046) | `6f17b001` | passed | Six false errors disappeared, but API inspection found one residual notice annotation |
| [#7](https://github.com/Dean00dev/skerry/actions/runs/31818840110) | `1c42c76e` | passed | **13/13 jobs passed and the intentional failure job returned zero annotations** |

---

## 5 · Not yet demonstrated

Honest gaps. None is hidden.

- **Marketplace acceptance is demonstrated; external use is not.** GitHub lists
  Skerry Path Guard and release 1.0.1 publicly. This receipt has not found a
  workflow in an unrelated repository invoking the published Action.
- **Cross-platform Action execution is only partially demonstrated.** The full
  test suite passes on Ubuntu, macOS and Windows, but the three live `uses: ./`
  integration jobs execute on Ubuntu only.
- **Independent review happened, but not human code review.** ChatGPT / Super
  Sol read and adversarially tested the code. No unaffiliated human has reviewed
  it.
- **No real-world false positive data exists.** Skerry has never been run
  against a repository it did not create. SK003 in particular is expected to be
  noisy and is a warning for that reason, but that expectation is untested at
  scale.
- **Performance at scale is untested.** The largest live self-scan was 56 paths. Caps at
  500,000 entries and 100 levels of depth are implemented and bounded but were
  not exercised near their limits.
- **SARIF was structurally checked, not schema validated.** Version, rule
  declarations and result shape were asserted; no SARIF validator was run.

---

## 6 · Owner-controlled steps still required

Nothing in this project can do any of these, and nothing attempted to.

1. Enable Issues and Private vulnerability reporting if not already enabled
2. Test the published Action from a different repository and operating system

Full sequence in `RELEASE_CHECKLIST.md`.

---

## 7 · Defects found and fixed during verification

Recorded because a verification document with nothing in this section is not
credible.

1. **Normalization collisions printed identically.** SK002 reported two paths
   that rendered as the same text, making the finding unusable. Fixed by adding
   `codePointSpelling()`, so the message now shows `"cafe<U+0301>.md" vs
   "caf<U+00E9>.md"`. A test locks this in.
2. **A test asserted wrong behaviour.** A case expected `NUL:x.txt` to trigger
   SK004. It does not: the reserved-name check reads the base before the first
   dot, matching established prior art, so the colon makes it SK005 instead.
   The code was right and the test was wrong. The test was corrected and a
   second test added that documents the semantics explicitly.
3. **`node --test test/` does not work on Node 22.** The directory form was
   removed after Node 20 and a shell glob does not expand on Windows
   PowerShell. Replaced with `scripts/test.js`, which lists the files and
   behaves identically on every platform and supported Node version.

### Independent integration review by ChatGPT / Super Sol

The original Claude baseline reproduced exactly: **160/160 tests passed** before
any modification. The integration review then made these disclosed changes:

4. **SK004 falsely treated `COM0` and `LPT0` as reserved.** Microsoft's current
   reserved-name documentation lists `COM1`–`COM9` and `LPT1`–`LPT9`. Removed
   `COM0`/`LPT0` from code and documentation and added negative regression tests.
5. **Source safety caps could return partial green scans.** Git and list sources
   silently stopped at 500,000 entries, while the filesystem source returned a
   truncation flag the entrypoint ignored. All three sources now fail closed
   above the entry or depth limit, with regression tests.
6. **Resource caps were enforced after risky allocation in two paths.** The
   filesystem walker loaded a whole directory at once and the list source read
   the whole manifest before checking it. Filesystem entries are now streamed;
   manifests are capped at 256 MiB before reading; Git output remains capped at
   256 MiB.
7. **`auto` could hide a Git collection failure.** Once a work tree is detected,
   `git ls-files` errors now fail the scan rather than switching to a different
   source and potentially changing scope. A corrupt-index regression test locks
   this in.
8. **One documentation claim was too broad.** Normal Git/filesystem scans do not
   read repository contents, but `source: list` necessarily reads its supplied
   manifest. README, metadata and security wording now make that distinction.
9. **CI supply-chain references were stale or floating.** CI now uses
   `actions/checkout@v6` and `actions/setup-node@v7`, and pins its CI-only YAML
   parser to `PyYAML==6.0.3`. Runtime dependencies remain zero.
10. **The first live matrix exposed non-portable test fixtures.** Windows path
    separators, macOS's `/var` → `/private/var` alias, and host-illegal fixture
    names were being asserted as if every filesystem behaved like Linux. Report
    paths are now compared by filesystem identity and the real-Git fixture uses
    a portable U+202E filename.
11. **Node 20 on Windows exposed a symlink traversal hazard.** Its `Dirent`
    classification can report a directory symlink/junction as a directory. The
    filesystem walker now checks every entry with `lstat`, records symlinks, and
    never follows them. This was a production hardening fix, not merely a test
    adjustment.
12. **Finding totals did not reconcile with GitHub's annotation panel.** Six
    SK001 findings produced seven errors because the explanatory failure line
    was emitted as another `::error`. It is now a notice, so explanatory text is
    not counted as a finding.
13. **The intentional negative CI test attached its six expected errors to the
    commit.** That job now runs with `annotations: false`; its exit code and
    outputs are still asserted, without making a healthy commit look broken.
14. **The first repair still leaked its explanatory notice.** Run #6 was green,
    but direct check-run API inspection found one notice on the intentional
    failure job. Explanatory workflow commands are now gated by the same
    `annotations` input. Seven regression tests cover count reconciliation,
    severity, failure preservation, clean output, and complete suppression.

---

## 8 · The claim this project does and does not make

Skerry is **not described as production-ready**. A successful CI matrix and
Marketplace listing are strong automated evidence, not evidence of production
use or real-world false-positive rates.

What the evidence supports: the implementation is complete, its rules behave as
documented against real and adversarial input, it handles hostile filenames
without allowing them to alter its output, it is deterministic, and it has no
dependencies.

What the evidence does not support: live Action execution on macOS or Windows,
pull-request diff annotation rendering, performance near the documented caps,
or behaviour on repositories it has never seen.

---

## 9 · Provenance

- **Dean Egan** — challenge designer, director, publisher, accountable
  repository owner
- **Claude (Anthropic)** — independent project concept and primary
  implementation, including this document
- **ChatGPT / Super Sol (OpenAI)** — independent hostile review, integration and
  publication assistance

Any change made after this document was written must be disclosed so the
project history stays honest. If a reviewer modifies the code, the numbers in
section 1 no longer describe what is in the repository and the gates must be
re-run.

Provenance is not evidence. The tests are. Run them yourself: `npm test`.
