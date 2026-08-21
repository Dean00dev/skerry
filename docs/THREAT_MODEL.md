# Threat model

## Scope

This document is about Skerry defending **itself** and the job it runs in. Skerry is not a security control for your repository, and a clean run establishes nothing about whether your repository is safe. See "What Skerry does not protect against" at the end.

## Assets

1. The integrity of the workflow log and the annotations produced from it.
2. The integrity of the job: Skerry must not execute repository-controlled content, and must not become a foothold for reaching other steps.
3. The confidentiality of the caller's environment: no secrets, no environment values, and no repository *contents* in the log.
4. Job availability: a hostile repository must not hang the runner or exhaust its memory.

## Attacker model

The attacker can open a pull request against a repository that runs Skerry. Therefore the attacker fully controls:

- every filename and directory name in the tree, including characters that are legal in git but hostile everywhere else
- the number of files and the depth of the tree
- symlink targets and file modes
- the pull request title, branch name, and body

The attacker does **not** control the workflow file, the Action inputs, or the runner configuration. Inputs are treated as trusted-but-validated: they come from the workflow author, and the standard warning about interpolating untrusted expressions into a workflow applies to Skerry exactly as it does to every other Action.

Everything a repository can influence — filenames, path depth, file modes — is treated as hostile.

---

## T1 · Workflow command injection through a filename

**Attack.** Commit a file named `::add-mask::hunter2.txt`, or one containing a newline followed by `::set-output name=passed::true`. When Skerry prints that name, the runner parses the forged command. Consequences range from log manipulation to faking this Action's own pass result.

**Defence.** Two independent layers, both applied to every repository-controlled string:

1. `sanitizeDisplay()` replaces every control character, C1 character, bidi control and invisible formatting character with a visible `<U+XXXX>` placeholder. A newline can never reach the output.
2. GitHub's documented workflow command escaping. Message data escapes `%`, `\r`, `\n`. Property values additionally escape `:` and `,`.

**Tests.** `test/render.test.js` asserts that a forged `::add-mask::` does not survive into the message, that an annotation is always exactly one line, that a filename with a newline cannot break out, and that percent signs and commas cannot split a property. `fixtures/unsafe/injection.txt` carries these names end to end.

**Residual risk.** GitHub's workflow command format is not versioned and could change. If a future runner introduces a new command syntax not covered by the current escaping rules, this defence would need updating. Skerry only ever emits `::error`, `::warning` and `::notice`, which limits but does not eliminate exposure.

---

## T2 · Command injection through a subprocess

**Attack.** A filename or directory name is interpolated into a shell command.

**Defence.** There is no shell. `git` is invoked with `execFileSync` and an argument array. Filenames are never passed as arguments — Skerry only reads git's *output*. The scan directory is passed as `cwd`, never as an argument, so a directory named `--upload-pack=touch /tmp/pwned` cannot be interpreted as a git option.

**Test.** `test/sources.test.js` creates a git repository inside a directory literally named `--upload-pack=touch` and asserts a correct scan.

**Residual risk.** Skerry trusts the `git` binary already on the runner's `PATH`. An attacker who can replace that binary has already won by other means.

---

## T3 · Terminal and log spoofing

**Attack.** A filename containing ANSI escape sequences repaints the log, hides earlier output, or forges a passing result visually. A bidi override makes a displayed name differ from the real one.

**Defence.** `sanitizeDisplay()` neutralises ESC (U+001B), all C0 and C1 controls, bidi controls and invisible characters before anything is printed. Display strings are capped at 300 characters. Normalization collisions additionally print a code point spelling so two visually identical names can be told apart.

**Tests.** `test/render.test.js` covers ANSI, bidi, NUL and the length cap.

**Residual risk.** A filename made of confusable characters — Cyrillic `а` for Latin `a` — is still visually deceptive and Skerry does not flag it. Homoglyph detection was considered and rejected: it produces false positives on legitimate internationalised names, and a checking tool that cries wolf on Russian filenames is worse than one that stays quiet.

---

## T4 · Job summary injection

**Attack.** A filename containing `|`, backticks or HTML breaks the summary table or injects markup into the rendered summary.

