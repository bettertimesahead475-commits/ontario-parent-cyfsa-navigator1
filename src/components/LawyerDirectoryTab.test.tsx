import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import LawyerDirectoryTab from "./LawyerDirectoryTab";
import PublicProfileTab from "./PublicProfileTab";

// We mock wouter to avoid navigation context issues
vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useRoute: vi.fn(() => [true, { id: 'prof-1' }])
}));

describe("Stage 7E UI Tests - LawyerDirectoryTab", () => {
  it("directory route renders properly", () => {
    const html = renderToString(<LawyerDirectoryTab />);
    expect(html).toContain("Ontario Child Welfare Lawyer Directory");
    expect(html).toContain("City or Locality");
    expect(html).toContain("Child Protection (CYFSA) Practice");
    expect(html).toContain("Virtual Service Available");
    expect(html).toContain("Ontario-Wide Service");
  });

  it("PUBLIC_LISTING does not imply participation (disclaimer is present)", () => {
    const html = renderToString(<LawyerDirectoryTab />);
    expect(html).toContain("A public listing does not necessarily mean the professional participates");
  });

  it("no lawyer score/ranking/win rate text is present", () => {
    const html = renderToString(<LawyerDirectoryTab />);
    expect(html).not.toContain("score");
    expect(html).not.toContain("ranking");
    expect(html).not.toContain("win rate");
    expect(html).not.toContain("success probability");
  });
});

describe("Stage 7E UI Tests - PublicProfileTab", () => {
  it("public profile route renders correctly", () => {
    const html = renderToString(<PublicProfileTab />);
    // Initially loading state
    expect(html).toContain("Loading professional profile...");
  });
});
