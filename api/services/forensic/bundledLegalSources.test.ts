import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLED_LEGAL_SOURCES } from "../../../shared/bundledLegalSources";

describe("bundled legal sources are pinned", () => {
  it.each(BUNDLED_LEGAL_SOURCES.map((s) => [s.id, s] as const))("%s matches its recorded hash and header", (_id, s) => {
    const text = readFileSync(new URL(`../../../${s.file}`, import.meta.url), "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(s.sha256);
    expect(text).toContain("From July 1, 2026");
    expect(text).toContain(`Last amendment: ${s.lastAmendment}.`);
    expect(s.currencyCheckedAgainstELaws).toBe(false);
  });
});
