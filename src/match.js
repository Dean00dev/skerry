'use strict';

/**
 * A deliberately small path matcher for the `ignore` input.
 *
 * Supported syntax (and nothing else):
 *   *   matches any run of characters except '/'
 *   **  matches any run of characters including '/'
 *   ?   matches exactly one character except '/'
 *   everything else is a literal
 *
 * A pattern ending in '/' matches the directory prefix and everything under it.
 * A pattern with no '/' at all is matched against the basename as well as the
 * full path, so `*.png` behaves the way people expect.
 *
 * Patterns are user input. The grammar above compiles to a regular expression
 * built only from `[^/]`, `[^/]*` and `.*`, with every other character escaped,
 * so no nested quantifier ambiguity is possible. Pattern length and count are
 * also capped.
 */

const MAX_PATTERN_LENGTH = 512;
const MAX_PATTERNS = 200;

class PatternError extends Error {}

function escapeLiteral(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePattern(pattern) {
  if (typeof pattern !== 'string') {
    throw new PatternError('ignore pattern must be a string');
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new PatternError(
      `ignore pattern exceeds ${MAX_PATTERN_LENGTH} characters`
    );
  }
  if (pattern.includes('\u0000')) {
    throw new PatternError('ignore pattern contains a NUL character');
  }

  let body = pattern;
  let dirOnly = false;
  if (body.endsWith('/')) {
    dirOnly = true;
    body = body.slice(0, -1);
  }
  if (body.startsWith('./')) body = body.slice(2);
  if (body.startsWith('/')) body = body.slice(1);

  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        // Collapse any run of '*' of length >= 2 into a single '.*'
        while (body[i + 1] === '*') i += 1;
        out += '.*';
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeLiteral(ch);
    }
  }

  if (dirOnly) out += '(?:/.*)?';

  const anchored = new RegExp(`^${out}$`);
  const basenameOnly = !body.includes('/');
  return { source: pattern, regex: anchored, basenameOnly, dirOnly };
}

function compileAll(patterns) {
  if (patterns.length > MAX_PATTERNS) {
    throw new PatternError(`too many ignore patterns (limit ${MAX_PATTERNS})`);
  }
  return patterns.map(compilePattern);
}

/**
 * @param {{regex: RegExp, basenameOnly: boolean}[]} compiled
 * @param {string} path repository-relative, '/' separated
 */
function matchesAny(compiled, path) {
  if (compiled.length === 0) return false;
  const slash = path.lastIndexOf('/');
  const base = slash === -1 ? path : path.slice(slash + 1);
  for (const c of compiled) {
    if (c.regex.test(path)) return true;
    if (c.basenameOnly && c.regex.test(base)) return true;
  }
  return false;
}

/**
 * Split a raw `ignore` input into patterns. Newline separated; commas are also
 * accepted because that is what people type. Blank lines and lines beginning
 * with '#' are dropped.
 */
function parsePatternList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

module.exports = {
  PatternError,
  compilePattern,
  compileAll,
  matchesAny,
  parsePatternList,
  MAX_PATTERN_LENGTH,
  MAX_PATTERNS,
};
