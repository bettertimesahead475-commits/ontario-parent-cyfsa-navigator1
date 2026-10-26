#!/usr/bin/env node
// Usage: node scripts/official-forms/verify.mjs [directory] [--manifest=current-manifest.json]
// Default directory is the one the official-form tests read. Exit 0 = all 11 pass; 1 = a file differs; 2 = a file is missing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, verifyDirectory } from "./verifyLib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// --manifest=current.json checks the separate current official set; default is the historical pins.
const args = process.argv.slice(2);
const manifestArg = args.find((a) => a.startsWith("--manifest="));
const manifestName = manifestArg ? manifestArg.slice("--manifest=".length) : "manifest.json";
const manifest = JSON.parse(readFileSync(join(here, manifestName), "utf8"));
const dir = args.find((a) => !a.startsWith("--")) || manifest.uploadDirectory;
const results = verifyDirectory(manifest, dir);
for (const r of results) console.log(`${r.status.padEnd(14)} ${r.fileName}`);
const s = summarize(results);
console.log(`\n${s.pass}/${s.total} files match their pinned SHA-256 and size. Directory: ${dir}`);
if (results.some((r) => r.status === "MISSING")) process.exit(2);
process.exit(s.failed ? 1 : 0);
