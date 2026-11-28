import { describe, expect, it } from 'vitest';
import { parseRows, p0Rows, splitCells, normaliseStatus } from '../../scripts/register-lib.mjs';

const row = (id: string, pri: string, task: string, status: string) => `| ${id} | ${pri} | ${task} | Claude | ${status} | | note |`;

describe('register parser (fails closed)', () => {
  it('ignores pipes inside backticks, so the status column is not shifted', () => {
    const text = row('T-90', 'P0', 'Fix `a|b` parser', 'todo');
    const [r] = p0Rows(text);
    expect(r.status).toBe('todo');
    expect(r.id).toBe('T-90');
  });

  it('normalises case and decoration in the status', () => {
    expect(normaliseStatus('Todo')).toBe('todo');
    expect(normaliseStatus('**done** (2026-11-28)')).toBe('done');
    expect(normaliseStatus('in progress')).toBe('in');
    expect(normaliseStatus('')).toBe('');
  });

  it('reads a bold or decorated ID so an open P0 is not invisible', () => {
    const [r] = p0Rows(row('**T-93**', 'P0', 'x', 'todo'));
    expect(r.id).toBe('T-93');
    expect(r.status).toBe('todo');
  });

  it('keeps a malformed P0 visible with an unknown status (treated as open)', () => {
    const [r] = p0Rows('| ??? | P0 | broken row | Claude |');
    expect(r.pri).toBe('P0');
    expect(['', 'missing'].includes(r.rawStatus ?? '') || r.status === '').toBe(true);
  });

  it('skips non-table lines and non-P0 rows that are not task IDs', () => {
    expect(parseRows('Plain text | with pipes\n| Header | Pri | Task | Owner | Status | x |')).toEqual([]);
  });

  it('splitCells keeps empty edges and trims cells', () => {
    expect(splitCells('| a | b |')).toEqual(['', 'a', 'b', '']);
  });
});
