import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./analyzerSections.js";

// Realistic model outputs that a sectioned analysis has to survive. Each is valid content the parent's document
// supports; only the serialization differs.
const cases: Array<[string, string, unknown]> = [
  ["plain object", '{"a": "x"}', { a: "x" }],
  ["fenced object", '```json\n{"a": "x"}\n```', { a: "x" }],
  ["prose before the object", 'Here is the section:\n{"a": "x"}', { a: "x" }],
  ["raw newline inside a string", '{"a": "line one\nline two"}', { a: "line one\nline two" }],
  ["raw tab inside a string", '{"a": "col1\tcol2"}', { a: "col1\tcol2" }],
  ["trailing comma", '{"a": ["x", "y",], "b": 1,}', { a: ["x", "y"], b: 1 }],
  ["brace inside a string", '{"a": "see {note} here"}', { a: "see {note} here" }],
  // Content that looks like the repaired patterns, but is valid string content: it must not change.
  ["comma before brace inside a string", '{"a": "keep,}", "b": 2}', { a: "keep,}", b: 2 }],
  ["escaped newline stays a newline", '{"a": "one\\ntwo"}', { a: "one\ntwo" }],
];

describe("section JSON robustness", () => {
  for (const [name, input, expected] of cases) {
    it(`parses ${name}`, () => {
      expect(parseJsonObject(input)).toEqual(expected);
    });
  }
});
