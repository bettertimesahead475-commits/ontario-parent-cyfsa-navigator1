import { describe, it, expect } from "vitest";
import {
  resolveLegalAuthority,
  classifyStatutoryCitation,
} from "../../shared/legalVerificationPipeline";

describe("Authoritative Legal Citation Verification Pipeline", () => {
  it("resolves Section 74(2) child in need of protection grounds", () => {
    const res = resolveLegalAuthority("CYFSA s. 74(2)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 74(2)");
    expect(res.entry?.heading).toBe("Child in need of protection — Specific grounds");
    expect(res.entry?.sourceUrl).toContain("ontario.ca/laws/statute/17c14");
    expect(res.entry?.exactWording).toContain("A child is in need of protection");
  });

  it("resolves Section 88 time in place of safety limited (5-day apprehension rule)", () => {
    const res = resolveLegalAuthority("CYFSA s. 88 (5-day hearing deadline)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 88");
    expect(res.entry?.heading).toBe("Time in place of safety limited — 5-Day Hearing Requirement");
    expect(res.entry?.exactWording).toContain("within five days");
  });

  it("resolves Section 81 child protection proceeding authority", () => {
    const res = resolveLegalAuthority("CYFSA s. 81(1)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 81(1)");
    expect(res.entry?.heading).toBe("Application to court for child protection determination");
  });

  it("resolves Section 90(1) interim care and custody orders", () => {
    const res = resolveLegalAuthority("CYFSA Section 90(1)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 90(1)");
    expect(res.entry?.heading).toBe("Child protection hearing");
  });

  it("resolves Section 94(1) 30-day adjournment limits", () => {
    const res = resolveLegalAuthority("CYFSA s. 94(1)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 94(1)");
    expect(res.entry?.heading).toBe("Adjournment limit — 30-day maximum");
    expect(res.entry?.exactWording).toContain("more than 30 days");
  });

  it("resolves Section 125(1) mandatory duty to report child in need of protection", () => {
    const res = resolveLegalAuthority("CYFSA s. 125");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("CYFSA, s. 125(1)");
    expect(res.entry?.heading).toBe("Duty to report child in need of protection");
    expect(res.entry?.exactWording).toContain("has reasonable grounds to suspect");
  });

  it("resolves Family Law Rules Rule 14(18) hearsay in affidavits", () => {
    const res = resolveLegalAuthority("FLR Rule 14(18)");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("Family Law Rules, O. Reg. 114/99, Rule 14(18)");
    expect(res.entry?.heading).toBe("Affidavit evidence on motions — Information and belief");
    expect(res.entry?.exactWording).toContain("information and belief");
  });

  it("resolves Charter Section 7 fundamental justice", () => {
    const res = resolveLegalAuthority("Canadian Charter of Rights and Freedoms s. 7");
    expect(res.status).toBe("VERIFIED");
    expect(res.entry?.citation).toBe("Canadian Charter of Rights and Freedoms, Section 7");
    expect(res.entry?.heading).toBe("Life, liberty and security of the person");
  });

  it("classifies unknown or made-up citations as UNVERIFIED with explanatory reason", () => {
    const res = classifyStatutoryCitation("CYFSA s. 999(4)");
    expect(res.status).toBe("UNVERIFIED");
    expect(res.reason).toContain("does not match any authoritative Ontario statute or rule consolidation");
  });
});
