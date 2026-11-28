#!/usr/bin/env node
// Release-readiness gate: exit 1 unless every P0 row is `done` and the tree has no uncommitted production code.
// Run before declaring a release candidate. Blocked, unknown or malformed P0 rows make readiness fail on purpose.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { p0Rows, CODE_PATHS, REGISTER, REPO_ROOT } from './register-lib.mjs';

const failures = [];
if (!existsSync(REGISTER)) {
  failures.push(`register not found at ${REGISTER}`);
} else {
  for (const r of p0Rows(readFileSync(REGISTER, 'utf8'))) {
    if (r.status !== 'done') failures.push(`${r.id} is P0 with status "${r.rawStatus || 'missing'}"`);
  }
}

try {
  const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...CODE_PATHS], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  }).trim();
  if (changed) failures.push('uncommitted production-code changes');
} catch {
  failures.push('git status could not be read');
}

if (failures.length) {
  process.stderr.write(`Release NOT ready:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Release readiness: all P0 rows done and tree clean.\n');
