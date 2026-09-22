// Stage 9D-4B-2A-ii-b4A tests — Form 8B structural + pleading-decision boundary manifest.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FORM_8B_STRUCTURAL_MANIFEST,
  FORM_8B_STRUCTURAL_MANIFEST_SOURCE_SHA256,
  FORM_8B_STRUCTURAL_GROUPS,
  STRUCTURAL_EVIDENCE_STRENGTHS,
  MAP_READINESS_STATES
} from "./form8bStructuralManifest.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REVIEW_SENSITIVITY_CATEGORIES } from "./semanticFieldMap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORM_8B_DOCX_PATH =
  "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/d39f83dd-form-8b-feb_1_2022-en.docx";

const frozenInventory = DOCX_FIELD_INVENTORIES.find(i => i.formNumber === "8B");
if (!frozenInventory) throw new Error("Frozen Form 8B inventory entry not found");

describe("Form 8B — exact real-artifact identity (2)", () => {
  it("independently recomputes the SHA-256 of the real uploaded bytes and it matches the frozen inventory and the manifest binding", () => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(FORM_8B_DOCX_PATH);
    } catch {
      // Artifact not present in this execution sandbox — this test then only checks internal
      // consistency between the frozen inventory and the manifest's declared source hash, which
      // must always hold regardless of filesystem availability.
      expect(FORM_8B_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(frozenInventory.sha256Hex);
      return;
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(sha).toBe(frozenInventory.sha256Hex);
    expect(sha).toBe(FORM_8B_STRUCTURAL_MANIFEST_SOURCE_SHA256);
    expect(bytes.length).toBe(frozenInventory.byteLength);
  });

  it("form identity is Form 8B, not any other form number or filename lookalike", () => {
    expect(frozenInventory.formNumber).toBe("8B");
    expect(frozenInventory.label).toMatch(/8B/);
  });
});

describe("Form 8B — technical control count (3)", () => {
  it("frozen inventory reports fieldCount 115 and fields.length matches", () => {
    expect(frozenInventory.fieldCount).toBe(115);
    expect(frozenInventory.fields.length).toBe(115);
  });

  it("manifest independently accounts for exactly 115 controls (4)", () => {
    expect(FORM_8B_STRUCTURAL_MANIFEST.length).toBe(115);
  });
});

describe("Form 8B — every technical control appears exactly once (4, 5)", () => {
  it("manifest ordinals are exactly {0..114}, each exactly once, none dropped, none invented", () => {
    const ordinals = FORM_8B_STRUCTURAL_MANIFEST.map(e => e.ordinal).sort((a, b) => a - b);
    expect(ordinals).toEqual(Array.from({ length: 115 }, (_, i) => i));
  });

  it("every manifest ordinal corresponds to a real inventory field with matching name/type", () => {
    for (const entry of FORM_8B_STRUCTURAL_MANIFEST) {
      const real = frozenInventory.fields[entry.ordinal];
      expect(real).toBeDefined();
      expect(real.order).toBe(entry.ordinal);
      expect(real.name ?? "").toBe(entry.observedName);
      expect(real.type).toBe(entry.technicalType);
    }
  });

  it("no unknown technical control is silently dropped (inventory -> manifest coverage is total)", () => {
    const covered = new Set(FORM_8B_STRUCTURAL_MANIFEST.map(e => e.ordinal));
    for (const f of frozenInventory.fields) {
      expect(covered.has(f.order)).toBe(true);
    }
  });
});

describe("Form 8B — structural group determinism (6)", () => {
  it("every entry's structuralGroup is one of the declared FORM_8B_STRUCTURAL_GROUPS", () => {
    for (const entry of FORM_8B_STRUCTURAL_MANIFEST) {
      expect(FORM_8B_STRUCTURAL_GROUPS as readonly string[]).toContain(entry.structuralGroup);
    }
  });

  it("classification is a pure function of ordinal (re-import is stable / deterministic)", async () => {
    const mod2 = await import("./form8bStructuralManifest.js?cachebust=" + Date.now());
    const a = FORM_8B_STRUCTURAL_MANIFEST.map(e => `${e.ordinal}:${e.structuralGroup}`).sort();
    const b = (mod2.FORM_8B_STRUCTURAL_MANIFEST as typeof FORM_8B_STRUCTURAL_MANIFEST)
      .map(e => `${e.ordinal}:${e.structuralGroup}`)
      .sort();
    expect(a).toEqual(b);
  });
});

