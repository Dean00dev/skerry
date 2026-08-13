# Contributing

Thanks for looking. Bug reports and rule corrections are the most useful things
you can bring.

## Before you start

Run the gates:

```bash
npm test      # the full test suite
npm run check # metadata consistency and a credential scan
npm run self  # Skerry against its own repository, strictest setting
```

No installation step. There are no dependencies, so `npm install` does nothing.
Node 20 or newer.

## The rule that governs everything else

**Never commit a real hazardous filename to this repository.**

Skerry exists because some paths cannot be checked out on Windows and macOS.
A real `NUL.txt` or a real case collision here would make Skerry's own
repository unclonable on exactly the platforms it protects.

Hazardous examples go in `fixtures/unsafe/*.txt` as *path manifests* — the
paths live inside a text file as data. The scanner is a pure function over a
path list and cannot tell the difference.

If you need a real hazardous file, create it in a temp directory at test time,
after probing whether the host filesystem can represent it. `test/e2e.test.js`
shows the pattern.

CI runs Skerry against its own repository at `fail-on: warning` and will catch
you if you forget.

## Reporting a false positive

This is the most valuable report. Include:

1. The exact path, as a manifest line
2. The rule id that fired
3. Why the name is legitimate

A rule that fires on legitimate names is worse than no rule. U+200D is excluded
from SK011 precisely because emoji sequences need it, and that exclusion exists
because false positives were taken seriously.

## Adding a rule

1. Add it to `RULES` in `src/constants.js` with the next free id. Ids are never
   reused or renumbered.
2. Implement it in `segmentFindings` or `collisionFindings` in `src/scan.js`.
3. Add a fixture manifest under `fixtures/unsafe/` and register it in
   `test/fixtures.test.js`.
4. Add positive **and negative** tests. The negative ones matter more.
5. Document it in `docs/RULES.md` including a "when it is wrong" section, and
   add it to the README table.
6. Run `npm run verify`. The metadata checker fails if a rule is undocumented.

New rules change results for existing users, so they ship only in a major
version.

## Code style

- CommonJS, `'use strict'`, Node standard library only
- **No dependencies.** A pull request adding one needs to argue for it against
  the supply-chain cost of running inside other people's CI
- No build step, no bundler, no `dist/`. The published source is the running
  source
- Comments explain why, not what

## Things likely to be declined

- Full gitignore semantics for `ignore`. Negation and nested precedence are a
  project in themselves, and implementing them *almost* correctly produces a
  tool that silently skips files people believe are checked.
- Homoglyph or confusable detection. It produces false positives on legitimate
  internationalised names.
- Reading file contents. Skerry sees names. That boundary is the design.
- Anything requiring a token, a network call, or a hosted service.

## Provenance

This project was conceived and directed by Dean Egan and implemented through an
AI-assisted build workflow with Claude (Anthropic), then independently reviewed
and integrated with assistance from ChatGPT (OpenAI) before publication.

If you use an AI assistant for a contribution, say so in the pull request. It
is not a problem; an undisclosed one is.