**Defence.** `escapeMarkdownCell()` escapes backslashes, pipes and backticks and HTML-encodes `<` and `>`. The table is capped at 100 rows.

**Test.** `test/render.test.js` asserts that a filename containing pipes still produces rows with exactly five cell borders.

**Residual risk.** GitHub's summary renderer is a moving target. Escaping is conservative, but Skerry does not control that renderer.

---

## T5 · Output file poisoning

**Attack.** A value written to `$GITHUB_OUTPUT` contains a newline and forges an extra output — for example setting `passed=true` on a failing run — which a later step then trusts.

**Defence.** All outputs are written using the heredoc form with a delimiter generated per run from 16 random bytes. Report path inputs are rejected outright if they contain a newline or NUL. No repository-controlled string is ever written to `$GITHUB_OUTPUT`; outputs are counts, booleans and validated paths only.

**Tests.** `test/inputs.test.js` covers rejection of newline and NUL in path inputs. `test/e2e.test.js` parses the real outputs file and asserts no outputs are written at all on a usage error.

---

## T6 · Resource exhaustion

**Attack.** A repository with a million files, a 10,000-deep tree, a symlink loop, or 50,000 colliding names, aimed at hanging the runner or exhausting memory.

**Defence.** Every source is capped at 500,000 entries and 100 levels of depth, and crossing a cap is a usage error rather than a truncated success. The filesystem walk is iterative, streams each directory and never follows symlinks. Git output and list manifests are capped at 256 MiB; manifest size is checked before reading. Findings output is capped at `max-findings`, default 500, while the pass/fail decision still uses the full set. Ignore patterns are capped at 200 patterns of 512 characters, and compile to regular expressions that cannot backtrack catastrophically.

**Tests.** `test/sources.test.js` builds a symlink loop and asserts immediate termination, then exercises the entry and depth caps at small injected limits and asserts a failure rather than partial results. `test/match.test.js` throws 60 nested `**/` patterns at a 4,000 character subject with a one second budget. `test/scan-options.test.js` and `test/e2e.test.js` cover findings-output truncation.

**Residual risk.** The caps are generous. A repository near the 500,000 entry limit will use meaningful memory holding the path list. This is bounded, not free.

---

## T7 · Information disclosure

**Attack.** Skerry leaks secrets or private repository content into a public workflow log.

**Defence.** Skerry never opens a scanned repository file, so those file contents cannot leak through it. The explicit `list` source necessarily reads its caller-supplied path manifest. Skerry never reads or prints environment variables. Error messages from git and the filesystem are truncated to 200 characters and first line only, so a stack trace or environment dump cannot spill. The JSON report records how many ignore patterns ran but never the patterns themselves, since those can name internal projects.

**Tests.** `test/e2e.test.js` asserts the log contains neither `PATH` nor the names of runner environment variables. `test/report.test.js` asserts a report containing ignore patterns does not include their text.

**Residual risk.** Filenames are printed, by design — that is the tool. If a filename itself contains a secret, Skerry will print it. Do not put secrets in filenames.

---

## T8 · Misplaced trust in a clean result

**Attack.** Not an attack. A failure mode.

A team sees a green Skerry badge and concludes something Skerry never claimed. Skerry checks that filenames are portable. It does not review code, does not detect malware, does not validate content, and does not make a repository safe.

**Defence.** Documentation that says so plainly, in the README, in `docs/RULES.md` under SK009 and SK010, and here. The word "security" is deliberately absent from the Marketplace category choice, which is Code quality.

---

## What Skerry does not protect against

- Anything in file *contents*, including Trojan Source attacks in source code
- Malicious code, dependency compromise, or workflow tampering
- Clone-time symlink attacks. SK010 reports a hazard *shape*; it does not prove exploitability and is not a mitigation
- Case-insensitivity behaviour on a filesystem whose folding tables differ from JavaScript's
- Branch and tag name collisions, which are a real and related problem that Skerry does not currently check
- Anything at all outside the checked-out tree

## Reporting

See [SECURITY.md](../SECURITY.md).
