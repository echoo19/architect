import type { ExportFinding } from '@architect/shared';

/**
 * A best-effort look through text that is about to leave this computer, for keys and for paths
 * that name a person or this machine. It can't prove a file is clean; it catches the obvious.
 */
export interface ScanOptions {
  /** Values of keys stored in the app; found anywhere, they are reported without the value. */
  storedKeys: readonly string[];
  /** Folders on this computer that should never appear, such as the home and app data folders. */
  privateFolders: readonly string[];
}

/** Shapes of well-known credentials. */
const KEY_SHAPES: readonly RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g,
  /\b(?:api[_-]?key|secret|token|password)\b\s*(?:["']\s*)?[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}/gi,
];

/**
 * Paths that name someone's own folders on Windows, macOS or Linux, or a network share, also as
 * JSON writes them, with every backslash doubled.
 */
const PRIVATE_PATHS: readonly RegExp[] = [
  /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'`]+/g,
  /(?:^|[\s"'`(=])\/(?:Users|home)\/[^/\s"'`]+/g,
  /\\{2,}[A-Za-z0-9._-]+\\+[A-Za-z0-9.$_-]+/g,
];

/** Patterns look at this much of a line; stored keys are found anywhere in it. */
const SCANNED_LINE_CHARS = 16_384;

/** The line with every match masked, short enough to show. */
function masked(line: string, spans: readonly [number, number][]): string {
  const merged: [number, number][] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let text = line;
  for (const [start, end] of merged.reverse()) {
    text = `${text.slice(0, start)}[redacted]${text.slice(end)}`;
  }
  const trimmed = text.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Both slash directions and any letter case, since a path is written many ways. */
function folderPattern(folder: string): RegExp {
  const parts = folder
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  return new RegExp(parts.join('[\\\\/]+'), 'gi');
}

/**
 * Findings in one text file, at most one per kind per line. Every excerpt masks everything found
 * on its line, of any kind, so no finding shows another.
 */
export function scanText(path: string, text: string, options: ScanOptions): ExportFinding[] {
  const keys = options.storedKeys.filter((key) => key.length >= 8);
  const folders = options.privateFolders
    .filter((folder) => folder.split(/[\\/]+/).filter(Boolean).length >= 2)
    .map(folderPattern);
  const findings: ExportFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const head = line.slice(0, SCANNED_LINE_CHARS);
    const stored: [number, number][] = [];
    for (const key of keys) {
      for (let at = line.indexOf(key); at >= 0; at = line.indexOf(key, at + key.length)) {
        stored.push([at, at + key.length]);
      }
    }
    const found: [ExportFinding['kind'], [number, number][]][] = [
      ['stored_key', stored],
      ['key_shape', spansOf(head, KEY_SHAPES)],
      ['private_path', spansOf(head, [...PRIVATE_PATHS, ...folders])],
    ];
    const everything = found.flatMap(([, spans]) => spans);
    for (const [kind, spans] of found) {
      if (spans.length === 0) continue;
      findings.push({ path, line: index + 1, kind, excerpt: masked(line, everything) });
    }
  });
  return findings;
}

function spansOf(line: string, patterns: readonly RegExp[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
}

/** Whether a file's bytes are text worth scanning: no NUL bytes in its first few kilobytes. */
export function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}