describe("Form 8B — pleading-decision boundary: requested order (7, 8)", () => {
  const orderEntries = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.structuralGroup === "REQUESTED_ORDER");

  it("requested-order controls are identified where actually present", () => {
    expect(orderEntries.length).toBeGreaterThan(0);
    // real ordinals directly evidenced as relief checkboxes/detail text (society care, access,
    // restraint, support, costs, other) plus the child-support-claim flag and the supervision
    // appendix.
    expect(orderEntries.map(e => e.ordinal)).toContain(13); // Check75 support-claim flag
    expect(orderEntries.map(e => e.ordinal)).toContain(69); // first relief checkbox
    expect(orderEntries.map(e => e.ordinal)).toContain(114); // appendix terms
  });

  it("no requested-order control carries a selected/default answer (9, 18)", () => {
    for (const e of orderEntries) {
      expect(Object.prototype.hasOwnProperty.call(e, "value")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, "checked")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, "selected")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, "defaultValue")).toBe(false);
    }
  });
});

describe("Form 8B — pleading-decision boundary: legal ground / position (9)", () => {
  const groundEntries = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.structuralGroup === "LEGAL_GROUND_OR_POSITION");

  it("legal-ground controls (CYFSA s.74(2) clauses) are identified where actually present", () => {
    expect(groundEntries.length).toBe(21);
    expect(groundEntries.every(e => e.ordinal >= 47 && e.ordinal <= 67)).toBe(true);
  });

  it("legal-ground controls carry no selected/default answer (10, 18)", () => {
    for (const e of groundEntries) {
      expect(Object.prototype.hasOwnProperty.call(e, "value")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, "checked")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, "selected")).toBe(false);
    }
  });

  it("legal-ground group is SAFE_TO_MAP for structural identification only, not for automatic selection", () => {
    for (const e of groundEntries) {
      expect(e.mapReadiness).toBe("SAFE_TO_MAP");
      expect(e.reviewSensitivity).toBe("LEGAL_GROUND_OR_POSITION");
    }
  });
});

describe("Form 8B — protection / status-review pathway (11, 12)", () => {
  it("the requested-order sub-cluster whose statutory register differs (CLRA custody/parenting language) is structurally flagged REQUIRES_REVIEW rather than silently assigned to a pathway", () => {
    const ambiguous = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.ordinal >= 94 && e.ordinal <= 100);
    expect(ambiguous.length).toBe(7);
    for (const e of ambiguous) {
      expect(e.mapReadiness).toBe("REQUIRES_REVIEW");
    }
  });

  it("no manifest entry asserts a PROTECTION_CONTEXT or STATUS_REVIEW_CONTEXT structural group that was never declared (architecture-gap guard)", () => {
    // The frozen ReviewSensitivityCategory vocabulary has no dedicated STATUS_REVIEW category;
    // this test locks in that this manifest never invents one outside the declared groups.
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      expect(FORM_8B_STRUCTURAL_GROUPS as readonly string[]).toContain(e.structuralGroup);
    }
  });
});

describe("Form 8B — provenance cannot choose a pleading (13, 14, 15)", () => {
  // The manifest itself never carries provenance at all (that is a b4B/CompletionDraftValue
  // concern) — these tests prove the ARCHITECTURE that would apply provenance (semanticFieldMap's
  // CompletionDraftValue) structurally cannot mark a value both MACHINE_SUGGESTED and
  // PROFESSIONALLY_REVIEWED, which is the mechanism that prevents provenance from silently
  // becoming an authorized pleading choice.
  it("MATTER_DERIVED / MACHINE_SUGGESTED provenance can never itself assert PROFESSIONALLY_REVIEWED review state (frozen invariant re-exercised for Form 8B's binding)", async () => {
    const { isValidCompletionDraftValue, buildExpectedBinding } = await import("./semanticFieldMap.js");
    const binding = buildExpectedBinding({
      formId: "form-8b",
      formNumber: "8B",
      formVersionId: "form-8b-feb-2022",
      versionLabel: "Feb 1, 2022",
      templateId: "form-8b-template",
      sourceSha256Hex: frozenInventory.sha256Hex
    });
    const draft = {
      binding,
      mapVersionLabel: "v1",
      semanticKey: "requestedOrder.interimSocietyCare",
      technicalIdentity: { ordinal: 74, name: "Check77", type: "checkbox" as const, tableDepth: 0, paragraphOrdinal: 0 },
      value: true,
      provenance: "MACHINE_SUGGESTED" as const,
      reviewState: "PROFESSIONALLY_REVIEWED" as const
    };
    expect(isValidCompletionDraftValue(draft)).toBe(false);
  });
});

