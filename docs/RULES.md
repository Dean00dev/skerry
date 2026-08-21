# Rules

Every rule has a stable id. Ids are never reused and never renumbered. Rules added in a minor release must be off by default, so an existing pinned workflow cannot change result without opting in.

Each entry below says what fires, why it matters, and — importantly — when the rule is wrong.

---

## SK001 · case-collision · error

**Fires when** two sibling paths under the same parent directory are identical after case folding but differ in their stored bytes.

**Why** Windows NTFS and default macOS APFS are case-insensitive. Only one of the colliding names can exist. Git warns during clone that paths collided and that only one of the group is in the working tree — the rest silently do not appear. Contributors then see phantom missing files, failed imports, and broken builds that reproduce on no Linux machine anywhere.

This applies at every level of the path, so `src/Utils/a.js` and `src/utils/b.js` collide on the directory `Utils`, not on the files. Skerry reports the directory once rather than once per file inside it.

**When it is wrong** Linux-only projects sometimes contain deliberate case collisions. The Linux kernel is the obvious example. If that is you, `disable: SK001` or ignore the relevant paths.

---

## SK002 · normalization-collision · error

**Fires when** two sibling paths are identical after Unicode NFC normalization but stored as different byte sequences — typically one precomposed (`é` as U+00E9) and one decomposed (`e` + U+0301).

**Why** macOS filesystems treat these as the same file. One of the two becomes unreachable there.

Because both names print identically, the message spells out the differing code points:

```
These names are identical after Unicode NFC normalization but stored differently:
"cafe<U+0301>.md" vs "caf<U+00E9>.md"
```

**When it is wrong** Rarely, but the underlying behaviour varies between HFS+ and APFS and across macOS versions. SK002 identifies the hazard shape. It does not prove what a specific machine will do.

---

## SK003 · non-nfc-name · warning

**Fires when** a path segment is not in Unicode NFC form.

**Why** A file created on macOS may be stored decomposed. Other tools normalise to NFC. The result is a file that shows as modified in `git status` with no visible difference, repeatedly, for one person on the team.

**When it is wrong** This is the noisiest rule in the set, and it is a warning for that reason. A repository that deliberately stores decomposed names, or that was created that way and works fine, can `disable: SK003` without losing much.

---

## SK004 · windows-reserved-name · error

**Fires when** a path segment's base name — everything before the first dot — case-insensitively matches a Windows reserved device name: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, and the superscript variants `COM¹²³` and `LPT¹²³`.

**Why** Windows refuses to create these names, with or without an extension, as files or as directories. `git pull` fails with `invalid path`, and the fix usually requires history surgery. This has become noticeably more common since AI coding agents started generating filenames unattended.

**Base name semantics** `NUL.txt` fires. `nullable.ts` does not. `NUL:x.txt` does not fire on SK004 — the colon makes it an SK005 problem instead. This matches established prior art rather than inventing a new interpretation.

**When it is wrong** Almost never. If a Linux-only project genuinely needs a file called `aux.c`, disable the rule deliberately.

---

## SK005 · windows-illegal-character · error

