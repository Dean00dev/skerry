'use strict';

/**
 * Skerry — shared constants and the rule catalogue.
 *
 * Every rule has a stable id. Ids are part of the public contract: they are
 * never reused or renumbered. New rules are added at the end.
 */

const VERSION = '1.1.0';
const TOOL_NAME = 'Skerry';
const REPORT_SCHEMA = 'skerry-report/1';

const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  NOTICE: 'notice',
});

const SEVERITY_RANK = Object.freeze({ notice: 0, warning: 1, error: 2 });

/** Exit codes. Documented in README.md and docs/DESIGN.md. */
const EXIT = Object.freeze({
  OK: 0,
  FINDINGS: 1,
  USAGE: 2,
  INTERNAL: 3,
});

const RULES = Object.freeze({
  SK001: {
    id: 'SK001',
    name: 'case-collision',
    severity: SEVERITY.ERROR,
    summary: 'Two sibling paths differ only by letter case.',
    help: 'On Windows (NTFS) and default macOS (APFS) filesystems only one of these can exist. git will warn at clone time and silently drop the rest.',
  },
  SK002: {
    id: 'SK002',
    name: 'normalization-collision',
    severity: SEVERITY.ERROR,
    summary: 'Two sibling paths differ only by Unicode normalization form.',
    help: 'macOS filesystems treat NFC and NFD spellings of the same name as one file. One of these paths will be unreachable there.',
  },
  SK003: {
    id: 'SK003',
    name: 'non-nfc-name',
    severity: SEVERITY.WARNING,
    summary: 'Path segment is not in Unicode NFC form.',
    help: 'macOS may present a different byte spelling than the one stored in git, producing phantom modifications in git status.',
  },
  SK004: {
    id: 'SK004',
    name: 'windows-reserved-name',
    severity: SEVERITY.ERROR,
    summary: 'Path segment uses a Windows reserved device name.',
    help: 'Windows refuses to create files or directories named CON, PRN, AUX, NUL, COM1-9 or LPT1-9, with or without an extension. Checkout and pull fail with "invalid path".',
  },
  SK005: {
    id: 'SK005',
    name: 'windows-illegal-character',
    severity: SEVERITY.ERROR,
    summary: 'Path segment contains a character Windows cannot store.',
    help: 'The characters < > : " \\ | ? * and control characters U+0000-U+001F are rejected by Windows filesystems.',
  },
  SK006: {
    id: 'SK006',
    name: 'trailing-dot-or-space',
    severity: SEVERITY.ERROR,
    summary: 'Path segment ends with a dot or a space.',
    help: 'Windows silently strips trailing dots and spaces, which either fails the checkout or collides with the stripped name.',
  },
  SK007: {
    id: 'SK007',
    name: 'leading-space',
    severity: SEVERITY.WARNING,
    summary: 'Path segment begins with a space.',
    help: 'Legal on most filesystems but easy to mistype, easy to lose in shell pipelines, and frequently a copy-paste accident.',
  },
  SK008: {
    id: 'SK008',
    name: 'path-too-long',
    severity: SEVERITY.WARNING,
    summary: 'Repository-relative path is long enough to risk the Windows path limit.',
    help: 'Windows MAX_PATH is 260 characters including the clone directory. This is a heuristic: the real limit depends on where the repository is cloned and whether long paths are enabled.',
  },
  SK009: {
    id: 'SK009',
    name: 'bidi-control-character',
    severity: SEVERITY.ERROR,
    summary: 'Path contains a bidirectional override, isolate or Unicode tag character.',
    help: 'These characters reorder or hide text when displayed, so the name shown in a review is not the name on disk. There is no legitimate filename use.',
  },
  SK010: {
    id: 'SK010',
    name: 'symlink-in-collision',
    severity: SEVERITY.ERROR,
    summary: 'A symbolic link takes part in a case or normalization collision.',
    help: 'This is the shape behind documented clone-time name-collision hazards. Skerry reports the shape; it is not a security control and does not prove exploitability.',
  },
  SK011: {
    id: 'SK011',
    name: 'invisible-character',
    severity: SEVERITY.WARNING,
    summary: 'Path contains a zero-width or invisible formatting character.',
    help: 'Legitimate in some scripts, but invisible in review. U+200D ZERO WIDTH JOINER is deliberately excluded because emoji sequences require it.',
  },
  SK012: {
    id: 'SK012',
    name: 'ref-name-hazard',
    severity: SEVERITY.ERROR,
    summary: 'A branch or tag name cannot be represented on a Windows filesystem.',
    help: 'Git stores refs as files. Names containing a reserved device component or < > " | cannot be represented by Windows.',
  },
  SK013: {
    id: 'SK013',
    name: 'ref-case-collision',
    severity: SEVERITY.ERROR,
    summary: 'Two branch or tag names differ only by case or Unicode normalization.',
    help: 'Within the same ref namespace, case-insensitive or normalization-insensitive filesystems cannot represent both names reliably.',
  },
});

const RULE_IDS = Object.freeze(Object.keys(RULES));

/** Characters Git permits in refs that Windows filesystems reject. */
const REF_ILLEGAL_CHARS = Object.freeze(new Set(['<', '>', '"', '|']));

/**
 * Windows reserved device base names, upper case.
 * Includes the superscript digit variants Windows also reserves.
 */
const WINDOWS_RESERVED = Object.freeze(new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'COM\u00B9', 'COM\u00B2', 'COM\u00B3',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'LPT\u00B9', 'LPT\u00B2', 'LPT\u00B3',
]));

/** Characters Windows filesystems reject outright (path separator excluded). */
const WINDOWS_ILLEGAL_CHARS = Object.freeze(new Set(['<', '>', ':', '"', '\\', '|', '?', '*']));

/**
 * Bidirectional overrides, isolates, and Unicode tag characters.
 * Treated as errors: no legitimate filename use, actively deceptive.
 */
function isBidiControl(cp) {
  return (
    cp === 0x061c ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/**
 * Zero-width and invisible formatting characters. Treated as warnings.
 * U+200D (ZWJ) is intentionally NOT included: emoji sequences require it.
 */
function isInvisibleFormat(cp) {
  return (
    cp === 0x00ad ||
    cp === 0x180e ||
    cp === 0x200b ||
    cp === 0x200c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0xfeff
  );
}

function isControlChar(cp) {
  return cp <= 0x1f;
}

module.exports = {
  VERSION,
  TOOL_NAME,
  REPORT_SCHEMA,
  SEVERITY,
  SEVERITY_RANK,
  EXIT,
  RULES,
  RULE_IDS,
  WINDOWS_RESERVED,
  WINDOWS_ILLEGAL_CHARS,
  REF_ILLEGAL_CHARS,
  isBidiControl,
  isInvisibleFormat,
  isControlChar,
};
