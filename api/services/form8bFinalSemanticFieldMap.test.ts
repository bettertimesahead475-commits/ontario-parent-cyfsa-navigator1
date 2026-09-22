// Stage 9D-4B-2A-ii-b4B-iii — Form 8B pass-3 (legal-ground / signature-block / narrative / other) tests.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { validateSemanticFieldMap, FieldMapVersionRegistry, buildExpectedBinding, FIELD_VALUE_PROVENANCE, type SemanticFieldMap, type SemanticFieldMapEntry } from "./semanticFieldMap.js";
import { buildDocxFieldInventory, type DocxFieldInventoryResult } from "./docxFieldInventory.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS } from "./officialFormSourceManifest.js";
import { FORM_8B_STRUCTURAL_MANIFEST } from "./form8bStructuralManifest.js";
import { FORM_8B_PASS1_SEMANTIC_ENTRIES, FORM_8B_PASS1_SEMANTIC_FIELD_MAP, FORM_8B_EXACT_TEMPLATE_BINDING, FORM_8B_SOURCE_SHA256_HEX } from "./form8bAdminChildPartySemanticFieldMap.js";
import { FORM_8B_PASS2_SEMANTIC_ENTRIES, FORM_8B_PASS2_SEMANTIC_FIELD_MAP, FORM_8B_PASS2_UNRESOLVED_ORDINALS } from "./form8bRequestedOrderSemanticFieldMap.js";
import {
  deriveForm8BPass3Ordinals,
  FORM_8B_PASS3_SEMANTIC_FIELD_MAP,
  FORM_8B_PASS3_SEMANTIC_ENTRIES,
  FORM_8B_PASS3_EVIDENCE,
  FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE,
  FORM_8B_PASS3_SIGNATURE_EVIDENCE,
  FORM_8B_PASS3_NARRATIVE_EVIDENCE,
  FORM_8B_PASS3_UNRESOLVED_ORDINALS,
  FORM_8B_PASS3_MAP_VERSION_LABEL,
  FORM_8B_PASS3_PERMITTED_PROVENANCE,
  FORM_8B_PASS3_REQUIRES_REVIEW_PROMOTIONS,
  FORBIDDEN_LEGAL_GROUND_STATE_KEYS,
  FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS,
  FORBIDDEN_NARRATIVE_CONTENT_KEYS,
  provenanceEstablishesLegalGround,
  provenanceExecutesSignature,
  form8bFinalAccounting,
  FORM_8B_ACTUAL_PASS_SETS,
  type Form8BLegalGroundEvidenceRecord,
  type Form8BSignatureBlockEvidenceRecord
} from "./form8bFinalSemanticFieldMap.js";
import { FORM_14A_SEMANTIC_FIELD_MAP, FORM_14A_EXACT_TEMPLATE_BINDING } from "./form14aSemanticFieldMap.js";
import { FORM_351A_SEMANTIC_FIELD_MAP, FORM_351A_EXACT_TEMPLATE_BINDING } from "./form351aSemanticFieldMap.js";
import { FORM_33C_SEMANTIC_FIELD_MAP, FORM_33C_EXACT_TEMPLATE_BINDING } from "./form33cSemanticFieldMap.js";

const REAL_PATH = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/d39f83dd-form-8b-feb_1_2022-en.docx";
const here = (rel: string) => new URL(rel, import.meta.url).pathname;
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function frozenInv(formNumber: string): DocxFieldInventoryResult {
  const rec = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === formNumber)!;
  return {
    usesLegacyFormFields: rec.usesLegacyFormFields, usesContentControls: rec.usesContentControls, contentControlCount: rec.contentControlCount,
    fields: rec.fields.map(f => ({ ...f, rawFfDataXml: "<w:ffData/>" })), anomalies: rec.anomalies, documentProtection: rec.documentProtection,
    allPackagePartNames: ["word/document.xml"]
  };
}
const inv = frozenInv("8B");
const validate = (map: SemanticFieldMap, technicalInventory = inv, expectedBinding = FORM_8B_EXACT_TEMPLATE_BINDING) =>
  validateSemanticFieldMap({ map, expectedBinding, technicalInventory });
const withBinding = (o: Partial<typeof FORM_8B_EXACT_TEMPLATE_BINDING>): SemanticFieldMap => ({ ...FORM_8B_PASS3_SEMANTIC_FIELD_MAP, binding: { ...FORM_8B_EXACT_TEMPLATE_BINDING, ...o } });
const withEntries = (entries: SemanticFieldMapEntry[]): SemanticFieldMap => ({ ...FORM_8B_PASS3_SEMANTIC_FIELD_MAP, entries });
const replace = (o: number, e: SemanticFieldMapEntry) => FORM_8B_PASS3_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === o ? e : x));
const byOrd = (o: number) => FORM_8B_PASS3_SEMANTIC_ENTRIES.find(e => e.technicalIdentity.ordinal === o)!;
const lgOrd = (o: number) => FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE.find(e => e.ordinal === o)!;
const sigOrd = (o: number) => FORM_8B_PASS3_SIGNATURE_EVIDENCE.find(e => e.ordinal === o)!;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Independent subtraction (does NOT call the module's derive function).
const ALL = inv.fields.map(f => f.order);
const P1 = new Set(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal));
const P2 = new Set([...FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal), ...FORM_8B_PASS2_UNRESOLVED_ORDINALS]);
const REMAINING = ALL.filter(o => !P1.has(o) && !P2.has(o));
const LG = range(47, 67);

