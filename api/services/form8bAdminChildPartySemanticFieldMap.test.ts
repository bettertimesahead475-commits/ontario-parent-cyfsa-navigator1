// Stage 9D-4B-2A-ii-b4B-i — Form 8B pass-1 (administrative + child/party) semantic map tests.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  validateSemanticFieldMap,
  FieldMapVersionRegistry,
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  type SemanticFieldMap,
  type SemanticFieldMapEntry
} from "./semanticFieldMap.js";
import { buildDocxFieldInventory, type DocxFieldInventoryResult } from "./docxFieldInventory.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS } from "./officialFormSourceManifest.js";
import { FORM_8B_STRUCTURAL_MANIFEST } from "./form8bStructuralManifest.js";
import {
  FORM_8B_PASS1_SEMANTIC_FIELD_MAP,
  FORM_8B_PASS1_SEMANTIC_ENTRIES,
  FORM_8B_PASS1_EVIDENCE,
  FORM_8B_PASS1_DEFERRED_ORDINALS,
  FORM_8B_PASS1_IN_SCOPE_GROUPS,
  FORM_8B_PASS1_DEFERRED_GROUPS,
  FORM_8B_EXACT_TEMPLATE_BINDING,
  FORM_8B_SOURCE_SHA256_HEX,
  FORM_8B_PASS1_MAP_VERSION_LABEL,
  form8bPass1Accounting,
  form8bPass1CoverageSummary
} from "./form8bAdminChildPartySemanticFieldMap.js";
import { FORM_14A_SEMANTIC_FIELD_MAP, FORM_14A_EXACT_TEMPLATE_BINDING } from "./form14aSemanticFieldMap.js";
import { FORM_351A_SEMANTIC_FIELD_MAP, FORM_351A_EXACT_TEMPLATE_BINDING } from "./form351aSemanticFieldMap.js";
import { FORM_33C_SEMANTIC_FIELD_MAP, FORM_33C_EXACT_TEMPLATE_BINDING } from "./form33cSemanticFieldMap.js";

const REAL_PATH = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/d39f83dd-form-8b-feb_1_2022-en.docx";

function frozenInv(formNumber: string): DocxFieldInventoryResult {
  const rec = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === formNumber)!;
  return {
    usesLegacyFormFields: rec.usesLegacyFormFields,
    usesContentControls: rec.usesContentControls,
    contentControlCount: rec.contentControlCount,
    fields: rec.fields.map(f => ({ ...f, rawFfDataXml: "<w:ffData/>" })),
    anomalies: rec.anomalies,
    documentProtection: rec.documentProtection,
    allPackagePartNames: ["word/document.xml"]
  };
}
const inv = frozenInv("8B");
const validate = (map: SemanticFieldMap, technicalInventory = inv, expectedBinding = FORM_8B_EXACT_TEMPLATE_BINDING) =>
  validateSemanticFieldMap({ map, expectedBinding, technicalInventory });
const withBinding = (o: Partial<typeof FORM_8B_EXACT_TEMPLATE_BINDING>): SemanticFieldMap => ({
  ...FORM_8B_PASS1_SEMANTIC_FIELD_MAP,
  binding: { ...FORM_8B_EXACT_TEMPLATE_BINDING, ...o }
});
const withEntries = (entries: SemanticFieldMapEntry[]): SemanticFieldMap => ({ ...FORM_8B_PASS1_SEMANTIC_FIELD_MAP, entries });
const byOrd = (o: number) => FORM_8B_PASS1_SEMANTIC_ENTRIES.find(e => e.technicalIdentity.ordinal === o)!;
const manifestByOrd = new Map(FORM_8B_STRUCTURAL_MANIFEST.map(m => [m.ordinal, m]));
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("Form 8B pass 1: binding + identity", () => {
  it("binds to the real template and validates against the frozen 8B inventory", () => {
    expect(() => validate(FORM_8B_PASS1_SEMANTIC_FIELD_MAP)).not.toThrow();
    expect(FORM_8B_PASS1_SEMANTIC_FIELD_MAP.mapVersionLabel).toBe(FORM_8B_PASS1_MAP_VERSION_LABEL);
  });
  it("SHA cross-check against officialFormSourceManifest.ts and docxFieldInventoryData.ts", () => {
    const m = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.formNumber === "8B" && e.format === "DOCX")!;
    expect(m.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
    expect(DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "8B")!.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
    expect(FORM_8B_EXACT_TEMPLATE_BINDING.technicalInventorySchemaVersion).toBe(TECHNICAL_INVENTORY_SCHEMA_VERSION);
  });
  it("every entry's technical identity equals the frozen inventory field and preserves the b4A name/type", () => {
    for (const e of FORM_8B_PASS1_SEMANTIC_ENTRIES) {
      const f = inv.fields.find(x => x.order === e.technicalIdentity.ordinal)!;
      expect([f.name, f.type, f.tableDepth, f.paragraphOrdinal]).toEqual([
        e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal
      ]);
      const m = manifestByOrd.get(e.technicalIdentity.ordinal)!;
      expect(m.observedName).toBe(e.technicalIdentity.name);
      expect(m.technicalType).toBe(e.technicalIdentity.type);
    }
  });
});

