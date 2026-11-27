/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideTextHtml } from "./printExport";
import { CYFSA_TOPICS } from "../data";

let printed: string[] = [];
beforeEach(() => {
  printed = [];
  vi.spyOn(window, "open").mockImplementation(() => ({ document: { write: (h: string) => printed.push(h), close: () => {} }, focus: () => {}, print: () => {} }) as unknown as Window);
  vi.spyOn(console, "error").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("guide print text", () => {
  it("turns **bold** into <strong> and escapes HTML", () => {
    expect(guideTextHtml("**s. 81(1) — Start:** a < b & c")).toBe("<strong>s. 81(1) — Start:</strong> a &lt; b &amp; c");
    expect(guideTextHtml("stray ** marker")).toBe("stray  marker");
    expect(guideTextHtml("⚠️The numbering is unverified ✓")).toBe("The numbering is unverified ");
  });

  it("prints the CYFSA guide with no literal asterisks and lets long cards break across pages", async () => {
    const { default: CYFSAGuideTab } = await import("../components/CYFSAGuideTab");
    render(<CYFSAGuideTab />);
    await act(async () => { window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "guide" } })); });
    const html = printed[printed.length - 1];
    expect(CYFSA_TOPICS[0].fullBody).toContain("**");
    expect(html).toContain("<strong>");
    expect(html.slice(html.indexOf("<body"))).not.toContain("**");
    expect(html).toContain(".section-card { break-inside: auto; page-break-inside: auto; }");
    expect(html.lastIndexOf(".section-card { break-inside: auto;")).toBeGreaterThan(html.indexOf("page-break-inside: avoid"));
    expect(html).toMatch(/<div class="end-matter">\s*<div class="legal-disclaimer">/);
    expect(html.slice(html.indexOf("<body"))).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("prints the rights journey with no literal asterisks", async () => {
    const { default: ParentJourney } = await import("../components/ParentJourney");
    render(<ParentJourney page="rights" />);
    await act(async () => { window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "journey" } })); });
    const html = printed[printed.length - 1];
    expect(html.slice(html.indexOf("<body"))).not.toContain("**");
    expect(html.lastIndexOf(".section-card { break-inside: auto;")).toBeGreaterThan(html.indexOf("page-break-inside: avoid"));
  });
});

describe("template print text", () => {
  it("prints the Respondent Answer draft notice without emoji glyphs", async () => {
    const { default: TemplatesTab } = await import("../components/TemplatesTab");
    const { fireEvent, screen } = await import("@testing-library/react");
    localStorage.clear();
    render(<TemplatesTab />);
    fireEvent.click(screen.getAllByText(/6\. 📋 Educational: Respondent Answer/i)[0]);
    await act(async () => { window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "template" } })); });
    const html = printed[printed.length - 1];
    expect(html).toContain("EDUCATIONAL PREPARATION DRAFT — NOT AN OFFICIAL FORM");
    expect(html.slice(html.indexOf("<body"))).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
