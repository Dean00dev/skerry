# Fixtures

Skerry's failing fixtures are **path manifests**, not real files.

That is deliberate. Skerry exists because some paths cannot be checked out on
Windows or macOS. If this repository actually contained a file called `NUL.txt`
or a case collision, Skerry's own repository would be unclonable on exactly the
platforms it protects — and every contributor on Windows would hit the bug the
tool is meant to prevent.

So the hazardous paths live inside text files as data. The scanner in
`src/scan.js` is a pure function over a path list and cannot tell the
difference between a manifest and a real checkout.

Real hazardous files *are* created during testing, in a throwaway directory
under the system temp path, and only on platforms that can represent them.
See `test/e2e.test.js`.

## Manifest format

One repository-relative path per line. Blank lines and lines starting with `#`
are ignored. An optional git file mode may precede the path, separated by a
tab, so symlink rules can be exercised:

```
120000	docs/Link
```

## Files

| File | Rules it should trigger |
| --- | --- |
| `safe/paths.txt` | none |
| `unsafe/case-collision.txt` | SK001 |
| `unsafe/unicode-collision.txt` | SK002, SK003 |
| `unsafe/windows-reserved.txt` | SK004 |
| `unsafe/illegal-characters.txt` | SK005 |
| `unsafe/trailing-and-leading.txt` | SK006, SK007 |
| `unsafe/long-path.txt` | SK008 |
| `unsafe/deceptive.txt` | SK009, SK011 |
| `unsafe/symlink-collision.txt` | SK001, SK010 |
| `unsafe/injection.txt` | SK005 and friends, plus proof that the output cannot be hijacked |