describe("pass 3: exact remaining set derived by subtraction", () => {
  it("115 real controls - 56 pass-1 - 34 pass-2 = 25 remaining: 47..67, 110, 111, 112, 113", () => {
    expect(ALL).toEqual(range(0, 114));
    expect([P1.size, P2.size]).toEqual([56, 34]);
    expect([...P1].filter(o => P2.has(o))).toEqual([]);
    expect(REMAINING).toEqual([...LG, 110, 111, 112, 113]);
    expect(deriveForm8BPass3Ordinals()).toEqual(REMAINING);
  });
  it("frozen b4A groups of the remaining set: 21 LEGAL_GROUND, 1 NARRATIVE, 1 OTHER, 2 SIGNATURE", () => {
    const g = (grp: string) => REMAINING.filter(o => FORM_8B_STRUCTURAL_MANIFEST[o].structuralGroup === grp);
    expect(g("LEGAL_GROUND_OR_POSITION")).toEqual(LG);
    expect(g("FACTUAL_NARRATIVE")).toEqual([110]);
    expect(g("OTHER")).toEqual([111]);
    expect(g("SIGNATURE_OR_ATTESTATION")).toEqual([112, 113]);
  });
  it("every remaining control is mapped or unresolved exactly once; nothing else enters pass 3", () => {
    const mapped = FORM_8B_PASS3_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped, ...FORM_8B_PASS3_UNRESOLVED_ORDINALS].sort((a, b) => a - b)).toEqual(REMAINING);
    expect(FORM_8B_PASS3_EVIDENCE.map(e => e.ordinal)).toEqual(mapped);
    for (const o of mapped) expect(P1.has(o) || P2.has(o)).toBe(false);
  });
  it("every remaining stable ID exists in the real inventory with identical name/type/tableDepth/paragraphOrdinal", () => {
    for (const e of FORM_8B_PASS3_SEMANTIC_ENTRIES) {
      const f = inv.fields.find(x => x.order === e.technicalIdentity.ordinal)!;
      expect([f.name, f.type, f.tableDepth, f.paragraphOrdinal]).toEqual([e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal]);
      expect(FORM_8B_STRUCTURAL_MANIFEST[e.technicalIdentity.ordinal].observedName).toBe(e.technicalIdentity.name);
    }
  });
  it("validates against the frozen inventory with the exact 8B binding and its own version label", () => {
    expect(() => validate(FORM_8B_PASS3_SEMANTIC_FIELD_MAP)).not.toThrow();
    expect(FORM_8B_PASS3_SEMANTIC_FIELD_MAP.mapVersionLabel).toBe(FORM_8B_PASS3_MAP_VERSION_LABEL);
    expect(FORM_8B_PASS3_SEMANTIC_FIELD_MAP.binding).toBe(FORM_8B_EXACT_TEMPLATE_BINDING);
  });
  it("evidence records carry the frozen b4A group unchanged", () => {
    for (const e of FORM_8B_PASS3_EVIDENCE) expect(e.frozenStructuralGroup).toBe(FORM_8B_STRUCTURAL_MANIFEST[e.ordinal].structuralGroup);
  });
});

describe("pass 3: final 115-control completeness", () => {
  it("union(b4B-i, b4B-ii, b4B-iii) = exactly the 115 real controls, zero gaps, zero overlaps", () => {
    const a = form8bFinalAccounting();
    expect(a.map(r => r.ordinal)).toEqual(ALL);
    const n = (owner: string) => a.filter(r => r.owner === owner).length;
    expect([n("PASS1_B4B_I"), n("PASS2_B4B_II"), n("PASS3_B4B_III")]).toEqual([56, 34, 25]);
  });
  it("breakdown by category and disposition", () => {
    const a = form8bFinalAccounting();
    const c = (cat: string, d = "MAPPED") => a.filter(r => r.category === cat && r.disposition === d).length;
    expect([c("ADMINISTRATIVE"), c("CHILD_PARTY"), c("REQUESTED_ORDER"), c("LEGAL_GROUND"), c("NARRATIVE"), c("SIGNATURE"), c("OTHER")]).toEqual(COUNTS.mapped);
    expect(a.filter(r => r.disposition === "UNRESOLVED").length).toBe(COUNTS.unresolved);
    expect(COUNTS.mapped.reduce((x, y) => x + y, 0) + COUNTS.unresolved).toBe(115);
  });
  it("overlap, gap, and unknown ordinal are each rejected", () => {
    const s = FORM_8B_ACTUAL_PASS_SETS;
    expect(() => form8bFinalAccounting({ ...s, pass3Unresolved: [69] })).toThrow(/accounted 2 times/);
    expect(() => form8bFinalAccounting({ ...s, pass3Entries: s.pass3Entries.slice(1) })).toThrow(/ordinal 47 is accounted 0 times/);
    expect(() => form8bFinalAccounting({ ...s, pass3Unresolved: [115] })).toThrow(/not a real Form 8B control/);
    expect(() => form8bFinalAccounting({ ...s, pass3Entries: [...s.pass3Entries, FORM_8B_PASS1_SEMANTIC_ENTRIES[0]] })).toThrow(/accounted 2 times/);
  });
  it("merged three-pass map validates against the real inventory (no duplicate technical target, no unknown ID)", () => {
    const merged: SemanticFieldMap = { ...FORM_8B_PASS3_SEMANTIC_FIELD_MAP, entries: [...FORM_8B_PASS1_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS3_SEMANTIC_ENTRIES] };
    expect(() => validate(merged)).not.toThrow();
    expect(merged.entries.length).toBe(115);
    expect(new Set(merged.entries.map(e => e.semanticKey)).size).toBe(115);
  });
});

