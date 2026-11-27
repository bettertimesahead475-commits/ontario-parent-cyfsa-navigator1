// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import CYFSAGuideTab from "./CYFSAGuideTab";
import { FREE_SCAN_LIMIT } from "../../functions/api/_free-credit-reservation";
import { onRequestGet as accessPricing } from "../../functions/api/access-pricing";

afterEach(cleanup);

describe("free Quick Review wording matches the server allowance", () => {
  it("the server allows 3 free Quick Reviews per signed-in account", () => {
    expect(FREE_SCAN_LIMIT).toBe(3);
  });

  it("the CYFSA Guide states 3 free Quick Document Reviews and no free evidence extraction", () => {
    const { container } = render(<CYFSAGuideTab />);
    const text = container.textContent ?? "";
    expect(text).toContain("3 Free Quick Document Reviews, then upgrade");
    expect(text).toContain("3 free Quick Document Reviews");
    expect(text).not.toMatch(/1 free (document review|evidence extraction)/i);
  });

  it("/api/access-pricing lists the server's free allowance", async () => {
    const body = await (await accessPricing()).json();
    const text = JSON.stringify(body);
    expect(text).toContain(`${FREE_SCAN_LIMIT} Free Quick Document Reviews`);
    expect(text).not.toContain("1 Free Quick Document Review");
  });
});
