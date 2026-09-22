// Stage 9D-4B-2A-ii-b4B-ii — Form 8B pass-2 (requested-order) semantic map tests.
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
import {
  FORM_8B_PASS1_SEMANTIC_ENTRIES,
  FORM_8B_PASS1_SEMANTIC_FIELD_MAP,
  FORM_8B_PASS1_DEFERRED_ORDINALS,
  FORM_8B_EXACT_TEMPLATE_BINDING,
  FORM_8B_SOURCE_SHA256_HEX
} from "./form8bAdminChildPartySemanticFieldMap.js";
import {
  FORM_8B_PASS2_SEMANTIC_FIELD_MAP,
  FORM_8B_PASS2_SEMANTIC_ENTRIES,
  FORM_8B_PASS2_EVIDENCE,
  FORM_8B_PASS2_UNRESOLVED_ORDINALS,
  FORM_8B_PASS2_MAP_VERSION_LABEL,
  FORM_8B_REQUESTED_ORDER_PERMITTED_PROVENANCE,
  FORBIDDEN_ANSWER_STATE_KEYS,
  provenanceAuthorizesRequestedOrderSelection,
  form8bGlobalAccounting,
  type Form8BRequestedOrderEvidenceRecord
} from "./form8bRequestedOrderSemanticFieldMap.js";
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
const withBinding = (o: Partial<typeof FORM_8B_EXACT_TEMPLATE_BINDING>): SemanticFieldMap => ({ ...FORM_8B_PASS2_SEMANTIC_FIELD_MAP, binding: { ...FORM_8B_EXACT_TEMPLATE_BINDING, ...o } });
const withEntries = (entries: SemanticFieldMapEntry[]): SemanticFieldMap => ({ ...FORM_8B_PASS2_SEMANTIC_FIELD_MAP, entries });
const replace = (o: number, e: SemanticFieldMapEntry) => FORM_8B_PASS2_SEMANTIC_ENTRIES.map(x => (x.technicalIdentity.ordinal === o ? e : x));
const byOrd = (o: number) => FORM_8B_PASS2_SEMANTIC_ENTRIES.find(e => e.technicalIdentity.ordinal === o)!;
const evOrd = (o: number) => FORM_8B_PASS2_EVIDENCE.find(e => e.ordinal === o)!;
const REQ_ORDINALS = FORM_8B_STRUCTURAL_MANIFEST.filter(m => m.structuralGroup === "REQUESTED_ORDER").map(m => m.ordinal);

describe("pass 2: exact requested-order set derived from frozen b4A", () => {
  it("b4A REQUESTED_ORDER = 34 controls: 13, 69..100, 114", () => {
    expect(REQ_ORDINALS).toEqual([13, ...Array.from({ length: 32 }, (_, i) => 69 + i), 114]);
  });
  it("every b4A REQUESTED_ORDER control is mapped or unresolved exactly once; nothing else enters", () => {
    const mapped = FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
    expect([...mapped, ...FORM_8B_PASS2_UNRESOLVED_ORDINALS].sort((a, b) => a - b)).toEqual(REQ_ORDINALS);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(mapped.filter(o => FORM_8B_PASS2_UNRESOLVED_ORDINALS.includes(o))).toEqual([]);
    expect(FORM_8B_PASS2_EVIDENCE.map(e => e.ordinal)).toEqual(mapped);
    for (const e of FORM_8B_PASS2_EVIDENCE) expect(e.frozenStructuralGroup).toBe(FORM_8B_STRUCTURAL_MANIFEST[e.ordinal].structuralGroup);
  });
  it("no pass-1 ordinal and no LEGAL_GROUND/SIGNATURE/NARRATIVE/OTHER ordinal is in pass 2", () => {
    const p1 = new Set(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal));
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES) {
      expect(p1.has(e.technicalIdentity.ordinal)).toBe(false);
      expect(FORM_8B_STRUCTURAL_MANIFEST[e.technicalIdentity.ordinal].structuralGroup).toBe("REQUESTED_ORDER");
    }
  });
  it("identity (name/type/tableDepth/paragraphOrdinal) equals the frozen inventory and b4A observed name/type", () => {
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES) {
      const f = inv.fields.find(x => x.order === e.technicalIdentity.ordinal)!;
      expect([f.name, f.type, f.tableDepth, f.paragraphOrdinal]).toEqual([e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal]);
      const m = FORM_8B_STRUCTURAL_MANIFEST[e.technicalIdentity.ordinal];
      expect([m.observedName, m.technicalType]).toEqual([e.technicalIdentity.name, e.technicalIdentity.type]);
    }
  });
  it("validates against the frozen inventory with the exact 8B binding", () => {
    expect(() => validate(FORM_8B_PASS2_SEMANTIC_FIELD_MAP)).not.toThrow();
    expect(FORM_8B_PASS2_SEMANTIC_FIELD_MAP.mapVersionLabel).toBe(FORM_8B_PASS2_MAP_VERSION_LABEL);
    expect(FORM_8B_PASS2_SEMANTIC_FIELD_MAP.binding).toBe(FORM_8B_EXACT_TEMPLATE_BINDING);
  });
});

