/**
 * @vitest-environment jsdom
 */
// Evidence-integrity regression tests for the Document Analyzer upload path.
// A recording that cannot be transcribed must never be replaced with placeholder text and analyzed
// as if it were the recording. Only the network helper (apiFetch) and Firebase are mocked.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: mockApiFetch };
});

const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function callsTo(url: string) {
  return mockApiFetch.mock.calls.filter(([u]) => u === url);
}

async function uploadAudio(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File([new Uint8Array([1, 2, 3, 4])], "parent-call.wav", { type: "audio/wav" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  localStorage.clear();
  mockApiFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Document Analyzer: failed transcription is never analyzed as evidence", () => {
  it("does not call /api/analyze when transcription returns a server error, and says why", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/transcribe"
        ? jsonResponse(500, { error: "Transcription service unavailable." })
        : jsonResponse(200, { events: [], conflicts: [], openItems: [] })
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadAudio(container);

    await waitFor(() => expect(callsTo("/api/transcribe")).toHaveLength(1));
    expect(await screen.findAllByText(/could not be transcribed/i, {}, { timeout: 5000 })).not.toHaveLength(0);
    // Give any (incorrect) follow-up analysis time to start before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(callsTo("/api/analyze")).toHaveLength(0);
  });

  it("does not call /api/analyze when transcription succeeds with no text", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/transcribe"
        ? jsonResponse(200, { transcribedText: "   ", fileName: "Transcript - parent-call.pdf" })
        : jsonResponse(200, {})
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadAudio(container);

    await waitFor(() => expect(callsTo("/api/transcribe")).toHaveLength(1));
    expect(await screen.findAllByText(/could not be transcribed/i, {}, { timeout: 5000 })).not.toHaveLength(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(callsTo("/api/analyze")).toHaveLength(0);
  });

  it("never sends the legacy placeholder wording to the analyzer", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/transcribe" ? jsonResponse(500, { error: "down" }) : jsonResponse(200, {})
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadAudio(container);
    await waitFor(() => expect(callsTo("/api/transcribe")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    const everySentBody = mockApiFetch.mock.calls.map(([, init]) => String(init?.body ?? "")).join("\n");
    expect(everySentBody).not.toMatch(/SYSTEM TRANSCRIBING PIPE WARNING|RECORDING STATEMENT FOR|Falling back to parent raw audio/);
  });
});
