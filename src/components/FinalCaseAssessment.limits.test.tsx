/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ASSESSMENT_REQUEST_MAX_BYTES, sourceRequestBody, sourceUploadProblem, utf8ByteLength } from "../../shared/assessmentLimits";

const MATTER = { id: "11111111-1111-4111-8111-111111111111", title: "Synthetic matter" };
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const body = !url.includes("matterId=") ? { matters: [MATTER] } : url.includes("action=source") ? { saved: true } : { report: null };
  return { ok: true, json: async () => body };
});
vi.mock("../utils/api", () => ({ apiFetch: (url: string, init?: { method?: string; body?: string }) => apiFetch(url, init) }));
const { default: FinalCaseAssessment } = await import("./FinalCaseAssessment");

/** Text whose serialized source request is exactly `bytes` UTF-8 bytes, using 2-byte characters. */
function textForBodyBytes(filename: string, bytes: number): string {
  const overhead = utf8ByteLength(sourceRequestBody(filename, ""));
  const room = bytes - overhead;
  return "é".repeat(Math.floor(room / 2)) + "a".repeat(room % 2);
}

beforeEach(() => { apiFetch.mockClear(); });
afterEach(() => cleanup());

async function uploadFile(name: string, text: string) {
  render(<FinalCaseAssessment />);
  fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
  fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: MATTER.id } });
  await screen.findByRole("status");
  const input = screen.getByLabelText("Add a text document to this matter") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([text], name, { type: "text/plain" })] } });
}
const sourcePosts = () => apiFetch.mock.calls.filter(([url]) => url.includes("action=source"));

describe("Final Case Assessment source size limits", () => {
  it("accepts a request of exactly the server's byte limit and rejects one byte more", () => {
    const atLimit = textForBodyBytes("a.txt", ASSESSMENT_REQUEST_MAX_BYTES);
    expect(utf8ByteLength(sourceRequestBody("a.txt", atLimit))).toBe(150000);
    expect(sourceUploadProblem("a.txt", atLimit)).toBeNull();
    const over = atLimit + "a";
    expect(sourceUploadProblem("a.txt", over)).toBe(
      "This document is 150,001 bytes as sent (file name and text); the limit is 150,000 bytes per document. Split the document into several .txt files and add each one to this matter"
    );
  });

  it("counts multi-byte Unicode as UTF-8 bytes, not characters", () => {
    const emoji = "😀".repeat(37500); // 75,000 UTF-16 units, 150,000 bytes
    expect(sourceUploadProblem("a.txt", emoji)).toContain("bytes as sent");
  });

  it("enforces the server's 75,000-character limit per document", () => {
    const message = sourceUploadProblem("a.txt", "a".repeat(75001));
    expect(message).toContain("75,001 characters; the limit is 75,000 characters per document");
    // Parts in the same matter would still exceed the matter's 75,000-character total.
    expect(message).toContain("put the parts in separate matters");
    expect(message).not.toContain("to this matter");
  });

  it("rejects a file name over 255 characters before sending", () => {
    expect(sourceUploadProblem("n".repeat(252) + ".txt", "text")).toContain("256 characters; the limit is 255");
  });

  it("never suggests removing evidence", () => {
    for (const msg of [sourceUploadProblem("a.txt", "a".repeat(75001)), sourceUploadProblem("a.txt", "😀".repeat(37500))]) {
      expect(msg).toContain("Split the document into several .txt files");
      expect(msg).not.toMatch(/shorten|remove|cut|delete/i);
    }
  });

  it("does not send a file under 150 KB on disk whose JSON request is over the limit", async () => {
    const quotes = '"'.repeat(74990); // 74,990 bytes on disk, ~150,010 bytes once JSON-escaped
    await uploadFile("quotes.txt", quotes);
    expect((await screen.findByRole("alert")).textContent).toContain("bytes as sent");
    expect(sourcePosts()).toHaveLength(0);
  });

  it("does not send a file whose name is longer than the server accepts", async () => {
    await uploadFile("n".repeat(252) + ".txt", "Synthetic text.");
    expect((await screen.findByRole("alert")).textContent).toContain("the limit is 255");
    expect(sourcePosts()).toHaveLength(0);
  });

  it("sends each of several in-limit documents with the exact checked body", async () => {
    await uploadFile("one.txt", "Synthetic document one.");
    await waitFor(() => expect(sourcePosts()).toHaveLength(1));
    const input = screen.getByLabelText("Add a text document to this matter") as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { files: [new File(["Synthetic document two — é"], "two.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(sourcePosts()).toHaveLength(2));
    expect(sourcePosts()[1][1]?.body).toBe(sourceRequestBody("two.txt", "Synthetic document two — é"));
  });
});
