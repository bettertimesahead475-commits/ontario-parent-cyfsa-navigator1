#!/usr/bin/env node
// Completion gate for autonomous engineering sessions (see .claude/settings.json, Stop hook).
// Blocks a stop (exit 2) while:
//   1. engineering/TASK_REGISTER.md has an open P0 row (status not done or blocked), or
//   2. tracked production-code files have uncommitted changes.
// Anything else exits 0. Reasons are written to stderr so the agent can act on them.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const REGISTER = 'engineering/TASK_REGISTER.md';
const CODE_PATHS = ['src', 'api', 'functions', 'workers', 'shared'];
const reasons = [];

if (existsSync(REGISTER)) {
  for (const line of readFileSync(REGISTER, 'utf8').split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    // Table rows: | ID | Pri | Task | Owner | Status | ... |
    if (cells.length < 6 || !/^T-\d+$/.test(cells[1] ?? '')) continue;
    const [, id, pri, , , status] = cells;
    if (pri === 'P0' && !['done', 'blocked'].includes(status)) {
      reasons.push(`${id} is P0 and ${status}: resolve it or record it as blocked with evidence.`);
    }
  }
}

try {
  const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...CODE_PATHS], {
    encoding: 'utf8',
  }).trim();
  if (changed) {
    const count = changed.split(/\r?\n/).length;
    reasons.push(`${count} tracked production-code file(s) have uncommitted changes: verify and commit them first.`);
  }
} catch {
  // Not a git checkout, or git is unavailable: nothing to gate on.
}

if (reasons.length) {
  process.stderr.write(`Completion gate: work remains.\n- ${reasons.join('\n- ')}\n`);
  process.exit(2);
}
process.exit(0);
