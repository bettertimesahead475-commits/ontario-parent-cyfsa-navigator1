// Shared parsing for engineering/TASK_REGISTER.md. Fails closed: a row that might be a P0 but cannot be read
// cleanly is returned as an unknown-status P0, which the gate and the release check both treat as open.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');
export const REGISTER = resolve(REPO_ROOT, 'engineering/TASK_REGISTER.md');
export const CODE_PATHS = ['src', 'api', 'functions', 'workers', 'shared'];

/** Splits a markdown table row on `|`, ignoring pipes inside backticks. Returns trimmed cells. */
export function splitCells(line) {
  const cells = [];
  let current = '';
  let inCode = false;
  for (const ch of line) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  // A row like "| a | b |" yields ['', 'a', 'b', ''].
  return cells.map((c) => c.trim());
}

const strip = (s) => (s ?? '').replace(/[*`]/g, '').trim();

/** Normalised status: lower-case first word (so "Done (2026-11-28)" -> "done", "in progress" -> "in"). */
export function normaliseStatus(raw) {
  const m = /^[a-z]+/.exec(strip(raw).toLowerCase());
  return m ? m[0] : '';
}

/**
 * Parses register rows. A row is included when its ID is T-<n> after stripping decoration, or when its priority is P0
 * (so a malformed P0 is still visible). Unknown or missing status is returned as '' and must be treated as open.
 */
export function parseRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = splitCells(line);
    // cells[0] and the last cell are the empty edges of the table row.
    const body = cells.slice(1, cells.length - 1);
    if (body.length < 2) continue;
    const id = strip(body[0]).replace(/\s+/g, '');
    const pri = strip(body[1]).toUpperCase().replace(/\s+/g, '');
    const looksLikeId = /^T-\d+$/.test(id);
    if (!looksLikeId && pri !== 'P0') continue;
    const rawStatus = strip(body[4]);
    rows.push({ id: id || '(unparsed)', pri, task: body[2] ?? '', status: normaliseStatus(rawStatus), rawStatus });
  }
  return rows;
}

export function p0Rows(text) {
  return parseRows(text).filter((r) => r.pri === 'P0');
}