describe("Form 8B pass 1: completeness (115 = mapped + unresolved + deferred)", () => {
  it("scope is exactly the frozen in-scope groups (56) and deferred is exactly the rest (59)", () => {
    const inScope = FORM_8B_STRUCTURAL_MANIFEST.filter(m => FORM_8B_PASS1_IN_SCOPE_GROUPS.includes(m.structuralGroup)).map(m => m.ordinal);
    const deferred = FORM_8B_STRUCTURAL_MANIFEST.filter(m => FORM_8B_PASS1_DEFERRED_GROUPS.includes(m.structuralGroup)).map(m => m.ordinal);
    expect(inScope.length).toBe(56);
    expect(deferred.length).toBe(59);
    expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal)).toEqual(inScope);
    expect([...FORM_8B_PASS1_DEFERRED_ORDINALS].sort((a, b) => a - b)).toEqual(deferred);
  });
  it("every ordinal 0..114 accounted for exactly once", () => {
    const a = form8bPass1Accounting();
    expect(a.map(x => x.ordinal)).toEqual(Array.from({ length: 115 }, (_, i) => i));
    expect(form8bPass1CoverageSummary()).toEqual({ total: 115, mapped: 56, unresolved: 0, deferred: 59 });
  });
  it("no duplicate technical target, no duplicate semantic key, no unknown target", () => {
    const ords = FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
    expect(new Set(ords).size).toBe(ords.length);
    const keys = FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.semanticKey);
    expect(new Set(keys).size).toBe(keys.length);
    const unknown = { ...byOrd(1), technicalIdentity: { ...byOrd(1).technicalIdentity, ordinal: 115 } };
    expect(() => validate(withEntries([...FORM_8B_PASS1_SEMANTIC_ENTRIES, unknown]))).toThrow(/does not exist/);
    const dup = { ...byOrd(2), semanticKey: "court.somethingElse" };
    expect(() => validate(withEntries([...FORM_8B_PASS1_SEMANTIC_ENTRIES, dup]))).toThrow(/duplicate technical target/);
  });
  it("deferred controls carry no semantic key and no map entry (not silently mapped)", () => {
    const deferred = form8bPass1Accounting().filter(a => a.disposition === "DEFERRED_TO_FUTURE_PASS");
    expect(deferred.length).toBe(59);
    for (const d of deferred) {
      expect(d.semanticKey).toBeNull();
      expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.some(e => e.technicalIdentity.ordinal === d.ordinal)).toBe(false);
    }
    expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.some(e => e.reviewSensitivity === "REQUESTED_ORDER" || e.reviewSensitivity === "LEGAL_GROUND_OR_POSITION")).toBe(false);
  });
});

describe("Form 8B pass 1: evidence", () => {
  it("every mapped entry has an evidence record with a non-empty rationale and a frozen b4A group", () => {
    expect(FORM_8B_PASS1_EVIDENCE.length).toBe(56);
    for (const r of FORM_8B_PASS1_EVIDENCE) {
      expect(r.evidenceDetail.length).toBeGreaterThan(10);
      expect(r.frozenStructuralGroup).toBe(manifestByOrd.get(r.ordinal)!.structuralGroup);
      expect(r.evidence).not.toBe("UNRESOLVED");
    }
  });
  it("structural inference stays visibly inference (warning present) — exactly ordinal 14 + 8 parent slots", () => {
    const inf = FORM_8B_PASS1_EVIDENCE.filter(r => r.evidence === "STRUCTURAL_INFERENCE").map(r => r.ordinal);
    expect(inf).toEqual([14, 19, 20, 27, 28, 35, 36, 43, 44]);
    for (const o of inf) expect(byOrd(o).warnings.some(w => w.includes("STRUCTURAL_INFERENCE"))).toBe(true);
  });
  it("administrative fields mapped with direct label evidence", () => {
    expect(byOrd(1).semanticKey).toBe("court.fileNumber");
    expect(byOrd(8).semanticConstraints.valueType).toBe("DATE");
    for (const o of [0, 1, 2, 8, 9, 10, 11, 12]) expect(FORM_8B_PASS1_EVIDENCE.find(r => r.ordinal === o)!.evidence).toBe("DIRECT_LABEL");
  });
});

