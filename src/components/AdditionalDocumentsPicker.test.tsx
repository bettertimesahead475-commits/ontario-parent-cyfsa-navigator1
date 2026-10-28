/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdditionalDocumentsPicker } from "./AdditionalDocumentsPicker";
import { buildAdditionalDocuments, eligibleAdditionalFiles, hasExtractedText, MAX_ADDITIONAL_DOCUMENTS } from "../utils/caseDocumentsSelection";

afterEach(cleanup);

const files = [
  { id: "p", name: "Primary affidavit.pdf", mimeType: "application/pdf", content: "[Page 1]\nPrimary text" },
  { id: "a", name: "Case note.txt", mimeType: "text/plain", content: "Home visit March 5." },
  { id: "b", name: "Scan not read yet.pdf", mimeType: "application/pdf", content: "JVBERi0xLjQKJ" + "A".repeat(200) },
  { id: "c", name: "Letter.pdf", mimeType: "application/pdf", content: "Dear Ms. X, ..." },
  { id: "d", name: "Empty.txt", mimeType: "text/plain", content: "   " },
];

describe("choosing other case documents", () => {
  it("offers only files whose text has been read, never the primary file or raw upload data", () => {
    expect(eligibleAdditionalFiles(files, "p").map((f) => f.id)).toEqual(["a", "c"]);
    expect(hasExtractedText(files[2])).toBe(false);
  });

  it("builds the payload in the order chosen, capped at nine, ignoring ineligible ids", () => {
    expect(buildAdditionalDocuments(files, ["c", "b", "a", "p"], "p")).toEqual([
      { title: "Letter.pdf", text: "Dear Ms. X, ..." },
      { title: "Case note.txt", text: "Home visit March 5." },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `n${i}`, mimeType: "text/plain", content: `t${i}` }));
    expect(buildAdditionalDocuments(many, many.map((f) => f.id), null)).toHaveLength(MAX_ADDITIONAL_DOCUMENTS);
  });

  it("lets the parent tick documents up to the limit", () => {
    let chosen: string[] = [];
    const { rerender } = render(<AdditionalDocumentsPicker files={files} primaryId="p" selectedIds={chosen} onChange={(ids) => (chosen = ids)} />);
    fireEvent.click(screen.getByLabelText("Case note.txt"));
    expect(chosen).toEqual(["a"]);
    rerender(<AdditionalDocumentsPicker files={files} primaryId="p" selectedIds={chosen} onChange={(ids) => (chosen = ids)} />);
    expect(screen.getByText(/\(1\/9\)/)).toBeTruthy();
    expect(screen.queryByLabelText("Scan not read yet.pdf")).toBeNull();
  });

  it("explains how to make other files available when none are", () => {
    render(<AdditionalDocumentsPicker files={[files[0], files[2]]} primaryId="p" selectedIds={[]} onChange={() => {}} />);
    expect(screen.getByText(/once their text has been read/)).toBeTruthy();
  });
});
