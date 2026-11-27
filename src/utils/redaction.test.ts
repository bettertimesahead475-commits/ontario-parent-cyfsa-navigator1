import { describe, expect, it } from "vitest";
import { redactPiiText } from "./redaction";

describe("redactPiiText court file numbers", () => {
  it.each(["FC-19-1234", "FC-19-00012345-0000", "FO-21-567-00", "FS-19-1234", "C1234/19", "CFO-20-12345"])("masks %s", (file) => {
    expect(redactPiiText(`Court file ${file} was heard.`)).toBe("Court file [FILE] was heard.");
  });

  it("leaves statute citations and phone numbers to their own handling", () => {
    expect(redactPiiText("s. 74(2)(l) applies; call 416-555-0199")).toBe("s. 74(2)(l) applies; call [PHONE]");
  });

  it("keeps a word that follows a file number after a hyphen", () => {
    expect(redactPiiText("FC-19-1234-Denied without prejudice")).toBe("[FILE]-Denied without prejudice");
  });
});

describe("redactPiiText known names", () => {
  it("masks names with accents at either end", () => {
    expect(redactPiiText("Zoë said Éloïse and Chloé were present.", ["Zoë", "Éloïse", "Chloé"])).toBe(
      "[NAME] said [NAME] and [NAME] were present."
    );
  });

  it("treats punctuation in a name literally instead of throwing or over-matching", () => {
    expect(redactPiiText("Mary (MJ) O'Brien met J.R. Smith; JxR Smith was absent.", ["Mary (MJ) O'Brien", "J.R. Smith"])).toBe(
      "[NAME] met [NAME]; JxR Smith was absent."
    );
  });

  it("does not mask a name inside a longer word, and ignores blank or non-string entries", () => {
    expect(redactPiiText("Ann and Annette", ["Ann", "  ", undefined as never])).toBe("[NAME] and Annette");
  });
});
