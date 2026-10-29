// Vercel "Ignored Build Step" (vercel.json ignoreCommand). Exit 0 skips the build; exit 1 builds.
//
// Every push used to build in three Vercel projects connected to this repository (cyfsanavigator,
// cyfsa-owner-fix, ontario-parent-cyfsa-navigator1), every branch, every commit, including commits that change
// only documentation. Build CPU minutes cost US$14-22 a day in late October 2026.
//
// Rules, in order:
// 1. A project other than the production project never builds. (Skipped when VERCEL_PROJECT_ID is not set.)
// 2. main always builds: production is never skipped.
// 3. Other branches build only if they are release/*, preview/*, or listed in VERCEL_PREVIEW_BRANCHES (comma-separated,
//    set in the project's environment variables), and only if the commit changes more than documentation.
// 4. Anything else is skipped.
// When in doubt (no branch name, git unavailable), it builds: this guard saves money, it never blocks a release.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PRODUCTION_PROJECT_ID = "prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR";
const DOCS_ONLY = /(\.md$)|(^docs\/)|(^eval\/forensic\/results\/)/;

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[] | null} changedFiles files changed by the commit, or null if unknown
 * @returns {{ build: boolean, reason: string }}
 */
export function decide(env, changedFiles) {
  const project = env.VERCEL_PROJECT_ID;
  if (project && project !== PRODUCTION_PROJECT_ID) return { build: false, reason: `project ${project} is not the production project` };
  const ref = env.VERCEL_GIT_COMMIT_REF;
  if (!ref) return { build: true, reason: "no branch name; building" };
  if (ref === "main") return { build: true, reason: "main always builds" };
  const listed = (env.VERCEL_PREVIEW_BRANCHES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!(ref.startsWith("release/") || ref.startsWith("preview/") || listed.includes(ref))) {
    return { build: false, reason: `branch ${ref} does not get preview builds (add it to VERCEL_PREVIEW_BRANCHES to build it)` };
  }
  if (changedFiles && changedFiles.length > 0 && changedFiles.every((f) => DOCS_ONLY.test(f))) {
    return { build: false, reason: "the commit changes documentation only" };
  }
  return { build: true, reason: `preview branch ${ref}` };
}

function changedFiles() {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { build, reason } = decide(process.env, changedFiles());
  console.log(`[ignored-build-step] ${build ? "BUILD" : "SKIP"}: ${reason}`);
  process.exit(build ? 1 : 0);
}
