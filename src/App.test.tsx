/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import App from "./App";

vi.mock("./components/ParentJourney", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-parent-journey">Parent Journey Content</div>
}));
vi.mock("./components/DocumentAnalyzerTab", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-document-analyzer">Document Analyzer Content</div>
}));
vi.mock("./components/LawyerDirectoryTab", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-lawyer-directory">Lawyer Directory Content</div>
}));
vi.mock("./components/ProfessionalWorkspace", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-professional-workspace">Professional Workspace Content</div>
}));
vi.mock("./components/RequireAuth", () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="mock-require-auth">{children}</div>
}));

describe("Stage 7E App Routing Regression Tests", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders parent journey by default on root, proving directory is optional", async () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <App />
      </Router>
    );
    expect(await screen.findByTestId("mock-parent-journey")).toBeTruthy();
    expect(screen.queryAllByTestId("mock-lawyer-directory").length).toBe(0);
  });

  it("can navigate to document analyzer proving parent paths remain available", async () => {
    const { hook } = memoryLocation({ path: "/document-analyzer" });
    render(
      <Router hook={hook}>
        <App />
      </Router>
    );
    expect((await screen.findAllByTestId("mock-require-auth")).length).toBeGreaterThan(0);
    expect(await screen.findByTestId("mock-document-analyzer")).toBeTruthy();
  });

  it("can navigate to lawyer directory proving it works alongside parent features", async () => {
    const { hook } = memoryLocation({ path: "/lawyers" });
    render(
      <Router hook={hook}>
        <App />
      </Router>
    );
    expect(await screen.findByTestId("mock-lawyer-directory")).toBeTruthy();
    expect(screen.queryAllByTestId("mock-require-auth").length).toBe(0);
  });

  it("can navigate to professional workspace proving it remains distinct and protected", async () => {
    const { hook } = memoryLocation({ path: "/professional-workspace" });
    render(
      <Router hook={hook}>
        <App />
      </Router>
    );
    expect((await screen.findAllByTestId("mock-require-auth")).length).toBeGreaterThan(0);
    expect(await screen.findByTestId("mock-professional-workspace")).toBeTruthy();
  });
});
