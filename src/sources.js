'use strict';

/**
 * Skerry — where the path list comes from.
 *
 * Three sources, in order of preference:
 *   git   `git ls-files -s -z` — the index, including file modes
 *   fs    a bounded recursive directory walk
 *   list  a newline-separated manifest of paths (used by the test suite and by
 *         anyone who wants to check a path list without a checkout)
 *
 * The git and filesystem sources never open scanned files for reading. The
 * explicit list source reads the caller-supplied manifest, whose contents are
 * the path names to scan.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_ENTRIES = 500000;
const MAX_DEPTH = 100;
const GIT_BUFFER_BYTES = 256 * 1024 * 1024;
const LIST_BUFFER_BYTES = 256 * 1024 * 1024;

class SourceError extends Error {}

/**
 * git is invoked with execFileSync and an argument array. There is no shell,
 * so repository content cannot reach a command line. The scan directory is
 * passed as `cwd` rather than as an argument, so a directory whose name starts
 * with '-' cannot be read as a git option.
 */
function entryLimitError(maxEntries) {
  return new SourceError(
    `path source exceeds the safety limit of ${maxEntries} entries; refusing to report on an incomplete scan`
  );
}

function pathDepth(filePath) {
  let depth = 0;
  for (const ch of filePath) if (ch === '/') depth += 1;
  return depth;
}

function pushEntry(entries, entry, maxEntries, maxDepth = MAX_DEPTH) {
  if (entries.length >= maxEntries) throw entryLimitError(maxEntries);
  if (pathDepth(entry.path) > maxDepth) {
    throw new SourceError(
      `path source exceeds the safety limit of ${maxDepth} directory levels; refusing to report on an incomplete scan`
    );
  }
  entries.push(entry);
}

function fromGit(dir, maxEntries = MAX_ENTRIES, maxDepth = MAX_DEPTH) {
  let stdout;
  try {
    stdout = execFileSync('git', ['ls-files', '-s', '-z'], {
      cwd: dir,
      encoding: 'buffer',
      maxBuffer: GIT_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    throw new SourceError(`git ls-files failed: ${shortError(err)}`);
  }

  const text = stdout.toString('utf8');
  const entries = [];
  for (const record of text.split('\u0000')) {
    if (record.length === 0) continue;
    // Format: <mode> <object> <stage>\t<path>
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const meta = record.slice(0, tab);
    const filePath = record.slice(tab + 1);
    const mode = meta.split(' ')[0] || null;
    if (filePath.length === 0) continue;
    pushEntry(entries, { path: filePath, mode }, maxEntries, maxDepth);
  }
  return { entries, source: 'git' };
}

function gitAvailable(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bounded walk. Symlinks are recorded but never followed, so a symlink loop or
 * a link pointing outside the tree cannot cause runaway traversal.
 */
function fromFs(dir, maxEntries = MAX_ENTRIES, maxDepth = MAX_DEPTH) {
  const entries = [];
  const stack = [{ abs: dir, rel: '', depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    let directory;
    try {
      directory = fs.opendirSync(current.abs);
    } catch (err) {
      throw new SourceError(`cannot read directory: ${shortError(err)}`);
    }

    try {
      let dirent;
      while ((dirent = directory.readSync()) !== null) {
        const rel = current.rel === '' ? dirent.name : `${current.rel}/${dirent.name}`;
        const abs = path.join(current.abs, dirent.name);
        if (current.rel === '' && dirent.name === '.git') continue;

        // Node 20 on Windows can classify a directory symlink/junction as a
        // directory in Dirent. lstat is authoritative and prevents following
        // a reparse point into a loop or outside the requested tree.
        let stat;
        try {
          stat = fs.lstatSync(abs);
        } catch (err) {
          throw new SourceError(`cannot inspect path: ${shortError(err)}`);
        }

        if (stat.isSymbolicLink()) {
          pushEntry(entries, { path: rel, mode: '120000' }, maxEntries, maxDepth);
        } else if (stat.isDirectory()) {
          if (current.depth >= maxDepth) {
            throw new SourceError(
              `filesystem tree exceeds the safety limit of ${maxDepth} directory levels; refusing to report on an incomplete scan`
            );
          }
          stack.push({ abs, rel, depth: current.depth + 1 });
        } else {
          pushEntry(entries, { path: rel, mode: '100644' }, maxEntries, maxDepth);
        }
      }
    } finally {
      directory.closeSync();
    }
  }
  return { entries, source: 'fs' };
}

function fromList(
  file,
  maxEntries = MAX_ENTRIES,
  maxDepth = MAX_DEPTH,
  maxBytes = LIST_BUFFER_BYTES
) {
  let raw;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new SourceError('paths-file must be a regular file');
    if (stat.size > maxBytes) {
      throw new SourceError(`paths-file exceeds the safety limit of ${maxBytes} bytes`);
    }
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(`cannot read paths-file: ${shortError(err)}`);
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    // Optional "<mode>\t<path>" form so manifests can exercise symlink rules.
    const tab = trimmed.indexOf('\t');
    if (tab !== -1) {
      pushEntry(
        entries,
        { path: trimmed.slice(tab + 1), mode: trimmed.slice(0, tab) },
        maxEntries,
        maxDepth
      );
    } else {
      pushEntry(entries, { path: trimmed, mode: null }, maxEntries, maxDepth);
    }
  }
  return { entries, source: 'list' };
}

/** Keep error text short and free of environment detail. */
function shortError(err) {
  const msg = (err && err.message) || String(err);
  return msg.split('\n')[0].slice(0, 200);
}

/**
 * @param {{source: string, dir: string, pathsFile?: string}} options
 */
function collect(options) {
  const { source, dir, pathsFile } = options;

  if (source === 'list') {
    if (!pathsFile) throw new SourceError("source 'list' requires paths-file");
    return fromList(pathsFile);
  }

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    throw new SourceError(`path does not exist or is not readable: ${shortError(err)}`);
  }
  if (!stat.isDirectory()) {
    throw new SourceError('path must be a directory');
  }

  if (source === 'git') {
    if (!gitAvailable(dir)) {
      throw new SourceError("source 'git' requested but this is not a git work tree (or git is unavailable)");
    }
    return fromGit(dir);
  }
  if (source === 'fs') return fromFs(dir);

  // auto
  if (gitAvailable(dir)) {
    // Once a git work tree has been selected, any collection error is fatal.
    // Falling back could otherwise turn a partial git scan into a green
    // filesystem scan (for example in a sparse checkout).
    return fromGit(dir);
  }
  const result = fromFs(dir);
  result.fellBack = true;
  return result;
}

module.exports = {
  collect,
  fromGit,
  fromFs,
  fromList,
  gitAvailable,
  SourceError,
  MAX_ENTRIES,
  MAX_DEPTH,
  LIST_BUFFER_BYTES,
};