describe("pass 2: global 115-control accounting", () => {
  const p1 = FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
  const p3 = FORM_8B_PASS1_DEFERRED_ORDINALS.filter(o => !REQ_ORDINALS.includes(o));
  it("56 + 34 + 0 + 25 = 115, each ordinal exactly once", () => {
    const a = form8bGlobalAccounting(p1, p3);
    expect(a.map(r => r.ordinal)).toEqual(Array.from({ length: 115 }, (_, i) => i));
    const c = (owner: string, d: string) => a.filter(r => r.owner === owner && r.disposition === d).length;
    expect([c("PASS1_B4B_I", "MAPPED"), c("PASS2_B4B_II", "MAPPED"), c("PASS2_B4B_II", "UNRESOLVED"), c("DEFERRED_TO_B4B_III", "DEFERRED")]).toEqual([56, 34, 0, 25]);
  });
  it("b4B-iii deferred set is exactly LEGAL_GROUND 21 + SIGNATURE 2 + NARRATIVE 1 + OTHER 1", () => {
    const groups = p3.map(o => FORM_8B_STRUCTURAL_MANIFEST[o].structuralGroup);
    expect(p3.length).toBe(25);
    expect(groups.filter(g => g === "LEGAL_GROUND_OR_POSITION").length).toBe(21);
    expect(new Set(groups)).toEqual(new Set(["LEGAL_GROUND_OR_POSITION", "SIGNATURE_OR_ATTESTATION", "FACTUAL_NARRATIVE", "OTHER"]));
  });
  it("overlap or gap is rejected", () => {
    expect(() => form8bGlobalAccounting([...p1, 69], p3)).toThrow(/accounted 2 times/);
    expect(() => form8bGlobalAccounting(p1, p3.slice(1))).toThrow(/accounted 0 times/);
  });
  it("b4B-iii absent: no legal-ground/narrative module exists yet", () => {
    for (const f of ["./form8bLegalGroundSemanticFieldMap.ts", "./form8bSemanticFieldMap.ts"]) expect(fs.existsSync(here(f)), f).toBe(false);
  });
});