describe("pass 3: legal-ground identity, never conclusion", () => {
  it("21 ground entries, all checkbox, all LEGAL_GROUND_OR_POSITION, neutral legalGround.<clause>.<identity> keys", () => {
    const g = FORM_8B_PASS3_SEMANTIC_ENTRIES.filter(e => e.reviewSensitivity === "LEGAL_GROUND_OR_POSITION");
    expect(g.map(e => e.technicalIdentity.ordinal)).toEqual(LG);
    for (const e of g) {
      expect(e.technicalIdentity.type).toBe("checkbox");
      expect(e.semanticKey).toMatch(/^legalGround\.cyfsaS74_2_[a-z0-9_]+\.[A-Za-z0-9]+$/);
      // 'Failure' is official ground wording ("failure to care for ..."), so only a standalone failed-state token is barred.
      expect(e.semanticKey).not.toMatch(/establish|proven|prove|satisf|applicab|applies|select|assert|recommend|likely|confiden|should|failed|notMet|accept|reject|check|default|score|rank/i);
    }
  });
  it("each ground has official evidence: printed wording + clause identity; sub-boxes point to their lead-in box", () => {
    for (const e of FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE) {
      expect(e.officialLabelEvidence.length).toBeGreaterThan(20);
      expect(e.semanticKey).toContain(`cyfsaS74_2_${e.officialClauseIdentity.replace(/^74\(2\)/, "").replace(/[()]/g, "_").replace(/\./g, "").replace(/_+/g, "_").replace(/^_|_$/g, "")}.`);
      if (e.role === "GROUND_SUB_BOX") expect(lgOrd(e.parentGroundOrdinal!).role).toBe("GROUND_BOX");
      else expect(e.parentGroundOrdinal).toBeNull();
    }
    expect(FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE.filter(e => e.role === "GROUND_SUB_BOX").map(e => [e.ordinal, e.parentGroundOrdinal])).toEqual([[48, 47], [49, 47], [51, 50], [52, 50]]);
  });
  it("no ground entry/evidence/citation carries any forbidden conclusion property", () => {
    const recs: object[] = [...FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE, ...FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE.flatMap(e => e.statutoryAssociations), ...FORM_8B_PASS3_SEMANTIC_ENTRIES];
    for (const r of recs) for (const k of FORBIDDEN_LEGAL_GROUND_STATE_KEYS) expect(Object.prototype.hasOwnProperty.call(r, k), k).toBe(false);
    for (const k of ["established", "proven", "satisfied", "applicable", "selected", "asserted", "recommended", "likely", "confidence", "shouldAssert", "shouldSelect"]) expect(FORBIDDEN_LEGAL_GROUND_STATE_KEYS).toContain(k);
  });
  it("statutory citation is association-only and changes nothing legal: 47 (no citation) vs 53 (citation) identical legal fields", () => {
    for (const e of FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE) for (const s of e.statutoryAssociations) {
      expect(s.associationOnly).toBe(true);
      expect(Object.keys(s).sort()).toEqual(["associationOnly", "printedReference"]);
    }
    expect(lgOrd(47).statutoryAssociations).toEqual([]);
    expect(lgOrd(53).statutoryAssociations.length).toBe(1);
    const legal = (o: number) => [byOrd(o).legalRequiredness, byOrd(o).applicability, byOrd(o).permittedProvenance, byOrd(o).mappingResolution];
    expect(legal(47)).toEqual(legal(53));
  });
  it("legal requiredness conservative: UNKNOWN everywhere, technicallyRequired false, ground applicability UNKNOWN (never CONDITIONALLY/ALWAYS)", () => {
    for (const e of FORM_8B_PASS3_SEMANTIC_ENTRIES) { expect(e.legalRequiredness).toBe("UNKNOWN"); expect(e.technicalConstraints.technicallyRequired).toBe(false); }
    for (const o of LG) expect(byOrd(o).applicability).toBe("UNKNOWN");
  });
  it("provenance: only USER_ENTERED; MATTER_DERIVED / MACHINE_SUGGESTED / PROFESSIONALLY_REVIEWED cannot source a ground; no provenance establishes a ground", () => {
    expect(FORM_8B_PASS3_PERMITTED_PROVENANCE).toEqual(["USER_ENTERED"]);
    for (const e of FORM_8B_PASS3_SEMANTIC_ENTRIES) {
      expect(e.permittedProvenance).toEqual(["USER_ENTERED"]);
      for (const p of ["MATTER_DERIVED", "MACHINE_SUGGESTED", "PROFESSIONALLY_REVIEWED"]) expect(e.permittedProvenance).not.toContain(p);
    }
    for (const p of FIELD_VALUE_PROVENANCE) { expect(provenanceEstablishesLegalGround(p)).toBe(false); expect(provenanceExecutesSignature(p)).toBe(false); }
  });
  it("checkboxes carry no allowedValues and the real template default is unchecked", () => {
    for (const o of LG) {
      expect(byOrd(o).semanticConstraints.allowedValues).toBeNull();
      expect(inv.fields.find(f => f.order === o)!.checkbox!.defaultChecked).toBe(false);
    }
  });
  it("module has no inference/recommendation/case-intelligence logic, no I/O, no DOCX writes", () => {
    const src = fs.readFileSync(here("./form8bFinalSemanticFieldMap.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/function\s+\w*(recommend|rank|score|infer|predict|assess|establish(?!esLegalGround)|select|populate|fill|sign(?!ature)|generate|draft)/i);
    expect(src).not.toMatch(/from "\.\/(matter|evidence|legalIntelligence|retrieval|caseIntelligence)/i);
    expect(src).not.toMatch(/from "node:|writeFile|JSZip|docxZipSafe|fetch\(/);
  });
});

describe("pass 3: type-level adversarial (tsc --noEmit --strict)", () => {
  it("in-file compile-time rejections (@ts-expect-error enforced by `tsc --noEmit`)", () => {
    const g: Form8BLegalGroundEvidenceRecord = { ...lgOrd(53) };
    // @ts-expect-error — `established` is typed `never`.
    const a: Form8BLegalGroundEvidenceRecord = { ...g, established: true };
    // @ts-expect-error — `shouldAssert` is typed `never`.
    const b: Form8BLegalGroundEvidenceRecord = { ...g, shouldAssert: true };
    const s: Form8BSignatureBlockEvidenceRecord = { ...sigOrd(113) };
    // @ts-expect-error — `signed` is typed `never`.
    const c: Form8BSignatureBlockEvidenceRecord = { ...s, signed: true };
    expect([a, b, c].length).toBe(3);
  });
  it("literal AND spread injection of conclusion/recommendation/execution state fail; clean fixtures compile", () => {
    const tsc = path.resolve(here("../../node_modules/.bin/tsc"));
    const mod = here("./form8bFinalSemanticFieldMap.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f8b-p3-"));
    const head = `import { FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE, FORM_8B_PASS3_SIGNATURE_EVIDENCE, FORM_8B_PASS3_NARRATIVE_EVIDENCE, type Form8BLegalGroundEvidenceRecord, type Form8BSignatureBlockEvidenceRecord, type Form8BNarrativeEvidenceRecord, type OfficialGroundCitation } from ${JSON.stringify(mod)};\nconst g = FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE[0];\nconst s = FORM_8B_PASS3_SIGNATURE_EVIDENCE[0];\nconst n = FORM_8B_PASS3_NARRATIVE_EVIDENCE[0];\n`;
    const lg = (extra: string) => `const r: Form8BLegalGroundEvidenceRecord = { kind: "LEGAL_GROUND", ordinal: 53, frozenStructuralGroup: "LEGAL_GROUND_OR_POSITION", frozenB4aMapReadiness: "SAFE_TO_MAP", disposition: "MAPPED", semanticKey: "legalGround.x.y", officialLabelEvidence: "x", evidence: "DIRECT_LABEL", evidenceDetail: "x", rawLocation: "x", role: "GROUND_BOX", parentGroundOrdinal: null, officialClauseIdentity: "74(2)(c)", citationPrintedOnOwnRow: true, statutoryAssociations: [{ printedReference: "clause 74(2)(c)", associationOnly: true }], structuralConditionality: "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION", printedGroupInstruction: "MULTIPLE_BOXES_PERMITTED_BY_PRINTED_INSTRUCTION"${extra} };\nexport default r;\n`;
    const sg = (extra: string) => `const r: Form8BSignatureBlockEvidenceRecord = { kind: "SIGNATURE_BLOCK", ordinal: 113, frozenStructuralGroup: "SIGNATURE_OR_ATTESTATION", frozenB4aMapReadiness: "SAFE_TO_MAP", disposition: "MAPPED", semanticKey: "signatureBlock.x", officialLabelEvidence: "x", evidence: "STRUCTURAL_INFERENCE", evidenceDetail: "x", rawLocation: "x", role: "SIGNER_PRINTED_NAME", capturesSignatureItself: false, frozenB4aRationaleDivergence: null${extra} };\nexport default r;\n`;
    const spread = (T: string, base: string, obj: string) => `const x = ${obj};\nconst r: ${T} = { ...${base}, ...x };\nexport default r;\n`;
    const fixtures: Record<string, string> = {
      cleanGround: head + lg(""),
      cleanSignature: head + sg(""),
      cleanSpread: head + `const r: Form8BLegalGroundEvidenceRecord = { ...g, evidenceDetail: "reworded" };\nexport default r;\n`,
      establishedLiteral: head + lg(", established: true"),
      provenLiteral: head + lg(", proven: true"),
      applicableLiteral: head + lg(", applicable: true"),
      selectedLiteral: head + lg(", selected: true"),
      recommendedLiteral: head + lg(", recommended: true"),
      shouldAssertLiteral: head + lg(", shouldAssert: true"),
      establishedSpread: head + spread("Form8BLegalGroundEvidenceRecord", "g", "{ established: true }"),
      applicableSpread: head + spread("Form8BLegalGroundEvidenceRecord", "g", "{ applicable: true }"),
      recommendedSpread: head + spread("Form8BLegalGroundEvidenceRecord", "g", "{ recommended: true }"),
      confidenceSpread: head + spread("Form8BLegalGroundEvidenceRecord", "g", "{ confidence: 0.9 }"),
      citationApplies: head + `const c: OfficialGroundCitation = { printedReference: "clause 74(2)(c)", associationOnly: true, applicable: true };\nexport default c;\n`,
      citationSpread: head + `const x = { proven: true };\nconst c: OfficialGroundCitation = { printedReference: "clause 74(2)(c)", associationOnly: true, ...x };\nexport default c;\n`,
      signedLiteral: head + sg(", signed: true"),
      executedLiteral: head + sg(", executed: true"),
      signedSpread: head + spread("Form8BSignatureBlockEvidenceRecord", "s", "{ signed: true }"),
      executedSpread: head + spread("Form8BSignatureBlockEvidenceRecord", "s", "{ executed: true }"),
      capturesSignatureTrue: head + spread("Form8BSignatureBlockEvidenceRecord", "s", "{ capturesSignatureItself: true as const }"),
      narrativeGeneratedSpread: head + spread("Form8BNarrativeEvidenceRecord", "n", `{ generatedText: "The mother ..." }`)
    };
    const files = Object.entries(fixtures).map(([k, src]) => { const p = path.join(dir, `${k}.ts`); fs.writeFileSync(p, src); return [k, p] as const; });
    const r = spawnSync(tsc, ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--allowImportingTsExtensions", ...files.map(f => f[1])], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.error, String(r.error)).toBeUndefined();
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status).not.toBe(0);
    for (const [k, p] of files) {
      const errs = out.split("\n").filter(l => l.includes(path.basename(p)) && /error TS/.test(l));
      if (k.startsWith("clean")) expect(errs, out).toEqual([]);
      else expect(errs.length, `${k}\n${out}`).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe("pass 3: signature / attestation boundary", () => {
  it("the 2 frozen SIGNATURE_OR_ATTESTATION controls are real unnamed FORMTEXT controls 112/113; no other signature control exists", () => {
    const sigs = inv.fields.filter(f => FORM_8B_STRUCTURAL_MANIFEST[f.order].structuralGroup === "SIGNATURE_OR_ATTESTATION");
    expect(sigs.map(f => [f.order, f.name, f.type])).toEqual([[112, "", "text"], [113, "", "text"]]);
    expect(FORM_8B_PASS3_SEMANTIC_ENTRIES.filter(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION").map(e => e.technicalIdentity.ordinal)).toEqual([111, 112, 113]);
  });
  it("mapping: 111 date of signature, 112 office/position of person signing (if society), 113 printed name — none captures the signature itself", () => {
    expect([111, 112, 113].map(o => [byOrd(o).semanticKey, sigOrd(o).role])).toEqual([
      ["signatureBlock.dateOfSignature", "DATE_OF_SIGNATURE"],
      ["signatureBlock.signerOfficeOrPositionIfApplicantIsSociety", "SIGNER_OFFICE_OR_POSITION"],
      ["signatureBlock.signerPrintedName", "SIGNER_PRINTED_NAME"]
    ]);
    for (const e of FORM_8B_PASS3_SIGNATURE_EVIDENCE) expect(e.capturesSignatureItself).toBe(false);
    expect(byOrd(111).semanticConstraints.valueType).toBe("DATE");
    expect(byOrd(113).semanticConstraints.valueType).toBe("PERSON_NAME");
    expect(sigOrd(113).evidence).toBe("STRUCTURAL_INFERENCE");
  });
  it("no signature record/entry carries execution state; keys never imply signed/executed/attested", () => {
    for (const r of [...FORM_8B_PASS3_SIGNATURE_EVIDENCE, ...[111, 112, 113].map(byOrd)] as object[])
      for (const k of FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS) expect(Object.prototype.hasOwnProperty.call(r, k), k).toBe(false);
    for (const o of [111, 112, 113]) expect(byOrd(o).semanticKey).not.toMatch(/signed|executed|attested|verified|completed|sworn|affirmed/i);
  });
  it("frozen b4A rationale divergences for 112/113 are recorded explicitly (b4A not modified)", () => {
    expect(FORM_8B_STRUCTURAL_MANIFEST[112].rationale).toContain("'Date of signature'");
    expect(FORM_8B_STRUCTURAL_MANIFEST[113].rationale).toContain("static signature line");
    expect(sigOrd(112).frozenB4aRationaleDivergence).toMatch(/b4A is NOT modified/);
    expect(sigOrd(113).frozenB4aRationaleDivergence).toMatch(/contains NO form field/);
  });
});

describe("pass 3: narrative + OTHER", () => {
  it("110 maps to purpose only: FREE_TEXT_NARRATIVE, b4A sensitivity preserved, no content property", () => {
    const e = byOrd(110);
    expect(e.semanticKey).toBe("narrative.para6.applicantBriefStatementOfFactsRelied");
    expect(e.semanticConstraints.valueType).toBe("FREE_TEXT_NARRATIVE");
    expect(e.reviewSensitivity).toBe(FORM_8B_STRUCTURAL_MANIFEST[110].reviewSensitivity);
    for (const r of [e, ...FORM_8B_PASS3_NARRATIVE_EVIDENCE] as object[]) for (const k of FORBIDDEN_NARRATIVE_CONTENT_KEYS) expect(Object.prototype.hasOwnProperty.call(r, k), k).toBe(false);
    expect(FORM_8B_PASS3_NARRATIVE_EVIDENCE[0].officialContentPurpose).toMatch(/does not treat it as established fact and never supplies it/);
  });
  it("OTHER (111) is promoted only with an explicit REQUIRES_REVIEW promotion record; UNRESOLVED remains a legal disposition", () => {
    const rr = REMAINING.filter(o => FORM_8B_STRUCTURAL_MANIFEST[o].mapReadiness === "REQUIRES_REVIEW");
    expect(rr).toEqual([111]);
    expect(FORM_8B_PASS3_REQUIRES_REVIEW_PROMOTIONS.map(p => p.ordinal)).toEqual(rr);
    const p = FORM_8B_PASS3_REQUIRES_REVIEW_PROMOTIONS[0];
    expect(p.originalB4aRationale).toBe(FORM_8B_STRUCTURAL_MANIFEST[111].rationale);
    for (const f of [p.additionalEvidence, p.whyResolved, p.remainingUncertainty]) expect(f.length).toBeGreaterThan(30);
    expect(FORM_8B_PASS3_UNRESOLVED_ORDINALS).toEqual([]);
  });
  it("structural inference stays explicit: every non-DIRECT_LABEL entry carries a warning", () => {
    for (const ev of FORM_8B_PASS3_EVIDENCE) if (ev.evidence === "STRUCTURAL_INFERENCE" || (ev.evidence === "DIRECT_STRUCTURAL_CONTEXT" && ev.kind === "LEGAL_GROUND"))
      expect(byOrd(ev.ordinal).warnings.length, String(ev.ordinal)).toBeGreaterThan(0);
    expect(FORM_8B_PASS3_EVIDENCE.filter(e => e.evidence !== "DIRECT_LABEL").map(e => [e.ordinal, e.evidence])).toEqual([
      [47, "DIRECT_STRUCTURAL_CONTEXT"], [50, "DIRECT_STRUCTURAL_CONTEXT"], [111, "DIRECT_STRUCTURAL_CONTEXT"], [112, "DIRECT_STRUCTURAL_CONTEXT"], [113, "STRUCTURAL_INFERENCE"]
    ]);
  });
});

// ---------------------------------------------------------------------------
// Real OOXML: independently-hardcoded anchors (text AFTER each checkbox; caption BELOW each blank).
// ---------------------------------------------------------------------------
const GROUND_ANCHORS: Record<number, { after: string; keyPart: string }> = {
  47: { after: "has/have suffered physical harm, inflicted by", keyPart: "S74_2_a." }, 48: { after: "[subclause 74(2)(a)(i)]", keyPart: "S74_2_a_i." },
  49: { after: "[subclause 74(2)(a)(ii)]", keyPart: "S74_2_a_ii." }, 50: { after: "there is a risk that the child(ren) is/are likely to suffer physical harm", keyPart: "S74_2_b." },
  51: { after: "[subclause 74(2)(b)(i)]", keyPart: "S74_2_b_i." }, 52: { after: "[subclause 74(2)(b)(ii)]", keyPart: "S74_2_b_ii." },
  53: { after: "[clause 74(2)(c)]", keyPart: "S74_2_c." }, 54: { after: "[clause 74(2)(d)]", keyPart: "S74_2_d." }, 55: { after: "[clause 74(2)(d.1)]", keyPart: "S74_2_d1." },
  56: { after: "[clause 74(2)(d.2)]", keyPart: "S74_2_d2." }, 57: { after: "[clause 74(2)(e)]", keyPart: "S74_2_e." }, 58: { after: "[clause 74(2)(f)]", keyPart: "S74_2_f." },
  59: { after: "[clause 74(2)(g)]", keyPart: "S74_2_g." }, 60: { after: "[clause 74(2)(h)]", keyPart: "S74_2_h." }, 61: { after: "[clause 74(2)(i)]", keyPart: "S74_2_i." },
  62: { after: "[clause 74(2)(j)]", keyPart: "S74_2_j." }, 63: { after: "[clause 74(2)(k)]", keyPart: "S74_2_k." }, 64: { after: "[clause 74(2)(l)]", keyPart: "S74_2_l." },
  65: { after: "[clause 74(2)(m)]", keyPart: "S74_2_m." }, 66: { after: "[clause 74(2)(n)]", keyPart: "S74_2_n." }, 67: { after: "[clause 74(2)(o)]", keyPart: "S74_2_o." }
};

describe("pass 3: real artifact + raw OOXML evidence", () => {
  const available = fs.existsSync(REAL_PATH);
  it("SHA cross-check: officialFormSourceManifest + docxFieldInventoryData + binding", () => {
    expect(REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.formNumber === "8B" && e.format === "DOCX")!.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
    expect(DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "8B")!.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
    expect(FORM_8B_SOURCE_SHA256_HEX).toBe("02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799");
  });
  (available ? it : it.skip)("recomputes SHA, rebuilds inventory from real bytes, validates pass 3 and the 115-entry union", () => {
    const bytes = fs.readFileSync(REAL_PATH);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(FORM_8B_SOURCE_SHA256_HEX);
    const fresh = buildDocxFieldInventory(bytes);
    expect(fresh.fields.length).toBe(115);
    expect(() => validate(FORM_8B_PASS3_SEMANTIC_FIELD_MAP, fresh)).not.toThrow();
    expect(() => validate({ ...FORM_8B_PASS3_SEMANTIC_FIELD_MAP, entries: [...FORM_8B_PASS1_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS3_SEMANTIC_ENTRIES] }, fresh)).not.toThrow();
  });
  (available ? it : it.skip)("every ground box is followed by its independently-hardcoded official wording/citation, and its key matches", () => {
    const xml = execFileSync("unzip", ["-p", REAL_PATH, "word/document.xml"], { maxBuffer: 1 << 26 }).toString("utf8");
    const norm = (s: string) => s.replace(/&amp;/g, "&").replace(/[‘’]/g, "'").replace(/\s+/g, " ");
    const parts: string[] = [];
    let cur = "";
    for (const m of xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:ffData>[\s\S]*?<\/w:ffData>|<\/w:p>/g)) {
      if (m[0].startsWith("<w:ffData")) { parts.push(norm(cur)); cur = ""; } else if (m[0] === "</w:p>") cur += " "; else cur += m[1];
    }
    parts.push(norm(cur));
    expect(parts.length).toBe(116);
    expect(Object.keys(GROUND_ANCHORS).map(Number)).toEqual(LG);
    for (const o of LG) {
      expect(parts[o + 1], `after #${o}`).toContain(GROUND_ANCHORS[o].after);
      expect(byOrd(o).semanticKey, `key #${o}`).toContain(GROUND_ANCHORS[o].keyPart);
      // The recorded wording is the complete printed ground text that follows the box (a page header may follow #59's row).
      expect(parts[o + 1].trim().startsWith(norm(lgOrd(o).officialLabelEvidence).trim()), `wording #${o}`).toBe(true);
    }
    expect(parts[47]).toContain("Check the applicable box(es)");
    expect(parts[47]).toContain("NOTE: If this case is an application for a status review, strike out paragraph 1 and go immediately to paragraph 2.");
    expect(parts[110]).toContain("The following is a brief statement of the facts upon which the applicant is relying");
  });
  (available ? it : it.skip)("signature block geometry: caption row sits BELOW each ruled row; the signature line itself has no field", () => {
    const xml = execFileSync("unzip", ["-p", REAL_PATH, "word/document.xml"], { maxBuffer: 1 << 26 }).toString("utf8");
    // Locate the 6th top-level table.
    let depth = 0, n = 0, start = -1, end = -1;
    for (const m of xml.matchAll(/<w:tbl>|<\/w:tbl>/g)) {
      if (m[0] === "<w:tbl>") { depth++; if (depth === 1 && ++n === 6) start = m.index!; }
      else { depth--; if (depth === 0 && n === 6 && end < 0) end = m.index!; }
    }
    const rows = xml.slice(start, end).split(/<w:tr[ >]/).slice(1);
    const cells = (r: number) => rows[r].split("<w:tc>").slice(1);
    const txt = (c: string) => [...c.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join("").replace(/[’]/g, "'").trim();
    const hasField = (c: string) => c.includes("<w:ffData>");
    const bottomRule = (c: string) => /<w:bottom w:val="single"/.test(c);
    expect(cells(17).map(hasField)).toEqual([true, false, false]); // #111 | gap | SIGNATURE LINE (no field)
    expect(cells(17).map(bottomRule)).toEqual([true, false, true]);
    expect(cells(18).map(txt)).toEqual(["Date of signature", "", "Signature"]);
    expect(cells(19).map(hasField)).toEqual([true, false, true]); // #112 | gap | #113
    expect(cells(20).map(txt)).toEqual(["If applicant is a children's aid society,give office or position of person signing.", "", "Print or type name."]);
    expect(cells(18).some(bottomRule) || cells(20).some(bottomRule)).toBe(false);
    expect(cells(15).filter(hasField).length).toBe(1); // #110 alone
    expect(txt(cells(16)[0])).toBe("Put a line through any blank space left on this page.");
  });
});

describe("pass 3: duplicate-name / cross-pass collision safety + lockstep (one dimension at a time)", () => {
  it("Check77 at 48/51 (pass 3) vs Check77 at 69..92 (pass 2): same name+type, distinct full identity, distinct keys, different owners", () => {
    const c77 = inv.fields.filter(f => f.name === "Check77").map(f => f.order);
    expect(c77).toEqual([48, 51, 69, 73, 76, 82, 84, 86, 89, 91, 92]);
    const a = form8bFinalAccounting();
    expect(c77.map(o => a[o].owner)).toEqual(["PASS3_B4B_III", "PASS3_B4B_III", ...Array(9).fill("PASS2_B4B_II")]);
    const all = [...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS3_SEMANTIC_ENTRIES].filter(e => e.technicalIdentity.name === "Check77");
    expect(new Set(all.map(e => JSON.stringify(e.technicalIdentity))).size).toBe(11);
    expect(new Set(all.map(e => e.semanticKey)).size).toBe(11);
  });
  it("Check76/78/79 regression: pass-3 and pass-1 uses of the same names are disjoint stable IDs with distinct keys", () => {
    const merged = [...FORM_8B_PASS1_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS3_SEMANTIC_ENTRIES];
    for (const nm of ["Check76", "Check78", "Check79"]) {
      const invOrd = inv.fields.filter(f => f.name === nm).map(f => f.order);
      const es = merged.filter(e => e.technicalIdentity.name === nm);
      expect(es.map(e => e.technicalIdentity.ordinal).sort((x, y) => x - y)).toEqual(invOrd);
      expect(new Set(es.map(e => e.semanticKey)).size).toBe(es.length);
    }
    expect(inv.fields.filter(f => f.name === "Check76").map(f => f.order).filter(o => P1.has(o))).toEqual([102, 104, 105, 107, 108]);
  });
  it("unnamed-field collision: 110..113 are all name '' + text; distinct ordinals/paragraphs/keys", () => {
    const u = [110, 111, 112, 113].map(byOrd);
    expect(u.every(e => e.technicalIdentity.name === "" && e.technicalIdentity.type === "text")).toBe(true);
    expect(new Set(u.map(e => e.technicalIdentity.paragraphOrdinal)).size).toBe(4);
    expect(new Set(u.map(e => e.semanticKey)).size).toBe(4);
  });
  it("same printed sub-wording, different parent ground (48 vs 51; 49 vs 52): distinct keys and clauses", () => {
    for (const [a, b] of [[48, 51], [49, 52]]) {
      expect(lgOrd(a).officialLabelEvidence.replace(/\[.*\]/, "")).toBe(lgOrd(b).officialLabelEvidence.replace(/\[.*\]/, ""));
      expect(byOrd(a).technicalIdentity.name).toBe(byOrd(b).technicalIdentity.name);
      expect(byOrd(a).semanticKey).not.toBe(byOrd(b).semanticKey);
      expect(lgOrd(a).officialClauseIdentity).not.toBe(lgOrd(b).officialClauseIdentity);
    }
  });
  it("same type + same sensitivity + same section, different purpose (58 vs 59 both 'suffered emotional harm')", () => {
    expect([byOrd(58).technicalIdentity.name, byOrd(58).reviewSensitivity, byOrd(58).formSection]).toEqual([byOrd(59).technicalIdentity.name, byOrd(59).reviewSensitivity, byOrd(59).formSection]);
    expect(byOrd(58).semanticKey).not.toBe(byOrd(59).semanticKey);
  });
  it("same sensitivity, different type/section (SIGNATURE_OR_ATTESTATION on text 111..113 only)", () => {
    expect(FORM_8B_PASS3_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.type === "text").map(e => e.reviewSensitivity)).toEqual(["SWORN_FACT", "SIGNATURE_OR_ATTESTATION", "SIGNATURE_OR_ATTESTATION", "SIGNATURE_OR_ATTESTATION"]);
  });
  it("ordinal only changed -> rejected", () => {
    const e = { ...byOrd(54), technicalIdentity: { ...byOrd(54).technicalIdentity, ordinal: 55 } };
    expect(() => validate(withEntries(replace(54, e)))).toThrow(/does not exist/);
  });
  it("name only changed (Check77 -> Check78 at 48) -> rejected", () => {
    const e = { ...byOrd(48), technicalIdentity: { ...byOrd(48).technicalIdentity, name: "Check78" } };
    expect(() => validate(withEntries(replace(48, e)))).toThrow(/does not exist/);
  });
  it("paragraph ordinal only changed -> rejected", () => {
    const e = { ...byOrd(112), technicalIdentity: { ...byOrd(112).technicalIdentity, paragraphOrdinal: 424 } };
    expect(() => validate(withEntries(replace(112, e)))).toThrow(/does not exist/);
  });
  it("technical type only changed -> rejected", () => {
    const e = { ...byOrd(60), technicalConstraints: { ...byOrd(60).technicalConstraints, technicalType: "text" as const } };
    expect(() => validate(withEntries(replace(60, e)))).toThrow(/type mismatch/);
  });
  it("semantic key only retargeted onto another ground's stable ID -> duplicate technical target", () => {
    const e = { ...byOrd(51), technicalIdentity: byOrd(48).technicalIdentity };
    expect(() => validate(withEntries(replace(51, e)))).toThrow(/duplicate technical target/);
  });
  it("label/statute/sensitivity varied alone do not change stable-ID validity (identity is authoritative)", () => {
    for (const mut of [{ label: "renamed" }, { reviewSensitivity: "NORMAL_ADMINISTRATIVE" as const }, { description: "no citation" }]) {
      expect(() => validate(withEntries(replace(53, { ...byOrd(53), ...mut })))).not.toThrow();
    }
  });
});

describe("pass 3: independent binding dimensions", () => {
  it("wrong SHA only", () => expect(() => validate(withBinding({ sourceSha256Hex: "0".repeat(64) }))).toThrow(/source SHA-256/));
  it("wrong form only", () => expect(() => validate(withBinding({ formId: "official-form-33b1", formNumber: "33B.1" }))).toThrow(/form identity/));
  it("wrong template only", () => expect(() => validate(withBinding({ templateId: "other-template" }))).toThrow(/template identity/));
  it("wrong version only", () => expect(() => validate(withBinding({ versionLabel: "2018" }))).toThrow(/form version/));
  it("wrong inventory schema version only", () => expect(() => validate(withBinding({ technicalInventorySchemaVersion: "v0" }))).toThrow(/schema version/));
  it("synthetic SHA and another form's inventory rejected", () => {
    const s = crypto.createHash("sha256").update(Buffer.from("PK\x03\x04synthetic-8b")).digest("hex");
    expect(() => validate(FORM_8B_PASS3_SEMANTIC_FIELD_MAP, inv, buildExpectedBinding({ ...FORM_8B_EXACT_TEMPLATE_BINDING, sourceSha256Hex: s }))).toThrow(/source SHA-256/);
    expect(() => validate(FORM_8B_PASS3_SEMANTIC_FIELD_MAP, frozenInv("14A"))).toThrow();
  });
  it("registry: pass-1/2/3 labels coexist; pass 3 cannot be re-registered", () => {
    const r = new FieldMapVersionRegistry();
    r.register(FORM_8B_PASS1_SEMANTIC_FIELD_MAP);
    r.register(FORM_8B_PASS2_SEMANTIC_FIELD_MAP);
    r.register(FORM_8B_PASS3_SEMANTIC_FIELD_MAP);
    expect(() => r.register(FORM_8B_PASS3_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
    expect(r.listVersions(FORM_8B_EXACT_TEMPLATE_BINDING.templateId).length).toBe(3);
  });
});

describe("pass 3: frozen stages + other forms", () => {
  it("b4A, b4B-i, b4B-ii (+ tests), generic validator and 14A/35.1A/33C maps are byte-identical", () => {
    for (const [f, h] of Object.entries(FROZEN)) expect(sha(here(f)), f).toBe(h);
  });
  it("Form 14A / 35.1A / 33C maps still validate", () => {
    expect(() => validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("14A") })).not.toThrow();
    expect(() => validateSemanticFieldMap({ map: FORM_351A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("35.1A") })).not.toThrow();
    expect(() => validateSemanticFieldMap({ map: FORM_33C_SEMANTIC_FIELD_MAP, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: frozenInv("33C") })).not.toThrow();
  });
  it("no Form 33B.1 map, Form 33B quarantined, no PDF map, no populate module; b4B-ii's forbidden file names still absent", () => {
    for (const f of ["./form33b1SemanticFieldMap.ts", "./form33bSemanticFieldMap.ts", "./form8bSemanticFieldMapPdf.ts", "./form8bDocxPopulate.ts", "./form8bLegalGroundSemanticFieldMap.ts", "./form8bSemanticFieldMap.ts"])
      expect(fs.existsSync(here(f)), f).toBe(false);
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
    expect(FORM_8B_PASS3_SEMANTIC_FIELD_MAP.binding.format).toBe("DOCX");
  });
});

// ADMINISTRATIVE (court admin + application context + representative) 21, CHILD_PARTY 35,
// REQUESTED_ORDER 34, LEGAL_GROUND 21, NARRATIVE 1, SIGNATURE 2, OTHER 1 (by frozen b4A group); 0 unresolved.
const COUNTS = { mapped: [21, 35, 34, 21, 1, 2, 1], unresolved: 0 };

const FROZEN: Record<string, string> = {
  "./form8bStructuralManifest.ts": "41aa02586a1ccbb941e3851bf4f5d4e52e5f6f80c16f462628c6441fb60a87ce",
  "./form8bStructuralManifest.test.ts": "436413c2573c28cb2bd46df5525ecdf6ce84b961f9cebae8fc54d541ae8db7b8",
  "./form8bAdminChildPartySemanticFieldMap.ts": "1ad761ea6408db6dfef373e4208fd38f34941ba0b3103f4b08a08f646d131543",
  "./form8bAdminChildPartySemanticFieldMap.test.ts": "6625a645764843dedc10a002e98a6d2e25a4cf0c6aee8cfcc0a15272405f10fd",
  "./form8bRequestedOrderSemanticFieldMap.ts": "84792d98e68c6413ef172176f0e09c6a06918d0634dce079ecf92dcc5907f637",
  "./form8bRequestedOrderSemanticFieldMap.test.ts": "0217d052a5312b32a4f6a00e7763becd65da18273261b4accebb5e9bb42d425e",
  "./semanticFieldMap.ts": "738fe300916147b3701740250ca2184467780f9a1818097f12f63cad4ef1f762",
  "./form14aSemanticFieldMap.ts": "f506313519b01bfd62f7ca9f7cf608567009d1cc8c6205313af0984f9da12e08",
  "./form351aSemanticFieldMap.ts": "6bb898b5949f21b7efb753bdcb256873aa38960c61ea4d9fa7058e086e5b1c4f",
  "./form33cSemanticFieldMap.ts": "a2d150421fa6335f73db43bb449a89ee8d3aa5864bb779ff22456f1fa9ab481c"
};
