# Security policy

## Reporting a vulnerability

Please use **private vulnerability reporting** on this repository:
Security tab → Report a vulnerability.

That keeps the report private until a fix exists. Please do not open a public
issue for a security problem.

Include, if you can: the version or commit, the filename or input that triggers
the behaviour, what you expected, and what happened instead. A path manifest
that reproduces it is the most useful thing you can send.

Expect an acknowledgement within a week. This is a single-maintainer project,
not a company with an on-call rota, and the response time reflects that.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## What is in scope

Skerry's own behaviour when handling hostile input:

- A filename that forges a workflow command, escapes an annotation line, or
  injects a row into the job summary
- A filename or directory name that reaches a shell or a subprocess argument
- Repository content, environment values or secrets appearing in the log
- A repository shape that hangs the runner or exhausts its memory
- An input value that writes outside the path it was given, or forges a step
  output such as `passed`

The reasoning behind each of these, and the tests that cover them, is in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## What is out of scope

- **Rule accuracy.** A missed hazard or a false positive is a bug, not a
  vulnerability. Open a normal issue.
- **Skerry not preventing an attack on your repository.** Skerry checks that
  filenames are portable. It is not a security control, and a clean run
  establishes nothing about whether a repository is safe. SK009, SK010 and
  SK011 report hazard *shapes* and do not claim exploitability.
- **The `git` binary or the runner image.** Skerry trusts the git already on
  the runner's `PATH`.
- **Untrusted expressions interpolated into workflow inputs by the caller.**
  Action inputs come from the workflow author and are treated as trusted but
  validated. The standard warning about interpolating untrusted expressions
  into a workflow applies to Skerry exactly as it does to every other Action.

## Design notes relevant to security

- Zero runtime dependencies. No transitive packages, no bundled `dist/`. The
  published source is the running source.
- No network access of any kind, at any point.
- No shell. `git` is invoked with an argument array; the scan directory is
  passed as `cwd`, never as an argument.
- No scanned repository file is opened for reading. Skerry sees its path name,
  not its contents. The explicit `list` source reads the path manifest supplied
  by the caller.
- No `GITHUB_TOKEN` is read and no GitHub API call is made.
