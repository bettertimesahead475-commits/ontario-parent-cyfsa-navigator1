#!/usr/bin/env node
// Completion gate for autonomous engineering sessions (.claude/settings.json, Stop hook).
//
// Blocks a stop (exit 2) only for actionable work:
//   1. a P0 row whose status is not `done` or `blocked` (unknown or malformed status counts as open), or
//   2. tracked production-code files with uncommitted changes.
// A P0 that is `blocked` (with evidence) does NOT stop the session: the agent continues other work.
// Release readiness is a separate check: scripts/release-readiness.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { p0Rows, CODE_PATHS, REGISTER, REPO_ROOT } from './register-lib.mjs';

const actionable = [];
const notes = [];

if (!existsSync(REGISTER)) {
  actionable.push(`register not found at ${REGISTER}: the P0 check cannot run.`);
} else {
  for (const row of p0Rows(readFileSync(REGISTER, 'utf8'))) {
    if (row.status === 'done') continue;
    if (row.status === 'blocked') {
      notes.push(`${row.id} is P0 and blocked (external input needed). Other work continues; release is not ready.`);
    } else {
      actionable.push(`${row.id} is P0 with status "${row.rawStatus || 'missing'}": work it now.`);
    }
  }
}

try {
  const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...CODE_PATHS], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  }).trim();
  if (changed) {
    const count = changed.split(/\r?\n/).length;
    actionable.push(`${count} tracked production-code file(s) have uncommitted changes: verify and commit them.`);
  }
} catch {
  // Git unavailable: report it as actionable rather than silently passing.
  actionable.push('git status could not be read: the uncommitted-changes check cannot run.');
}

if (notes.length) process.stderr.write(`Note: ${notes.join(' ')}\n`);
if (actionable.length) {
  process.stderr.write(`Completion gate: actionable work remains.\n- ${actionable.join('\n- ')}\n`);
  process.exit(2);
}
process.exit(0);
