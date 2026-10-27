// Tests for scripts/official-forms/fetch-fixtures.mjs: all-or-nothing, fail-closed, no writes on any failure.
// Works only in temporary folders. Never touches the repository fixture folders.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFixtures, SETS } from "../../scripts/official-forms/fetch-fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repo, "scripts/official-forms/fetch-fixtures.mjs");
const histDir = path.join(repo, "fixtures", "official-forms");
const currDir = path.join(repo, "fixtures", "official-forms-current");
const hist: { fileName: string }[] = JSON.parse(fs.readFileSync(path.join(repo, "scripts/official-forms/manifest.json"), "utf8")).files;
const curr: { fileName: string }[] = JSON.parse(fs.readFileSync(path.join(repo, "scripts/official-forms/current-manifest.json"), "utf8")).files;
const haveFixtures = hist.every(f => fs.existsSync(path.join(histDir, f.fileName))) && curr.every(f => fs.existsSync(path.join(currDir, f.fileName)));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oforms-fetch-"));

/** A source folder per set. Each file is copied from the repository fixtures; one may be corrupted (one byte flipped). */
function makeSources(corrupt?: { set: "historical" | "current"; fileName: string }) {
  const hs = tmp(), cs = tmp();
  for (const [name, files, from, to] of [["historical", hist, histDir, hs], ["current", curr, currDir, cs]] as const) {
    for (const f of files) {
      const bytes = fs.readFileSync(path.join(from, f.fileName));
      if (corrupt && corrupt.set === name && f.fileName === corrupt.fileName) bytes[Math.floor(bytes.length / 2)] ^= 0x01;
      fs.writeFileSync(path.join(to, f.fileName), bytes);
    }
  }
  return { hs, cs };
}
function makeTargets(seed: boolean) {
  const root = tmp();
  const targets = { historical: path.join(root, "hist"), current: path.join(root, "curr") };
  if (seed) for (const t of Object.values(targets)) { fs.mkdirSync(t); fs.writeFileSync(path.join(t, "sentinel.txt"), "keep"); }
  return { root, targets };
}
const setsFor = (sources: { hs: string; cs: string }, targets: Record<string, string>) =>
  SETS.map(s => ({ ...s, sourceDir: s.name === "historical" ? sources.hs : sources.cs, target: targets[s.name] }));
const listDir = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : null);

describe.skipIf(!haveFixtures)("fetch-fixtures: verified, all-or-nothing copying", () => {
  it("copies every pinned file in both sets when all sources verify", () => {
    const sources = makeSources();
    const { targets } = makeTargets(false);
    const r = fetchFixtures({ sets: setsFor(sources, targets) });
    expect(r.ok, JSON.stringify(r.problems)).toBe(true);
    expect(r.copied).toBe(hist.length + curr.length);
    expect(listDir(targets.historical)).toEqual(hist.map(f => f.fileName).sort());
    expect(listDir(targets.current)).toEqual(curr.map(f => f.fileName).sort());
  });

  it("writes nothing when a historical file is missing, and leaves existing targets untouched", () => {
    const sources = makeSources();
    fs.unlinkSync(path.join(sources.hs, hist[0].fileName));
    const { root, targets } = makeTargets(true);
    const r = fetchFixtures({ sets: setsFor(sources, targets) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([`historical: ${hist[0].fileName}: MISSING`]);
    expect(listDir(targets.historical)).toEqual(["sentinel.txt"]);
    expect(listDir(targets.current)).toEqual(["sentinel.txt"]);
    expect(listDir(root)!.some(n => n.startsWith(".stage-"))).toBe(false);
  });

  it("writes nothing to EITHER set when a current file is corrupted, though every historical file is valid", () => {
    const sources = makeSources({ set: "current", fileName: curr[0].fileName });
    const { targets } = makeTargets(true);
    const r = fetchFixtures({ sets: setsFor(sources, targets) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([`current: ${curr[0].fileName}: HASH_MISMATCH`]);
    expect(listDir(targets.historical)).toEqual(["sentinel.txt"]);
    expect(listDir(targets.current)).toEqual(["sentinel.txt"]);
  });

  it("names a corrupted historical file and writes nothing", () => {
    const sources = makeSources({ set: "historical", fileName: hist[3].fileName });
    const { targets } = makeTargets(false);
    const r = fetchFixtures({ sets: setsFor(sources, targets) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([`historical: ${hist[3].fileName}: HASH_MISMATCH`]);
    expect(listDir(targets.historical)).toBeNull();
    expect(listDir(targets.current)).toBeNull();
  });

  it("ignores unrelated files in a source folder", () => {
    const sources = makeSources();
    fs.writeFileSync(path.join(sources.hs, "unexpected.pdf"), "not pinned");
    const { targets } = makeTargets(false);
    const r = fetchFixtures({ sets: setsFor(sources, targets) });
    expect(r.ok).toBe(true);
    expect(listDir(targets.historical)!.includes("unexpected.pdf")).toBe(false);
  });
});

describe.skipIf(!haveFixtures)("fetch-fixtures command line: exit codes and output", () => {
  it("exits 1, names the failing pin, and writes nothing", () => {
    const sources = makeSources({ set: "historical", fileName: hist[1].fileName });
    const { root, targets } = makeTargets(false);
    let code = 0, err = "";
    try {
      execFileSync(process.execPath, [script, "--historical-source", sources.hs, "--current-source", sources.cs,
        "--historical-target", targets.historical, "--current-target", targets.current], { stdio: "pipe" });
    } catch (e: any) {
      code = e.status;
      err = String(e.stderr);
    }
    expect(code).toBe(1);
    expect(err).toContain(`historical: ${hist[1].fileName}: HASH_MISMATCH`);
    expect(err).not.toMatch(/\x00/);
    expect(listDir(targets.historical)).toBeNull();
    expect(root).toBeTruthy();
  });

  it("exits 0 when both sources verify", () => {
    const sources = makeSources();
    const { targets } = makeTargets(false);
    const out = execFileSync(process.execPath, [script, "--historical-source", sources.hs, "--current-source", sources.cs,
      "--historical-target", targets.historical, "--current-target", targets.current], { stdio: "pipe" }).toString();
    expect(out).toContain(`${hist.length + curr.length} fixtures verified and written.`);
  });

  it("exits 1 with a usage message when a source folder is not given", () => {
    let code = 0;
    try { execFileSync(process.execPath, [script, "--historical-source", "/nonexistent"], { stdio: "pipe" }); } catch (e: any) { code = e.status; }
    expect(code).toBe(1);
  });
});