describe("Form 8B pass 1: child-identification table promotion (real OOXML)", () => {
  const available = fs.existsSync(REAL_PATH);
  (available ? it : it.skip)("real document.xml: 3rd table has 7 header cells over 14 grid cols, rows 5-8 have 8 cells each with one ffData aligning to header spans", () => {
    const bytes = fs.readFileSync(REAL_PATH);
    const xml = execFileSync("unzip", ["-p", REAL_PATH, "word/document.xml"], { maxBuffer: 1 << 26 }).toString("utf8");
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(FORM_8B_SOURCE_SHA256_HEX);
    const tbls = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]);
    const t = tbls[2];
    expect(t.includes("<w:tbl>", 1)).toBe(false);
    const grid = [...t.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => Number(m[1]));
    expect(grid.length).toBe(14);
    const rows = [...t.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => m[0]);
    const cells = (r: string) => [...r.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(m => m[0]);
    const span = (c: string) => Number(/<w:gridSpan w:val="(\d+)"/.exec(c)?.[1] ?? 1);
    const header = cells(rows[4]);
    expect(header.map(span)).toEqual([5, 1, 1, 1, 4, 1, 1]);
    expect(header[4]).toContain("Parent");
    for (const r of [5, 6, 7, 8]) {
      const c = cells(rows[r]);
      expect(c.map(span)).toEqual([5, 1, 1, 1, 2, 2, 1, 1]);
      for (const cell of c) expect(cell.split("<w:ffData>").length - 1).toBe(1);
    }
    let ffBefore = xml.slice(0, xml.indexOf(rows[5])).split("<w:ffData>").length - 1;
    expect(ffBefore).toBe(15);
  });
  it("32 child cells mapped as 4 distinct child blocks x 8 slots; never collapsed", () => {
    const child = FORM_8B_PASS1_SEMANTIC_ENTRIES.filter(e => /^child\d\./.test(e.semanticKey));
    expect(child.length).toBe(32);
    for (let n = 1; n <= 4; n++) expect(child.filter(e => e.semanticKey.startsWith(`child${n}.`)).length).toBe(8);
    expect(child.every(e => e.semanticConstraints.cardinality === "SINGLE")).toBe(true);
    expect(byOrd(15).semanticKey).toBe("child1.fullLegalName");
    expect(byOrd(18).semanticKey).toBe("child1.sex");
    expect(byOrd(18).technicalConstraints.technicalMaxLength).toBe(2);
    expect(byOrd(26).semanticKey).toBe("child2.sex");
    expect(byOrd(46).semanticKey).toBe("child4.bandsAndCommunities");
  });
  it("sex column (maxLength 2) lands on exactly the 4 fields the inventory marks maxLength 2 — independent check of column alignment", () => {
    const ml2 = inv.fields.filter(f => f.maxLength === 2).map(f => f.order);
    expect(ml2).toEqual([18, 26, 34, 42]);
    expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.filter(e => e.semanticKey.endsWith(".sex")).map(e => e.technicalIdentity.ordinal)).toEqual(ml2);
  });
  it("parent slots carry no role meaning", () => {
    for (const o of [19, 20]) {
      expect(byOrd(o).semanticKey).not.toMatch(/mother|father/i);
      expect(byOrd(o).notes).toMatch(/NO parent-role meaning/);
    }
  });
});

