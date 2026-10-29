import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/vercelIgnoreBuild.mjs";
const load = async () => (await import(/* @vite-ignore */ `../${SCRIPT}`)) as any;
const PROD = "prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR";

describe("Vercel ignored build step", () => {
  it("never skips production: main always builds, even for a documentation-only commit", async () => {
    const { decide } = await load();
    expect(decide({ VERCEL_PROJECT_ID: PROD, VERCEL_GIT_COMMIT_REF: "main" }, ["docs/x.md"]).build).toBe(true);
  });

  it("skips every build in the duplicate projects", async () => {
    const { decide } = await load();
    for (const id of ["prj_4qRyNxnTzR0k1sX1vipAIR7cdwnI", "prj_YbA6Yku3285gYyLAZ7WWZ3iLLph6"]) {
      expect(decide({ VERCEL_PROJECT_ID: id, VERCEL_GIT_COMMIT_REF: "main" }, null).build).toBe(false);
    }
  });

  it("builds previews only for release/*, preview/* and listed branches, and not for documentation-only commits", async () => {
    const { decide } = await load();
    const env = (ref: string, listed?: string) => ({ VERCEL_PROJECT_ID: PROD, VERCEL_GIT_COMMIT_REF: ref, VERCEL_PREVIEW_BRANCHES: listed });
    expect(decide(env("feat/forensic-engine"), ["api/x.ts"]).build).toBe(false);
    expect(decide(env("feat/forensic-engine", "feat/forensic-engine, fix/forensic-accuracy"), ["api/x.ts"]).build).toBe(true);
    expect(decide(env("release/candidate"), ["api/x.ts"]).build).toBe(true);
    expect(decide(env("preview/engine"), ["docs/HANDOFF.md", "README.md"]).build).toBe(false);
    expect(decide(env("preview/engine"), ["docs/HANDOFF.md", "api/x.ts"]).build).toBe(true);
  });

  it("builds when it cannot tell: no project id, no branch, or unknown changed files", async () => {
    const { decide } = await load();
    expect(decide({ VERCEL_GIT_COMMIT_REF: "main" }, null).build).toBe(true);
    expect(decide({ VERCEL_PROJECT_ID: PROD }, null).build).toBe(true);
    expect(decide({ VERCEL_PROJECT_ID: PROD, VERCEL_GIT_COMMIT_REF: "release/x" }, null).build).toBe(true);
  });

  it("exits 1 to build and 0 to skip, as Vercel expects", () => {
    const run = (env: Record<string, string>) => {
      try {
        execFileSync("node", [SCRIPT], { env: { PATH: process.env.PATH!, ...env }, stdio: "pipe" });
        return 0;
      } catch (e: any) {
        return e.status;
      }
    };
    expect(run({ VERCEL_PROJECT_ID: PROD, VERCEL_GIT_COMMIT_REF: "main" })).toBe(1);
    expect(run({ VERCEL_PROJECT_ID: "prj_other", VERCEL_GIT_COMMIT_REF: "main" })).toBe(0);
  });

  it("is wired into vercel.json", async () => {
    const { readFileSync } = await import("node:fs");
    expect(JSON.parse(readFileSync("vercel.json", "utf8")).ignoreCommand).toBe(`node ${SCRIPT}`);
  });
});