describe("pass 2: no default / no answer state", () => {
  it("no entry, evidence record or statutory association carries any forbidden answer-state property", () => {
    const recs: object[] = [...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_EVIDENCE, ...FORM_8B_PASS2_EVIDENCE.flatMap(e => e.statutoryAssociations)];
    for (const r of recs) for (const k of FORBIDDEN_ANSWER_STATE_KEYS) expect(Object.prototype.hasOwnProperty.call(r, k), k).toBe(false);
    for (const k of ["checked", "selected", "default", "recommended", "preferred", "autoSelect", "shouldChoose"]) expect(FORBIDDEN_ANSWER_STATE_KEYS).toContain(k);
  });
  it("semantic keys name options, never answers", () => {
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES) {
      expect(e.semanticKey).toMatch(/^requestedOrder\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/);
      expect(e.semanticKey).not.toMatch(/recommend|selected|checked|default|best|should|prefer|chosen|auto|answer|isTrue|=/i);
    }
    expect(new Set(FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.semanticKey)).size).toBe(34);
  });
  it("checkboxes: no allowedValues, real template default unchecked", () => {
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES.filter(x => x.technicalIdentity.type === "checkbox")) {
      expect(e.semanticConstraints.allowedValues).toBeNull();
      expect(inv.fields.find(f => f.order === e.technicalIdentity.ordinal)!.checkbox!.defaultChecked).toBe(false);
    }
  });
  it("compile-time: answer-state properties are rejected by the record type (in-file @ts-expect-error, enforced by `tsc --noEmit`)", () => {
    const base: Form8BRequestedOrderEvidenceRecord = { ...evOrd(69) };
    // @ts-expect-error — `checked` is typed `never` on every requested-order record.
    const a: Form8BRequestedOrderEvidenceRecord = { ...base, checked: true };
    // @ts-expect-error — `selected` is typed `never`.
    const b: Form8BRequestedOrderEvidenceRecord = { ...base, selected: true };
    // @ts-expect-error — `recommended` is typed `never`.
    const c: Form8BRequestedOrderEvidenceRecord = { ...base, recommended: true };
    // @ts-expect-error — `default` is typed `never`.
    const d: Form8BRequestedOrderEvidenceRecord = { ...base, default: true };
    expect([a, b, c, d].length).toBe(4);
  });
  it("adversarial tsc --noEmit --strict: each answer-state fixture fails, clean control compiles", () => {
    const tsc = path.resolve(here("../../node_modules/.bin/tsc"));
    const mod = here("./form8bRequestedOrderSemanticFieldMap.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f8b-noanswer-"));
    const head = `import { FORM_8B_PASS2_EVIDENCE, type Form8BRequestedOrderEvidenceRecord, type OfficialStatutoryAssociation } from ${JSON.stringify(mod)};\nconst e = FORM_8B_PASS2_EVIDENCE[0];\n`;
    const lit = (extra: string) => `const r: Form8BRequestedOrderEvidenceRecord = { ordinal: e.ordinal, frozenStructuralGroup: "REQUESTED_ORDER", disposition: "MAPPED", semanticKey: e.semanticKey, role: e.role, companionOptionOrdinal: null, optionGroupId: "x", officialLabelEvidence: "x", statutoryAssociations: [], structuralConditionality: "NO_STRUCTURAL_CONDITION_PRINTED", groupExclusivity: "NOT_ESTABLISHED_BY_FORM", evidence: "DIRECT_LABEL", evidenceDetail: "x", rawLocation: "x"${extra} };\nexport default r;\n`;
    const fixtures: Record<string, string> = {
      clean: head + lit(""),
      checkedLiteral: head + lit(", checked: true"),
      selectedLiteral: head + lit(", selected: true"),
      defaultLiteral: head + lit(", default: true"),
      recommendedLiteral: head + lit(", recommended: true"),
      autoSelectSpread: head + `const x = { autoSelect: true };\nconst r: Form8BRequestedOrderEvidenceRecord = { ...e, ...x };\nexport default r;\n`,
      statuteApplies: head + `const s: OfficialStatutoryAssociation = { printedReference: "s. 137", associationOnly: true, shouldRequest: true };\nexport default s;\n`
    };
    const files = Object.entries(fixtures).map(([n, src]) => { const p = path.join(dir, `${n}.ts`); fs.writeFileSync(p, src); return [n, p] as const; });
    const r = spawnSync(tsc, ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--allowImportingTsExtensions", ...files.map(f => f[1])], { encoding: "utf8" });
    const out = r.stdout + r.stderr;
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.status).not.toBe(0);
    for (const [n, p] of files) {
      const errs = out.split("\n").filter(l => l.includes(path.basename(p)) && /error TS/.test(l));
      if (n === "clean") expect(errs, out).toEqual([]);
      else expect(errs.length, `${n}\n${out}`).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe("pass 2: provenance / authorization boundary", () => {
  it("only USER_ENTERED may supply a requested-order value; MATTER_DERIVED / MACHINE_SUGGESTED / PROFESSIONALLY_REVIEWED cannot", () => {
    expect(FORM_8B_REQUESTED_ORDER_PERMITTED_PROVENANCE).toEqual(["USER_ENTERED"]);
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES) {
      expect(e.permittedProvenance).toEqual(["USER_ENTERED"]);
      expect(e.reviewSensitivity).toBe("REQUESTED_ORDER");
      expect(e.mappingResolution).toBe("HUMAN_MAPPED");
    }
  });
  it("no provenance class — including USER_ENTERED — authorizes a filing selection", () => {
    for (const p of FIELD_VALUE_PROVENANCE) expect(provenanceAuthorizesRequestedOrderSelection(p)).toBe(false);
  });
  it("module contains no recommendation / ranking / matter-inference logic", () => {
    const src = fs.readFileSync(here("./form8bRequestedOrderSemanticFieldMap.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/function\s+(?!provenanceAuthorizesRequestedOrderSelection\b)\w*(recommend|rank|score|best|choose|select|infer|predict)/i);
    expect(src).not.toMatch(/from "\.\/(matter|evidence|legalIntelligence|retrieval)/i);
    expect(src).not.toMatch(/from "node:fs"|writeFile|JSZip|docxZipSafe/);
  });
});

describe("pass 2: statutory association, requiredness, conditionality, exclusivity", () => {
  it("statutory associations are printed references only (associationOnly), on exactly 84, 86, 94, 96, 98", () => {
    const withStat = FORM_8B_PASS2_EVIDENCE.filter(e => e.statutoryAssociations.length > 0).map(e => e.ordinal);
    expect(withStat).toEqual([84, 86, 94, 96, 98]);
    for (const e of FORM_8B_PASS2_EVIDENCE) for (const s of e.statutoryAssociations) {
      expect(s.associationOnly).toBe(true);
      expect(Object.keys(s).sort()).toEqual(["associationOnly", "printedReference"]);
    }
    expect(evOrd(98).statutoryAssociations.map(s => s.printedReference)).toEqual([
      "s. 102(3) of the Child, Youth and Family Services Act, 2017", "deemed to be an order under s. 35 of the Children's Law Reform Act"
    ]);
  });
  it("statutory association does not change requiredness/applicability (86 with statute vs 91 without: identical legal fields)", () => {
    expect([byOrd(86).legalRequiredness, byOrd(86).applicability]).toEqual([byOrd(91).legalRequiredness, byOrd(91).applicability]);
  });
  it("legal requiredness UNKNOWN everywhere; technicallyRequired false", () => {
    for (const e of FORM_8B_PASS2_SEMANTIC_ENTRIES) { expect(e.legalRequiredness).toBe("UNKNOWN"); expect(e.technicalConstraints.technicallyRequired).toBe(false); }
  });
  it("structural conditionality stays structural: option boxes UNKNOWN applicability, detail blanks CONDITIONALLY_APPLICABLE, never LEGALLY_REQUIRED", () => {
    for (const ev of FORM_8B_PASS2_EVIDENCE) {
      const e = byOrd(ev.ordinal);
      if (ev.structuralConditionality === "NO_STRUCTURAL_CONDITION_PRINTED") expect(e.applicability).toBe("UNKNOWN");
      else expect(e.applicability).toBe("CONDITIONALLY_APPLICABLE");
      expect(e.legalRequiredness).not.toBe("ESTABLISHED");
    }
    expect(evOrd(114).structuralConditionality).toBe("STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION");
    expect(evOrd(13).structuralConditionality).toBe("STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION");
  });
  it("every detail blank points to an existing option box (except the shared Appendix 114); every paragraph-2 option exclusivity NOT_ESTABLISHED", () => {
    for (const ev of FORM_8B_PASS2_EVIDENCE) {
      if (ev.role === "OPTION_DETAIL" && ev.ordinal !== 114) expect(evOrd(ev.companionOptionOrdinal!).role).toBe("OPTION_BOX");
      if (ev.optionGroupId === "para2.orderOptions") expect(ev.groupExclusivity).toBe("NOT_ESTABLISHED_BY_FORM");
    }
    expect(evOrd(114).companionOptionOrdinal).toBeNull();
    expect(FORM_8B_PASS2_EVIDENCE.filter(e => e.role === "OPTION_BOX").length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Real OOXML: independently-hardcoded anchors (NOT taken from the module), so a key/label swap
// in the module would not be masked by the test reading the same data.
// ---------------------------------------------------------------------------
const ANCHORS: Record<number, { before?: string; after?: string; keyPart: string }> = {
  13: { before: "Check this box if this paragraph applies", after: "also making a claim for child support", keyPart: "ChildSupportClaim" },
  69: { after: "be placed with (name of parent or another person)", keyPart: "placementWithPersonUnderSupervision.optionBox" },
  70: { before: "(name of parent or another person)", keyPart: "placementPersonName" },
  71: { before: "(full legal name of supervising society)", keyPart: "supervisingSocietyName" },
  72: { before: "for a period of", after: "months", keyPart: "PeriodMonths" },
  73: { after: "interim society care of (full legal name of society)", keyPart: "interimSocietyCare.optionBox" },
  74: { before: "interim society care of (full legal name of society)", keyPart: "interimSocietyCare.societyName" },
  75: { before: "for a period of", keyPart: "interimSocietyCare.periodMonths" },
  76: { after: "interim society care of (full legal name of society)", keyPart: "ThenSupervision.optionBox" },
  77: { before: "interim society care of (full legal name of society)", keyPart: "ThenSupervision.interimCareSocietyName" },
  78: { before: "for a period of", after: "and then returned to", keyPart: "interimCarePeriodMonths" },
  79: { before: "returned to (name of parent or another person)", keyPart: "returnToPersonName" },
  80: { before: "(full legal name of supervising society)", keyPart: "ThenSupervision.supervisingSocietyName" },
  81: { before: "for a period of", after: "Appendix on page 7", keyPart: "ThenSupervision.supervisionPeriodMonths" },
  82: { after: "extended society care of (full legal name of caretaker society)", keyPart: "extendedSocietyCare.optionBox" },
  83: { before: "(full legal name of caretaker society)", keyPart: "caretakerSocietyName" },
  84: { after: "relating to access under the Child, Youth and Family Services Act, 2017", keyPart: "accessUnderCyfsa.optionBox" },
  85: { before: "the details of which are as follows:", keyPart: "accessUnderCyfsa.details" },
  86: { after: "that (name of person)", keyPart: "S137.optionBox" },
  87: { before: "that (name of person)", after: "be restrained under s. 137 of the Child, Youth and Family Services Act, 2017", keyPart: "S137.restrainedPersonName" },
  88: { before: "(name of child(ren) and/or any other caregiver)", keyPart: "S137.protectedPersonsNames" },
  89: { after: "relating to payment of support while the child(ren)", keyPart: "supportWhileInCareOrSupervision.optionBox" },
  90: { before: "the details of which are as follows:", keyPart: "supportWhileInCareOrSupervision.details" },
  91: { after: "for court costs.", keyPart: "courtCosts.optionBox" },
  92: { after: "other (Specify.)", keyPart: "other.optionBox" },
  93: { before: "other (Specify.)", keyPart: "other.specification" },
  94: { after: "be placed in the custody of (name of custodian", keyPart: "custody" },
  95: { before: "cannot be a foster parent of the child", after: "parenting order under s. 28 of the Children's Law Reform Act", keyPart: "custodianName" },
  96: { after: "relating to access, the details of which are as follows:", keyPart: "accessDeemedParentingOrContactOrderClraS28.optionBox" },
  97: { before: "relating to access, the details of which are as follows:", after: "parenting or contact order", keyPart: "accessDeemedParentingOrContactOrderClraS28.details" },
  98: { after: "that (name of person)", keyPart: "S102_3.optionBox" },
  99: { before: "that (name of person)", after: "be restrained under s. 102(3) of the Child, Youth and Family Services Act, 2017", keyPart: "S102_3.restrainedPersonName" },
  100: { before: "(name of child(ren) and/or any other caregiver)", after: "s. 35 of the Children's Law Reform Act", keyPart: "S102_3.protectedPersonsNames" },
  114: { before: "The terms and conditions proposed for the child(ren)'s supervision", keyPart: "supervisionTermsAppendix" }
};

describe("pass 2: real artifact + raw OOXML evidence", () => {
  const available = fs.existsSync(REAL_PATH);
  it("SHA cross-check: officialFormSourceManifest + docxFieldInventoryData + binding", () => {
    expect(REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.formNumber === "8B" && e.format === "DOCX")!.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
    expect(DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "8B")!.sha256Hex).toBe(FORM_8B_SOURCE_SHA256_HEX);
  });
  (available ? it : it.skip)("recomputes SHA, rebuilds inventory from real bytes, validates", () => {
    const bytes = fs.readFileSync(REAL_PATH);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(FORM_8B_SOURCE_SHA256_HEX);
    const fresh = buildDocxFieldInventory(bytes);
    expect(fresh.fields.length).toBe(115);
    expect(() => validate(FORM_8B_PASS2_SEMANTIC_FIELD_MAP, fresh)).not.toThrow();
  });
  (available ? it : it.skip)("every one of the 34 controls sits next to its independently-hardcoded official wording, and its key matches", () => {
    const xml = execFileSync("unzip", ["-p", REAL_PATH, "word/document.xml"], { maxBuffer: 1 << 26 }).toString("utf8");
    const norm = (s: string) => s.replace(/&amp;/g, "&").replace(/[‘’]/g, "'").replace(/[  ]/g, " ").replace(/\s+/g, " ");
    const parts: string[] = []; // text segment BEFORE ffData i is parts[i]; after the last is parts[115]
    let cur = "";
    for (const m of xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:ffData>[\s\S]*?<\/w:ffData>|<\/w:p>/g)) {
      if (m[0].startsWith("<w:ffData")) { parts.push(norm(cur)); cur = ""; } else if (m[0] === "</w:p>") cur += " "; else cur += m[1];
    }
    parts.push(norm(cur));
    expect(parts.length).toBe(116);
    expect(Object.keys(ANCHORS).map(Number).sort((a, b) => a - b)).toEqual(REQ_ORDINALS);
    for (const [o, a] of Object.entries(ANCHORS).map(([k, v]) => [Number(k), v] as const)) {
      if (a.before) expect(parts[o], `before #${o}`).toContain(a.before);
      if (a.after) expect(parts[o + 1], `after #${o}`).toContain(a.after);
      expect(byOrd(o).semanticKey, `key #${o}`).toContain(a.keyPart);
    }
    // No 'check one'/'check the applicable box' instruction printed inside paragraph 2 (between #68 and #101).
    const para2 = parts.slice(69, 101).join(" ");
    expect(para2).not.toMatch(/check (one|only one|the applicable)/i);
    // No heading separates 82-93 from 94-100 (the segment between #93 and #94 has no text).
    expect(parts[94].trim()).toBe("");
  });
});

describe("pass 2: lockstep blind-spot — one dimension varied at a time", () => {
  it("same name + same type + same section, different stable ID -> distinct options (Check77 x9)", () => {
    const c77 = FORM_8B_PASS2_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Check77");
    expect(c77.map(e => e.technicalIdentity.ordinal)).toEqual([69, 73, 76, 82, 84, 86, 89, 91, 92]);
    expect(new Set(c77.map(e => e.semanticKey)).size).toBe(9);
    expect(new Set(c77.map(e => e.formSection)).size).toBe(1);
  });
  it("same official caption, different option (74 vs 77; 71 vs 80; 85 vs 90): distinct keys via companion", () => {
    for (const [a, b] of [[74, 77], [71, 80], [85, 90], [87, 99]]) {
      expect(evOrd(a).officialLabelEvidence).toBe(evOrd(b).officialLabelEvidence);
      expect(byOrd(a).semanticKey).not.toBe(byOrd(b).semanticKey);
      expect(evOrd(a).companionOptionOrdinal).not.toBe(evOrd(b).companionOptionOrdinal);
    }
  });
  it("same subject, different statute only (84 vs 96 access; 86 vs 98 restraint) -> distinct keys", () => {
    for (const [a, b] of [[84, 96], [86, 98]]) {
      expect(byOrd(a).technicalIdentity.type).toBe(byOrd(b).technicalIdentity.type);
      expect(evOrd(a).statutoryAssociations).not.toEqual(evOrd(b).statutoryAssociations);
      expect(byOrd(a).semanticKey).not.toBe(byOrd(b).semanticKey);
    }
    expect(byOrd(84).technicalIdentity.name).not.toBe(byOrd(96).technicalIdentity.name); // Check77 vs unnamed
  });
  it("same unnamed name + same type, different ordinal (94/96/98) -> distinct", () => {
    const u = [94, 96, 98].map(byOrd);
    expect(u.every(e => e.technicalIdentity.name === "" && e.technicalIdentity.type === "checkbox")).toBe(true);
    expect(new Set(u.map(e => e.semanticKey)).size).toBe(3);
  });
  it("ordinal only changed -> rejected", () => {
    const e = { ...byOrd(91), technicalIdentity: { ...byOrd(91).technicalIdentity, ordinal: 92 } };
    expect(() => validate(withEntries(replace(91, e)))).toThrow(/does not exist/);
  });
  it("name only changed (Check77 -> Check76) -> rejected", () => {
    const e = { ...byOrd(69), technicalIdentity: { ...byOrd(69).technicalIdentity, name: "Check76" } };
    expect(() => validate(withEntries(replace(69, e)))).toThrow(/does not exist/);
  });
  it("paragraph ordinal only changed -> rejected", () => {
    const e = { ...byOrd(73), technicalIdentity: { ...byOrd(73).technicalIdentity, paragraphOrdinal: 244 } };
    expect(() => validate(withEntries(replace(73, e)))).toThrow(/does not exist/);
  });
  it("technical type only changed -> rejected", () => {
    const e = { ...byOrd(91), technicalConstraints: { ...byOrd(91).technicalConstraints, technicalType: "text" as const } };
    expect(() => validate(withEntries(replace(91, e)))).toThrow(/type mismatch/);
  });
  it("semantic key only retargeted onto another option's stable ID -> duplicate target", () => {
    const e = { ...byOrd(73), technicalIdentity: byOrd(69).technicalIdentity };
    expect(() => validate(withEntries(replace(73, e)))).toThrow(/duplicate technical target/);
  });
  it("sensitivity varies independently of name: Check77 at 48/51 is LEGAL_GROUND in b4A and absent from pass 2", () => {
    expect([48, 51].map(o => [FORM_8B_STRUCTURAL_MANIFEST[o].observedName, FORM_8B_STRUCTURAL_MANIFEST[o].structuralGroup])).toEqual([["Check77", "LEGAL_GROUND_OR_POSITION"], ["Check77", "LEGAL_GROUND_OR_POSITION"]]);
    expect(FORM_8B_PASS2_SEMANTIC_ENTRIES.some(e => [48, 51].includes(e.technicalIdentity.ordinal))).toBe(false);
  });
  it("Check76-79 regression: pass-1 Check76/79 ordinals stay in pass 1; no ordinal in both passes; Check75 unique", () => {
    const p1 = FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
    const p2 = FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal);
    expect(p1.filter(o => p2.includes(o))).toEqual([]);
    expect(FORM_8B_PASS2_SEMANTIC_ENTRIES.some(e => ["Check76", "Check78", "Check79"].includes(e.technicalIdentity.name ?? ""))).toBe(false);
    expect(inv.fields.filter(f => f.name === "Check75").map(f => f.order)).toEqual([13]);
    const merged: SemanticFieldMap = { ...FORM_8B_PASS2_SEMANTIC_FIELD_MAP, entries: [...FORM_8B_PASS1_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_SEMANTIC_ENTRIES] };
    expect(() => validate(merged)).not.toThrow();
  });
});

describe("pass 2: independent binding dimensions", () => {
  it("wrong SHA only", () => expect(() => validate(withBinding({ sourceSha256Hex: "0".repeat(64) }))).toThrow(/source SHA-256/));
  it("wrong form only", () => expect(() => validate(withBinding({ formId: "official-form-33c", formNumber: "33C" }))).toThrow(/form identity/));
  it("wrong template only", () => expect(() => validate(withBinding({ templateId: "other-template" }))).toThrow(/template identity/));
  it("wrong version only", () => expect(() => validate(withBinding({ versionLabel: "2018" }))).toThrow(/form version/));
  it("wrong inventory schema version only", () => expect(() => validate(withBinding({ technicalInventorySchemaVersion: "v0" }))).toThrow(/schema version/));
  it("synthetic substitute SHA rejected; another form's inventory rejected", () => {
    const s = crypto.createHash("sha256").update(Buffer.from("PK\x03\x04synthetic-8b")).digest("hex");
    expect(() => validate(FORM_8B_PASS2_SEMANTIC_FIELD_MAP, inv, buildExpectedBinding({ ...FORM_8B_EXACT_TEMPLATE_BINDING, sourceSha256Hex: s }))).toThrow(/source SHA-256/);
    expect(() => validate(FORM_8B_PASS2_SEMANTIC_FIELD_MAP, frozenInv("33C"))).toThrow();
  });
  it("registry: pass-1 and pass-2 labels coexist; pass 2 cannot be re-registered", () => {
    const r = new FieldMapVersionRegistry();
    r.register(FORM_8B_PASS1_SEMANTIC_FIELD_MAP);
    r.register(FORM_8B_PASS2_SEMANTIC_FIELD_MAP);
    expect(() => r.register(FORM_8B_PASS2_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
  });
});

describe("pass 2: frozen stages + other forms", () => {
  it("b4A, b4B-i, prior maps and the generic validator are byte-identical to their frozen versions", () => {
    expect(sha(here("./form8bStructuralManifest.ts"))).toBe("41aa02586a1ccbb941e3851bf4f5d4e52e5f6f80c16f462628c6441fb60a87ce");
    expect(sha(here("./form8bAdminChildPartySemanticFieldMap.ts"))).toBe(B4BI_SHA);
    expect(sha(here("./form8bAdminChildPartySemanticFieldMap.test.ts"))).toBe(B4BI_TEST_SHA);
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
  it("no Form 33B.1 map, Form 33B quarantined, DOCX-only (no PDF map), no populate module", () => {
    for (const f of ["./form33b1SemanticFieldMap.ts", "./form33bSemanticFieldMap.ts", "./form8bSemanticFieldMapPdf.ts", "./form8bDocxPopulate.ts"]) expect(fs.existsSync(here(f)), f).toBe(false);
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
    expect(FORM_8B_PASS2_SEMANTIC_FIELD_MAP.binding.format).toBe("DOCX");
  });
});

const B4BI_SHA = "1ad761ea6408db6dfef373e4208fd38f34941ba0b3103f4b08a08f646d131543";
const B4BI_TEST_SHA = "6625a645764843dedc10a002e98a6d2e25a4cf0c6aee8cfcc0a15272405f10fd";