**Fires when** a path segment contains `<`, `>`, `:`, `"`, `\`, `|`, `?`, `*`, or any control character in U+0000–U+001F.

**Why** Windows filesystems reject all of them. A colon additionally has alternate-data-stream meaning on NTFS.

Note that `/` is the path separator in a git path and is therefore never part of a segment. A literal backslash inside a name is flagged because Windows would read it as a separator.

**When it is wrong** It is not. These characters do not work on Windows.

---

## SK006 · trailing-dot-or-space · error

**Fires when** a path segment ends with `.` or a space.

**Why** Windows silently strips both. `report.` becomes `report`, which either fails the checkout or collides with a real `report`. The silent part is what makes it nasty: nothing errors, the file is just subtly not where it was.

**When it is wrong** It is not, on any repository that Windows users touch.

---

## SK007 · leading-space · warning

**Fires when** a path segment begins with a space.

**Why** Legal nearly everywhere, but almost always a copy-paste accident, and it breaks naive shell pipelines and scripts throughout the ecosystem.

**When it is wrong** If leading spaces are intentional in your data fixtures, disable it.

---

## SK008 · path-too-long · warning

**Fires when** a repository-relative leaf path is at or above `max-path-length` characters. Default 200.

**Why** Windows `MAX_PATH` is 260 characters *including* the clone directory. A repository-relative path of 200 leaves roughly 60 characters for `C:\Users\someone\projects\`, which is tight but typical.

**This is a heuristic and the documentation says so.** The real limit depends on where the repository is cloned and whether long path support is enabled. Set `max-path-length: 0` to switch it off, or tune it to your own worst case.

---

## SK009 · bidi-control-character · error

**Fires when** a path contains a bidirectional override or embedding (U+202A–U+202E), a bidirectional isolate (U+2066–U+2069), the Arabic letter mark (U+061C), or a Unicode tag character (U+E0000–U+E007F).

**Why** These reorder or hide text when rendered. A file displayed in review as `invoice.pdf` can be `invoicefdp.exe` on disk. There is no legitimate reason for a filename to contain one.

**Relationship to Trojan Source** That research concerns bidirectional characters inside *source code*. Skerry only sees names, so this is the filename-shaped cousin of the same idea. It is not a defence against the original attack.

**When it is wrong** Not in a filename.

---

## SK010 · symlink-in-collision · error

**Fires when** a path taking part in an SK001 or SK002 collision is a symbolic link, according to git file mode `120000`.

**Why** A symlink colliding by case with a directory is the documented shape behind clone-time name-collision hazards on case-insensitive filesystems. Skerry reports the shape.

**What this does not claim** It does not prove exploitability, it does not identify a vulnerability, and a clean run proves nothing about your repository's security. It is a hazard indicator, and it is reported separately from SK001 so it can be tuned independently.

Requires file modes, so it is available from the `git` and `fs` sources, and from `list` when the manifest carries a mode prefix.

---

## SK011 · invisible-character · warning

**Fires when** a path contains a zero-width or invisible formatting character: U+00AD, U+180E, U+200B, U+200C, U+200E, U+200F, U+2060–U+2064, or U+FEFF.

**Why** Invisible in review, and a source of names that cannot be typed or matched.

**U+200D is deliberately excluded.** The zero width joiner is required by emoji sequences, so a filename such as `family-👨‍👩‍👧.png` is legitimate and must not be flagged. There is a test that keeps it that way.

**When it is wrong** Some scripts legitimately use U+200C. That is why this is a warning rather than an error.

---

## SK012 · ref-name-hazard · error · opt-in

**Fires when** a locally available branch or tag has a component matching a
Windows reserved device name, contains `<`, `>`, `"` or `|`, or ends in a dot
or space. Git permits these shapes even though Windows cannot store the ref
file reliably.

**Why** Git represents branches and tags below its ref namespace. A contributor
can therefore create a branch that is legal to Git but unusable on Windows.

**Boundaries** Enable with `check-refs: true`. Skerry makes no network request
and sees only refs present in the checkout plus the pull-request head exposed by
the runner. Git already rejects other illegal ref characters. `COM0` and `LPT0`
are not treated as reserved device names because Windows does not reserve them.

## SK013 · ref-case-collision · error · opt-in

**Fires when** two local branches, or two local tags, are identical after NFC
normalization and lower-casing but have different stored names.

**Why** Case-insensitive or normalization-insensitive filesystems cannot
reliably represent both ref files.

**Boundaries** Branches are compared with branches and tags with tags; an
ordinary branch and tag sharing a name are separate namespaces and do not
collide. The Unicode folding approximation has the same limitations as SK001
and SK002. Enable with `check-refs: true`.

## Severity and thresholds

| Severity | Default behaviour |
| --- | --- |
| error | Fails the step |
| warning | Reported, does not fail |
| notice | Informational only |

`fail-on: warning` promotes warnings to failures. `fail-on: never` reports everything and always exits 0, which is useful when you want the counts as a step output without gating the build.
