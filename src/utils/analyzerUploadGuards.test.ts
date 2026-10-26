import { describe, expect, it } from "vitest";
import {
  canSendForAnalysis,
  interpretTranscription,
  TRANSCRIPTION_FAILED_MESSAGE,
} from "./analyzerUploadGuards";

describe("interpretTranscription", () => {
  it("accepts transcribed text", () => {
    expect(interpretTranscription({ transcribedText: "Worker said the child was safe." })).toEqual({
      ok: true,
      text: "Worker said the child was safe.",
    });
  });

  it.each([
    ["missing field", {}],
    ["empty string", { transcribedText: "" }],
    ["whitespace only", { transcribedText: " \n\t " }],
    ["non-string", { transcribedText: 42 }],
    ["null body", null],
    ["undefined body", undefined],
  ])("treats %s as a failed transcription", (_label, body) => {
    expect(interpretTranscription(body)).toEqual({ ok: false, error: TRANSCRIPTION_FAILED_MESSAGE });
  });

  it("never returns placeholder text on failure", () => {
    const outcome = interpretTranscription({});
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toMatch(/PIPE WARNING|RECORDING STATEMENT|Falling back/);
  });
});

describe("canSendForAnalysis", () => {
  it("allows files with text or base64 content", () => {
    expect(canSendForAnalysis({ content: "Sworn statement text" })).toBe(true);
    expect(canSendForAnalysis({ content: "JVBERi0xLjQK" })).toBe(true);
  });

  it("blocks empty, whitespace and missing content", () => {
    expect(canSendForAnalysis({ content: "" })).toBe(false);
    expect(canSendForAnalysis({ content: "   " })).toBe(false);
    expect(canSendForAnalysis({ content: null })).toBe(false);
    expect(canSendForAnalysis({ content: undefined })).toBe(false);
  });
});