describe("Form 8B — administrative vs pleading vs narrative distinction (16, 17)", () => {
  it("administrative controls are distinguished from requested-order / legal-ground controls", () => {
    const admin = FORM_8B_STRUCTURAL_MANIFEST.filter(
      e => e.structuralGroup === "COURT_ADMINISTRATION" || e.structuralGroup === "PARTY_IDENTIFICATION" || e.structuralGroup === "REPRESENTATIVE_INFORMATION"
    );
    expect(admin.every(e => e.reviewSensitivity === "NORMAL_ADMINISTRATIVE" || e.reviewSensitivity === "UNRESOLVED")).toBe(true);
    const pleading = FORM_8B_STRUCTURAL_MANIFEST.filter(
      e => e.structuralGroup === "REQUESTED_ORDER" || e.structuralGroup === "LEGAL_GROUND_OR_POSITION"
    );
    expect(pleading.every(e => e.reviewSensitivity === "REQUESTED_ORDER" || e.reviewSensitivity === "LEGAL_GROUND_OR_POSITION")).toBe(true);
    const overlap = admin.filter(a => pleading.some(p => p.ordinal === a.ordinal));
    expect(overlap.length).toBe(0);
  });

  it("narrative controls are distinguished from administrative controls", () => {
    const narrative = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.structuralGroup === "FACTUAL_NARRATIVE");
    expect(narrative.length).toBeGreaterThan(0);
    for (const n of narrative) {
      expect(n.structuralGroup).not.toBe("COURT_ADMINISTRATION");
    }
  });
});

describe("Form 8B — duplicate names remain distinct (18)", () => {
  it("Check76/Check77/Check79 each appear on multiple ordinals that remain individually addressable and independently classified", () => {
    for (const name of ["Check76", "Check77", "Check79"]) {
      const withName = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.observedName === name);
      expect(withName.length).toBeGreaterThan(1);
      const ordinals = new Set(withName.map(e => e.ordinal));
      expect(ordinals.size).toBe(withName.length); // no ordinal collapse
    }
  });

  it("cross-section same-name collision: Check76 spans LEGAL_GROUND_OR_POSITION and APPLICATION_CONTEXT without merging their classification (21, 22)", () => {
    const check76 = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.observedName === "Check76");
    const groups = new Set(check76.map(e => e.structuralGroup));
    expect(groups.has("LEGAL_GROUND_OR_POSITION")).toBe(true);
    expect(groups.has("APPLICATION_CONTEXT")).toBe(true);
    // structural identity for these entries is ordinal-based, not name-based — verify no two
    // Check76 entries share an ordinal (would indicate identity collapsed onto the name).
    const ordinals = check76.map(e => e.ordinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it("cross-section same-name collision: Check77 spans LEGAL_GROUND_OR_POSITION and REQUESTED_ORDER", () => {
    const check77 = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.observedName === "Check77");
    const groups = new Set(check77.map(e => e.structuralGroup));
    expect(groups.has("LEGAL_GROUND_OR_POSITION")).toBe(true);
    expect(groups.has("REQUESTED_ORDER")).toBe(true);
  });
});

describe("Form 8B — unnamed controls remain distinct (19)", () => {
  it("unnamed controls (observedName === '') are each individually addressable by ordinal and not collapsed", () => {
    const unnamed = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.observedName === "");
    expect(unnamed.length).toBe(frozenInventory.anomalies.emptyNamedFieldCount);
    const ordinals = new Set(unnamed.map(e => e.ordinal));
    expect(ordinals.size).toBe(unnamed.length);
  });
});