describe("Form 8B pass 1: party role, layering, legal requiredness", () => {
  it("party role only where the template prints it; ordinal 68 '(name)' assigns no role", () => {
    expect(byOrd(3).semanticKey.startsWith("applicant.")).toBe(true);
    expect(byOrd(5).semanticKey.startsWith("respondent.")).toBe(true);
    expect(byOrd(68).semanticKey).not.toMatch(/applicant|respondent|society/i);
    expect(byOrd(68).notes).toMatch(/No party legal role/);
  });
  it("every entry legalRequiredness UNKNOWN; never PROFESSIONALLY_REVIEWED; technicallyRequired never implies legal", () => {
    for (const e of FORM_8B_PASS1_SEMANTIC_ENTRIES) {
      expect(e.legalRequiredness).toBe("UNKNOWN");
      expect(e.mappingResolution).toBe("HUMAN_MAPPED");
      expect(e.technicalConstraints.technicallyRequired).toBe(false);
    }
  });
  it("sworn-fact entries forbid MATTER_DERIVED/MACHINE_SUGGESTED; admin entries allow MATTER_DERIVED", () => {
    for (const e of FORM_8B_PASS1_SEMANTIC_ENTRIES) {
      if (e.reviewSensitivity === "SWORN_FACT") {
        expect(e.permittedProvenance).not.toContain("MATTER_DERIVED");
        expect(e.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
      } else {
        expect(e.reviewSensitivity).toBe("NORMAL_ADMINISTRATIVE");
        expect(e.permittedProvenance).toContain("MATTER_DERIVED");
      }
    }
  });
  it("semantic keys describe slots, never answers; checkboxes carry no default/allowed value", () => {
    for (const e of FORM_8B_PASS1_SEMANTIC_ENTRIES) {
      expect(e.semanticKey).not.toMatch(/selected|checked|isTrue|answer|=|default/i);
      expect(Object.prototype.hasOwnProperty.call(e, "value")).toBe(false);
      if (e.technicalIdentity.type === "checkbox") {
        expect(e.semanticConstraints.allowedValues).toBeNull();
        expect(inv.fields.find(f => f.order === e.technicalIdentity.ordinal)!.checkbox!.defaultChecked).toBe(false);
      }
    }
  });
  it("technical and semantic layers are separate (technical text / semantic DATE)", () => {
    expect(byOrd(8).technicalConstraints.technicalType).toBe("text");
    expect(byOrd(8).semanticConstraints.valueType).toBe("DATE");
  });
});

describe("Form 8B pass 1: Check76-79 distinct by full identity", () => {
  it("in-scope Check76 (x5) and Check79 (x1) are distinct entries with distinct keys", () => {
    const c76 = FORM_8B_PASS1_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Check76");
    expect(c76.map(e => e.technicalIdentity.ordinal)).toEqual([102, 104, 105, 107, 108]);
    expect(new Set(c76.map(e => e.semanticKey)).size).toBe(5);
    expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Check79").map(e => e.technicalIdentity.ordinal)).toEqual([101]);
    expect(FORM_8B_PASS1_SEMANTIC_ENTRIES.some(e => ["Check77", "Check78"].includes(e.technicalIdentity.name ?? ""))).toBe(false);
  });
  it("same name, different ordinal only: retargeting ordinal 104 to another Check76 ordinal (a deferred one) fails on identity", () => {
    const deferredC76 = inv.fields.find(f => f.name === "Check76" && FORM_8B_PASS1_DEFERRED_ORDINALS.includes(f.order))!;
    const moved = { ...byOrd(104), technicalIdentity: { ...byOrd(104).technicalIdentity, ordinal: deferredC76.order } };
    const entries = FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => (e.technicalIdentity.ordinal === 104 ? moved : e));
    expect(() => validate(withEntries(entries))).toThrow(/does not exist/); // paragraphOrdinal no longer matches
  });
  it("same ordinal, altered paragraph ordinal only -> rejected", () => {
    const e = { ...byOrd(105), technicalIdentity: { ...byOrd(105).technicalIdentity, paragraphOrdinal: 999 } };
    expect(() => validate(withEntries(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === 105 ? e : x))))).toThrow(/does not exist/);
  });
  it("same ordinal, altered name only -> rejected", () => {
    const e = { ...byOrd(105), technicalIdentity: { ...byOrd(105).technicalIdentity, name: "Check77" } };
    expect(() => validate(withEntries(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === 105 ? e : x))))).toThrow(/does not exist/);
  });
  it("same type, different purpose: two text fields of identical type/maxLength keep distinct keys; swapping one key onto the other's target collides", () => {
    expect(byOrd(3).technicalConstraints).toEqual(byOrd(5).technicalConstraints);
    expect(byOrd(3).semanticKey).not.toBe(byOrd(5).semanticKey);
    const moved = { ...byOrd(3), technicalIdentity: byOrd(5).technicalIdentity };
    expect(() => validate(withEntries(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === 3 ? moved : x))))).toThrow(/duplicate technical target/);
  });
  it("declared type mismatch only -> rejected", () => {
    const e = { ...byOrd(10), technicalConstraints: { ...byOrd(10).technicalConstraints, technicalType: "text" as const } };
    expect(() => validate(withEntries(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === 10 ? e : x))))).toThrow(/type mismatch/);
  });
});

