/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ASSESSMENT_REQUEST_MAX_BYTES, SOURCE_SET_LIMIT_MESSAGE, SOURCE_SET_NOTICE, sourceRequestBody, sourceUploadProblem, utf8ByteLength } from "../../shared/assessmentLimits";

const MATTER = { id: "11111111-1111-4111-8111-111111111111", title: "Synthetic matter" };
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const body = !url.includes("matterId=") ? { matters: [MATTER] } : url.includes("action=source") ? { saved: true } : { report: null };
  return { ok: true, json: async () => body };
});
vi.mock("../utils/api", () => ({ apiFetch: (url: string, init?: { method?: string; body?: string }) => apiFetch(url, init) }));
const { default: FinalCaseAssessment } = await import("./FinalCaseAssessment");

/** Text whose serialized source request is exactly `bytes` UTF-8 bytes, using 2-byte characters. */

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
    // Three-byte characters, so the byte limit is reached well inside the matter's 75,000-character limit.
    const room = ASSESSMENT_REQUEST_MAX_BYTES - utf8ByteLength(sourceRequestBody("a.txt", ""));
    const atLimit = "€".repeat(Math.floor(room / 3)) + "a".repeat(room % 3);
    expect(utf8ByteLength(sourceRequestBody("a.txt", atLimit))).toBe(150000);
    expect(sourceUploadProblem("a.txt", atLimit)).toBeNull();
    const over = atLimit + "a";
    expect(sourceUploadProblem("a.txt", over)).toBe(
      "This document is 150,001 bytes as sent (file name and text); the limit is 150,000 bytes per document. Split the document into several .txt files and add each one to this matter"
    );
  });

  it("counts multi-byte Unicode as UTF-8 bytes, not characters", () => {
    const euros = "€".repeat(50001); // 50,001 characters, 150,003 bytes
    expect(sourceUploadProblem("a.txt", euros)).toContain("bytes as sent");
  });

  it("for the character limit, says the matter's total is the limit and does not suggest splitting", () => {
    const message = sourceUploadProblem("a.txt", "a".repeat(75001));
    expect(message).toBe(
      "This document has 75,001 characters (with its name, 75,081). One assessment reads about 75,000 characters in total across all of a matter's documents, so splitting it will not help. Remove pages that are not evidence for this matter, or move them to a separate matter, then add it again"
    );
  });

  it("rejects a document the server would refuse once its name header is counted (75,000 characters exactly)", () => {
    const message = sourceUploadProblem("a.txt", "a".repeat(75000));
    expect(message).toContain("(with its name, 75,080)");
    expect(message).toContain("splitting it will not help");
    expect(sourceUploadProblem("a.txt", "a".repeat(75000 - 80))).toBeNull();
  });

  it("gives the character message, not split advice, when both limits are exceeded", () => {
    const message = sourceUploadProblem("a.txt", "é".repeat(80000));
    expect(message).toContain("splitting it will not help");
    expect(message).not.toContain("Split the document");
  });

  it("suggests splitting only when the byte limit is the cause", () => {
    const message = sourceUploadProblem("a.txt", "€".repeat(50001)); // 50,001 characters, 150,003+ bytes
    expect(message).toContain("bytes as sent");
    expect(message).toContain("Split the document into several .txt files and add each one to this matter");
  });

  it("explains the matter-wide limit when the server reports SOURCE_SET_TOO_LARGE", () => {
    expect(SOURCE_SET_LIMIT_MESSAGE).toBe(
      "This matter has more source text than one assessment can read: about 75,000 characters in total, including each document's name, across up to 20 documents. Remove pages that are not evidence for this matter, or move them to a separate matter"
    );
    expect(SOURCE_SET_NOTICE).toBe("One assessment reads about 75,000 characters in total, including each document's name, across up to 20 documents in a matter.");
  });

  it("rejects a file name over 255 characters before sending", () => {
    expect(sourceUploadProblem("n".repeat(252) + ".txt", "text")).toContain("256 characters; the limit is 255");
  });

  it("only ever suggests removing pages that are not evidence", () => {
    for (const msg of [sourceUploadProblem("a.txt", "a".repeat(75001)), sourceUploadProblem("a.txt", "😀".repeat(37500)), SOURCE_SET_LIMIT_MESSAGE]) {
      expect(msg).not.toMatch(/shorten|cut|delete/i);
      if (/remove/i.test(msg!)) expect(msg).toContain("Remove pages that are not evidence for this matter");
    }
  });

  it("does not send a file under 150 KB on disk whose JSON request is over the limit", async () => {
    const quotes = '"'.repeat(50000) + "€".repeat(17000); // 101,000 bytes on disk, ~151,000 bytes once JSON-escaped
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