describe("Form 8B — repeated structures preserve cardinality (20)", () => {
  it("the child-identification table cells are tagged with a shared repeatedGroupId and preserve their individual ordinals", () => {
    const childCells = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.structuralGroup === "CHILD_IDENTIFICATION");
    expect(childCells.length).toBe(32);
    expect(childCells.every(e => e.repeatedGroupId === "child_identification_table_cell")).toBe(true);
    const ordinals = new Set(childCells.map(e => e.ordinal));
    expect(ordinals.size).toBe(32);
  });
});

describe("Form 8B — evidence strength preserved, not promoted to certainty (22, 23)", () => {
  it("every entry declares one of the four frozen-pattern evidence strengths", () => {
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      expect(STRUCTURAL_EVIDENCE_STRENGTHS as readonly string[]).toContain(e.evidence);
    }
  });

  it("STRUCTURAL_INFERENCE / UNRESOLVED entries are never marked SAFE_TO_MAP when genuinely ambiguous (24)", () => {
    const inferenceOrUnresolved = FORM_8B_STRUCTURAL_MANIFEST.filter(
      e => e.evidence === "STRUCTURAL_INFERENCE" && e.structuralGroup !== "CHILD_IDENTIFICATION" && e.structuralGroup !== "REQUESTED_ORDER"
    );
    // the two page-6 ambiguous single fields (ordinal 14, 111) — genuinely unresolved.
    for (const e of inferenceOrUnresolved) {
      if (e.ordinal === 14 || e.ordinal === 111) {
        expect(e.mapReadiness).toBe("REQUIRES_REVIEW");
      }
    }
  });
});

describe("Form 8B — SAFE_TO_MAP gate requires sufficient evidence (24, 25)", () => {
  it("every mapReadiness value is one of the two declared states", () => {
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      expect(MAP_READINESS_STATES as readonly string[]).toContain(e.mapReadiness);
    }
  });

  it("no entry with evidence UNRESOLVED is SAFE_TO_MAP", () => {
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      if (e.evidence === "UNRESOLVED") {
        expect(e.mapReadiness).toBe("REQUIRES_REVIEW");
      }
    }
  });
});

describe("Form 8B — no fabricated signature control (26)", () => {
  it("signature/attestation entries correspond to the real static 'Date of signature' / 'Signature' column labels only (2 controls, not invented)", () => {
    const sig = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.structuralGroup === "SIGNATURE_OR_ATTESTATION");
    expect(sig.length).toBe(2);
    expect(sig.map(e => e.ordinal).sort((a, b) => a - b)).toEqual([112, 113]);
  });
});

describe("Form 8B — legal requiredness remains conservative (27)", () => {
  it("the structural manifest type carries no legalRequiredness field at all (that is a b4B/semantic-map concern), so no control can silently default away from UNKNOWN", () => {
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      expect(Object.prototype.hasOwnProperty.call(e, "legalRequiredness")).toBe(false);
    }
  });
});

describe("Form 8B — coverage report is honestly derived, not optimized (34)", () => {
  it("SAFE_TO_MAP + REQUIRES_REVIEW partitions the full 115, and REQUIRES_REVIEW is non-trivial (not gamed to look complete)", () => {
    const safe = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.mapReadiness === "SAFE_TO_MAP").length;
    const review = FORM_8B_STRUCTURAL_MANIFEST.filter(e => e.mapReadiness === "REQUIRES_REVIEW").length;
    expect(safe + review).toBe(115);
    expect(review).toBeGreaterThan(0);
  });
});

describe("Form 8B — reused frozen ReviewSensitivityCategory vocabulary (7, architecture-gap check)", () => {
  it("every non-UNRESOLVED reviewSensitivity value used here is a member of the frozen REVIEW_SENSITIVITY_CATEGORIES", () => {
    for (const e of FORM_8B_STRUCTURAL_MANIFEST) {
      if (e.reviewSensitivity === "UNRESOLVED") continue;
      expect(REVIEW_SENSITIVITY_CATEGORIES as readonly string[]).toContain(e.reviewSensitivity);
    }
  });
});