describe("Form 8B pass 1: independent binding dimensions", () => {
  it("wrong SHA only", () => expect(() => validate(withBinding({ sourceSha256Hex: "0".repeat(64) }))).toThrow(/source SHA-256/));
  it("wrong form only", () => expect(() => validate(withBinding({ formId: "official-form-33c", formNumber: "33C" }))).toThrow(/form identity/));
  it("wrong formNumber only (formId kept)", () => expect(() => validate(withBinding({ formNumber: "33B.1" }))).toThrow(/form identity/));
  it("wrong version only", () => expect(() => validate(withBinding({ versionLabel: "2018" }))).toThrow(/form version/));
  it("wrong template only", () => expect(() => validate(withBinding({ templateId: "other-template" }))).toThrow(/template identity/));
  it("wrong inventory schema version only", () => expect(() => validate(withBinding({ technicalInventorySchemaVersion: "v0" }))).toThrow(/schema version/));
  it("correct map against another form's real inventory fails (form 33C inventory)", () => {
    expect(() => validate(FORM_8B_PASS1_SEMANTIC_FIELD_MAP, frozenInv("33C"))).toThrow();
  });
  it("immutability: same (template, label) cannot be registered twice", () => {
    const r = new FieldMapVersionRegistry();
    r.register(FORM_8B_PASS1_SEMANTIC_FIELD_MAP);
    expect(() => r.register(FORM_8B_PASS1_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
  });
});

describe("Form 8B pass 1: real artifact", () => {
  const available = fs.existsSync(REAL_PATH);
  (available ? it : it.skip)("recomputes SHA, re-parses real bytes, validates against fresh inventory", () => {
    const bytes = fs.readFileSync(REAL_PATH);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(FORM_8B_SOURCE_SHA256_HEX);
    const fresh = buildDocxFieldInventory(bytes);
    expect(fresh.fields.length).toBe(115);
    expect(() => validate(FORM_8B_PASS1_SEMANTIC_FIELD_MAP, fresh)).not.toThrow();
  });
  it("a synthetic substitute's SHA cannot satisfy the binding", () => {
    const s = crypto.createHash("sha256").update(Buffer.from("PK\x03\x04synthetic-8b")).digest("hex");
    const b = buildExpectedBinding({ ...FORM_8B_EXACT_TEMPLATE_BINDING, sourceSha256Hex: s });
    expect(() => validate(FORM_8B_PASS1_SEMANTIC_FIELD_MAP, inv, b)).toThrow(/source SHA-256/);
  });
});

describe("Form 8B pass 1: frozen stages + other forms", () => {
  const here = (rel: string) => new URL(rel, import.meta.url).pathname;
  it("b4A manifest and prior maps byte-identical to their frozen versions", () => {
    expect(sha(here("./form8bStructuralManifest.ts"))).toBe("41aa02586a1ccbb941e3851bf4f5d4e52e5f6f80c16f462628c6441fb60a87ce");
    expect(sha(here("./form14aSemanticFieldMap.ts"))).toBe("f506313519b01bfd62f7ca9f7cf608567009d1cc8c6205313af0984f9da12e08");
    expect(sha(here("./form351aSemanticFieldMap.ts"))).toBe("6bb898b5949f21b7efb753bdcb256873aa38960c61ea4d9fa7058e086e5b1c4f");
    expect(sha(here("./form33cSemanticFieldMap.ts"))).toBe("a2d150421fa6335f73db43bb449a89ee8d3aa5864bb779ff22456f1fa9ab481c");
    expect(sha(here("./semanticFieldMap.ts"))).toBe("738fe300916147b3701740250ca2184467780f9a1818097f12f63cad4ef1f762");
  });
  it("Form 14A / 35.1A / 33C maps still validate", () => {
    expect(() => validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("14A") })).not.toThrow();
    expect(() => validateSemanticFieldMap({ map: FORM_351A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("35.1A") })).not.toThrow();
    expect(() => validateSemanticFieldMap({ map: FORM_33C_SEMANTIC_FIELD_MAP, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("33C") })).not.toThrow();
  });
  it("no full Form 8B map, no Form 33B.1 map, Form 33B quarantined, no PDF map, no populate module", () => {
    for (const f of ["./form8bSemanticFieldMap.ts", "./form33b1SemanticFieldMap.ts", "./form33bSemanticFieldMap.ts", "./form8bSemanticFieldMapPdf.ts", "./form8bDocxPopulate.ts"]) {
      expect(fs.existsSync(here(f)), f).toBe(false);
    }
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
    expect(FORM_8B_EXACT_TEMPLATE_BINDING.format).toBe("DOCX");
  });
  it("this module performs no DOCX write / ZIP parsing (security, duplicate-ZIP, TOCTOU stay owned by docxFieldInventory/docxZipSafe)", () => {
    const src = fs.readFileSync(here("./form8bAdminChildPartySemanticFieldMap.ts"), "utf8");
    expect(src).not.toMatch(/from "node:fs"|writeFile|JSZip|docxZipSafe|buildDocxFieldInventory\(/);
  });
});
