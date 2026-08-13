# Marketplace listing copy

Everything a listing needs, ready to paste. Nothing here has been submitted to
GitHub.

## Listing title

```
Skerry
```

The Marketplace name must be unique across all listings and must not collide
with an existing GitHub user or organisation name. This cannot be confirmed
until the draft release form is opened. If GitHub rejects it, use the first
fallback that is accepted, and change `name:` in `action.yml` to match:

1. `Skerry`
2. `Skerry Filename Guard`
3. `Skerry Path Audit`

The repository name stays `skerry` either way.

## Short description

Used as the `description:` in `action.yml` and shown under the title.

```
Fail the build when a filename cannot be checked out safely on Windows or macOS. Never reads scanned file contents.
```

124 characters.

## Categories

| Slot | Category |
| --- | --- |
| Primary | Code quality |
| Secondary | Utilities |

**Security is deliberately not chosen.** Three rules touch a security-adjacent
hazard class, but Skerry is not a security control and listing it as one would
be an inflated claim.

## Icon and colour

Set in `action.yml`:

```yaml
branding:
  icon: 'anchor'
  color: 'blue'
```

Marketplace renders the Feather icon named in `branding`, not an image file.
`assets/skerry-logo.svg` is for the README and for social previews.

## Long description

The Marketplace listing body is taken from `README.md` automatically. No
separate copy is needed.

## Release title

```
v1.0.0 — Skerry: first release
```

## Release notes

```markdown
Skerry fails your build when a filename cannot be checked out safely on Windows
or macOS. It reads path names only and never opens a scanned repository file.

## Why

Someone opens a pull request adding `src/Utils/config.json`. Your repository
already has `src/utils/config.json`. CI is green. It merges. Every contributor
on Windows and most on macOS now silently gets one of those two files, chosen
for them by their filesystem.

Skerry catches that in the pull request, where it is a one-line fix.

## Usage

```yaml
- uses: actions/checkout@v6
- uses: Dean00dev/skerry@v1
```

No token, no secrets, no network calls, no runtime dependencies.

## What it checks

Eleven rules with stable ids:

- `SK001` case collisions, at file and directory level
- `SK002` Unicode normalization collisions
- `SK003` names not in NFC form
- `SK004` Windows reserved device names: `nul`, `CON`, `com1`, `LPT9`
- `SK005` characters Windows cannot store
- `SK006` trailing dots and spaces
- `SK007` leading spaces
- `SK008` paths long enough to risk the Windows 260 character limit
- `SK009` bidirectional overrides and Unicode tag characters
- `SK010` symlinks taking part in a collision
- `SK011` zero-width and invisible characters

Full descriptions, including when each rule is wrong, are in `docs/RULES.md`.

## Honest scope

- Skerry checks that filenames are portable. It is not a security tool, and a
  clean run establishes nothing about whether a repository is safe.
- Case folding and Unicode normalization are approximations of what real
  filesystems do. A reported collision is a collision on most systems, not
  provably a collision on all of them.
- `max-path-length` is a heuristic, not a measurement.
- Only tracked, checked-out paths are visible. Submodule interiors, ignored
  files and branch names are not checked.
- Prior art exists and is credited in the README. `pre-commit-hooks` has
  shipped `check-case-conflict` and `check-illegal-windows-names` for years.

## Verification

169 automated tests pass locally and on GitHub's Ubuntu, macOS and Windows
runners with Node 20, 22 and 24. Live jobs also run the Action against clean and
hazardous inputs and consume its outputs downstream. `VERIFICATION.md` links the
successful run and separates demonstrated behaviour from the remaining gaps.

## Provenance

Conceived and directed by Dean Egan, implemented through an AI-assisted build
workflow with Claude (Anthropic), then independently reviewed and integrated
with assistance from ChatGPT (OpenAI). Dean Egan is the accountable repository
owner. No company endorses this project.

MIT licensed.
```

## Topics to add to the repository

```
github-actions  ci  filenames  cross-platform  windows  macos  unicode
repository-hygiene  developer-tools  portability
```
