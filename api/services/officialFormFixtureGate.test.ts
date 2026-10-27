// Tests for scripts/official-forms/assertFixtureGate.mjs: the CI check that the fixture gate actually executed.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkGateReport, expectedGate, GATE_FILE } from "../../scripts/official-forms/assertFixtureGate.mjs";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/official-forms");
const pins = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).files;
const currentPins = JSON.parse(fs.readFileSync(path.join(dir, "current-manifest.json"), "utf8")).files;

/** Builds a report shaped like vitest's JSON reporter for the gate file. */
function report(rows: Array<{ status: string; title?: string }>, fileStatus = "passed") {
  return {
    testResults: [{
      name: `/repo/api/services/${GATE_FILE}`,
      status: fileStatus,
      assertionResults: rows.map((r, i) => ({ status: r.status, title: r.title ?? `check ${i}` })),
    }],
  };
}
const passed = (n: number) => Array.from({ length: n }, () => ({ status: "passed" }));
const skipped = (n: number) => Array.from({ length: n }, (_, i) => ({ status: "skipped", title: `historical x${i} [skipped: not checked in retrievable mode; superseded, no official source]` }));

describe("expectedGate: the counts each mode must execute", () => {
  it("full mode checks all 17 pins plus the folder check, and skips nothing", () => {
    expect(expectedGate("1", pins, currentPins)).toEqual({ passed: 18, skipped: 0, total: 18 });
  });
  it("retrievable mode checks the 11 retrievable pins plus the folder check, and labels the 6 superseded PDFs", () => {
    expect(expectedGate("retrievable", pins, currentPins)).toEqual({ passed: 12, skipped: 6, total: 18 });
  });
  it("rejects an unknown mode", () => {
    expect(() => expectedGate("0", pins, currentPins)).toThrow(/unknown mode/);
  });
});

describe("checkGateReport: the gate must have run and passed, with every skip explained", () => {
  it("passes a complete retrievable run", () => {
    const r = checkGateReport(report([...passed(12), ...skipped(6)]), "retrievable", pins, currentPins);
    expect(r.ok, r.problems.join("; ")).toBe(true);
  });
  it("passes a complete full-mode run", () => {
    expect(checkGateReport(report(passed(18)), "1", pins, currentPins).ok).toBe(true);
  });
  it("fails when the gate file is absent, so a skipped gate is never a passing gate", () => {
    const r = checkGateReport({ testResults: [] }, "retrievable", pins, currentPins);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/did not run/);
  });
  it("fails on any failed check", () => {
    const r = checkGateReport(report([...passed(11), { status: "failed" }, ...skipped(6)]), "retrievable", pins, currentPins);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/failed/);
  });
  it("fails when fewer checks pass than the manifests require (for example, after a pin was removed)", () => {
    const r = checkGateReport(report([...passed(10), ...skipped(6)]), "retrievable", pins, currentPins);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/expected 12 checks to pass/);
  });
  it("fails in full mode when any check was skipped", () => {
    const r = checkGateReport(report([...passed(17), ...skipped(1)]), "1", pins, currentPins);
    expect(r.ok).toBe(false);
  });
  it("fails on a skip that has no reason label", () => {
    const r = checkGateReport(report([...passed(12), ...skipped(5), { status: "skipped", title: "bare skip" }]), "retrievable", pins, currentPins);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/skip without a reason/);
  });
  it("fails when the gate file itself reports a non-passing status", () => {
    const r = checkGateReport(report([...passed(12), ...skipped(6)], "failed"), "retrievable", pins, currentPins);
    expect(r.ok).toBe(false);
  });
});
