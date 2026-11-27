import { describe, expect, it } from "vitest";
import { redactPiiText } from "./redaction";

describe("redactPiiText court file numbers", () => {
  it.each(["FC-19-1234", "FC-19-00012345-0000", "FO-21-567-00", "FS-19-1234", "C1234/19", "CFO-20-12345"])("masks %s", (file) => {
    expect(redactPiiText(`Court file ${file} was heard.`)).toBe("Court file [FILE] was heard.");
  });

  it("leaves statute citations and phone numbers to their own handling", () => {
    expect(redactPiiText("s. 74(2)(l) applies; call 416-555-0199")).toBe("s. 74(2)(l) applies; call [PHONE]");
  });
});
