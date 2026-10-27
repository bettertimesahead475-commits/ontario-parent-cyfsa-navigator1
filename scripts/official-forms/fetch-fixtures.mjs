#!/usr/bin/env node
// Copies official-form fixtures from a source folder into the repository's fixture folders, fail closed.
//
// Usage: node scripts/official-forms/fetch-fixtures.mjs --historical-source <folder> --current-source <folder>
//          [--historical-target <folder>] [--current-target <folder>]
//
// Rules:
//   - Only files named in scripts/official-forms/manifest.json and current-manifest.json are considered. Other files are ignored.
//   - Every pinned file in both manifests must be present in the source and must match its pinned SHA-256 and byte length.
//   - Nothing is written unless EVERY pinned file in BOTH manifests passes. A single failure writes nothing.
//   - Files are verified again after copying into a staging folder, and only then moved into place.
//   - Output names contain only the manifest names. Failure messages never print file contents.
// Exit: 0 = all pins verified and copied; 1 = a file is missing, altered, or the arguments are wrong; 3 = copy failed (no target changed).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyDirectory } from "./verifyLib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// Each set has its own source folder. Six file names occur in both sets with DIFFERENT bytes, so one folder cannot serve both.
export const SETS = [
  { name: "historical", manifest: join(here, "manifest.json"), target: join(repoRoot, "fixtures", "official-forms") },
  { name: "current", manifest: join(here, "current-manifest.json"), target: join(repoRoot, "fixtures", "official-forms-current") },
];

function readManifest(path) {
  const m = JSON.parse(readFileSync(path, "utf8"));
  for (const f of m.files) {
    if (typeof f.fileName !== "string" || basename(f.fileName) !== f.fileName || f.fileName.startsWith(".")) {
      throw new Error(`unsafe fixture name in ${basename(path)}`);
    }
  }
  return m;
}

/** Verifies every pinned file in every set before anything is written. Returns the problems, empty when all pass. */
export function checkSources(sets) {
  const problems = [];
  for (const set of sets) {
    const manifest = readManifest(set.manifest);
    for (const r of verifyDirectory(manifest, set.sourceDir)) {
      if (r.status !== "PASS") problems.push(`${set.name}: ${r.fileName}: ${r.status}`);
    }
  }
  return problems;
}

/** Copies verified files into place. Throws if any step fails, leaving the existing targets as they were. */
export function fetchFixtures({ sets }) {
  const problems = checkSources(sets);
  if (problems.length) return { ok: false, problems, copied: 0 };

  // Phase 1: stage and verify every set. Nothing in the target folders is touched yet.
  const staged = [];
  const discard = () => {
    for (const s of staged) rmSync(s.stage, { recursive: true, force: true });
  };
  try {
    for (const set of sets) {
      const manifest = readManifest(set.manifest);
      mkdirSync(dirname(set.target), { recursive: true });
      const stage = mkdtempSync(join(dirname(set.target), `.stage-${basename(set.target)}-`));
      staged.push({ set, stage, count: manifest.files.length });
      for (const f of manifest.files) copyFileSync(join(set.sourceDir, f.fileName), join(stage, f.fileName));
      // Verify the staged copy too: copying must not change what was checked.
      const bad = verifyDirectory(manifest, stage).filter(r => r.status !== "PASS");
      if (bad.length) {
        discard();
        return { ok: false, problems: bad.map(r => `${set.name}: ${r.fileName}: staged ${r.status}`), copied: 0 };
      }
    }
  } catch (e) {
    discard();
    throw e;
  }

  // Phase 2: move each verified stage into place. Only reached when every set verified.
  let copied = 0;
  for (const { set, stage, count } of staged) {
    const previous = `${set.target}.previous`;
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(set.target)) renameSync(set.target, previous);
    renameSync(stage, set.target);
    rmSync(previous, { recursive: true, force: true });
    copied += count;
  }
  return { ok: true, problems: [], copied };
}

function main(argv) {
  const get = flag => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hs = get("--historical-source");
  const cs = get("--current-source");
  if (!hs || !cs) {
    console.error("usage: fetch-fixtures.mjs --historical-source <folder> --current-source <folder> [--historical-target <folder>] [--current-target <folder>]");
    return 1;
  }
  const sets = SETS.map(s => ({
    ...s,
    sourceDir: resolve(s.name === "historical" ? hs : cs),
    target: resolve(get(s.name === "historical" ? "--historical-target" : "--current-target") ?? s.target),
  }));
  for (const set of sets) {
    if (!existsSync(set.sourceDir)) {
      console.error(`${set.name} source folder not found`);
      return 1;
    }
  }
  let result;
  try {
    result = fetchFixtures({ sets });
  } catch (e) {
    console.error(`copy failed: ${e.code ?? e.name}`);
    return 3;
  }
  if (!result.ok) {
    console.error("fixtures NOT written. Failing pins:");
    for (const p of result.problems) console.error(`  ${p}`);
    return 1;
  }
  console.log(`${result.copied} fixtures verified and written.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
