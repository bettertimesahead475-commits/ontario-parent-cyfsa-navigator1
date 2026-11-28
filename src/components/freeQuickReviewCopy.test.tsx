// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import CYFSAGuideTab from "./CYFSAGuideTab";
import { FREE_SCAN_LIMIT } from "../../functions/api/_free-credit-reservation";
import { FREE_TRIAL_LIMITS, FREE_TRIAL_MAX_BYTES, FREE_TRIAL_MAX_PAGES } from "../../functions/api/_free-trial";
import { onRequestGet as accessPricing } from "../../functions/api/access-pricing";

afterEach(cleanup);

describe("free-trial wording matches the server policy", () => {
  it("the server grants 1 free Quick Review and 1 free Forensic Deep Scan, 30 pages / 10 MB", () => {
    expect(FREE_TRIAL_LIMITS).toEqual({ quick: 1, forensic: 1 });
    expect(FREE_SCAN_LIMIT).toBe(1);
    expect(FREE_TRIAL_MAX_PAGES).toBe(30);
    expect(FREE_TRIAL_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("the CYFSA Guide states the one-time Quick + Forensic offer and nothing about 3 free reviews", () => {
    const { container } = render(<CYFSAGuideTab />);
    const text = container.textContent ?? "";
    expect(text).toContain("1 Free Quick Review and 1 Free Forensic Deep Scan, then upgrade");
    expect(text).toContain("1 free Quick Document Review and 1 free Forensic Deep Scan");
    expect(text).not.toMatch(/3 free quick/i);
  });

  it("/api/access-pricing lists the server's free allowance and the paid-only features", async () => {
    const text = JSON.stringify(await (await accessPricing()).json());
    expect(text).toContain("1 Free Quick Document Review and 1 Free Forensic Deep Scan, once per verified email");
    expect(text).toContain("up to 30 pages and 10 MB");
    expect(text).toContain("Audio transcription and Final Case Assessment require a paid plan");
    expect(text).not.toMatch(/3 Free Quick/i);
  });
});
