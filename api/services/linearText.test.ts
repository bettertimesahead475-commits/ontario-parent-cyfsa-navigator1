// shared/linearText.ts replaces regular expressions that backtracked super-linearly (SonarCloud S8786).
// Each helper is checked against the ORIGINAL pattern on hand-picked and seeded random inputs (so the
// observable result is unchanged), then timed on an input crafted to make the original pattern slow.
import { describe, expect, it } from "vitest";
import {
  extractFencedBlock,
  replaceAngleTags,
  replaceEmailAddresses,
  SIMPLE_EMAIL_SHAPE,
  stripJsonCodeFence,
  stripSpacesBeforeNewlines,
  trimCharacters,
} from "../../shared/linearText";

/** Deterministic pseudo-random strings over a small alphabet, so the edge cases actually collide. */
function randomStrings(alphabet: string[], count: number, maxLength: number, seed = 12345): string[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = Math.floor(next() * (maxLength + 1));
    let s = "";
    for (let j = 0; j < length; j++) s += alphabet[Math.floor(next() * alphabet.length)];
    out.push(s);
  }
  return out;
}

/** Milliseconds taken by fn (best of three, so one slow scheduler tick cannot fail the test). */
function elapsedMs(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

const FENCE_ALPHABET = ["`", "`", "`", "j", "s", "o", "n", "J", "S", "O", "N", " ", "\n", "\t", "x", "{", "}", "\u00a0", "\u2028"];

describe("extractFencedBlock", () => {
  const variants = [
    { options: { trimTrailingWhitespace: true }, old: /```(?:json)?\s*([\s\S]*?)\s*```/ },
    { options: { ignoreCase: true }, old: /```(?:json)?\s*([\s\S]*?)```/i },
    { options: { ignoreCase: true, allowUnterminated: true }, old: /```(?:json)?\s*([\s\S]*?)(?:```|$)/i },
    { options: {}, old: /```(?:json)?\s*([\s\S]*?)```/ },
  ];

  it("returns the same block as the original patterns on representative model output", () => {
    const samples = [
      'Here you go:\n```json\n{"a": 1}\n```\nThanks',
      '```JSON {"a":1}   ```',
      "```\n[1,2]\n```",
      "```json```",
      "``````",
      "no fence at all",
      '```json\n{"truncated": tr',
      "```jsonx\n{}\n```",
      "`` not a fence ``",
      '```json\n{"a":1}\n```\n```json\n{"b":2}\n```',
    ];
    for (const { options, old } of variants) {
      for (const s of samples) expect(extractFencedBlock(s, options), `${old} on ${JSON.stringify(s)}`).toBe(old.exec(s)?.[1] ?? null);
    }
    expect(extractFencedBlock('```json\n{"a": 1}\n```', { trimTrailingWhitespace: true })).toBe('{"a": 1}');
  });

  it("agrees with the original patterns on 20,000 random strings", () => {
    for (const { options, old } of variants) {
      for (const s of randomStrings(FENCE_ALPHABET, 5000, 24)) {
        expect(extractFencedBlock(s, options), `${old} on ${JSON.stringify(s)}`).toBe(old.exec(s)?.[1] ?? null);
      }
    }
  });

  it("is linear on an unclosed fence followed by 50,000 spaces (cubic for the original)", () => {
    const attack = "```" + " ".repeat(50_000) + "x";
    expect(extractFencedBlock(attack, { trimTrailingWhitespace: true })).toBeNull();
    expect(extractFencedBlock(attack, { ignoreCase: true })).toBeNull();
    expect(elapsedMs(() => extractFencedBlock(attack, { trimTrailingWhitespace: true }))).toBeLessThan(100);
    expect(elapsedMs(() => extractFencedBlock(attack, { ignoreCase: true }))).toBeLessThan(100);
  });
});

describe("stripJsonCodeFence", () => {
  const old = (s: string) => s.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");

  it("strips the same fences as the original pattern", () => {
    const samples = ['```json\n{"a":1}\n```', '  ```\n{"a":1}```  \n', '{"a":1}', '{"a":1}\n```', "```json```", "```", "````", "```json   ```", "x ``` y", " \n"];
    for (const s of samples) expect(stripJsonCodeFence(s), JSON.stringify(s)).toBe(old(s));
    expect(stripJsonCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("agrees with the original pattern on 10,000 random strings", () => {
    for (const s of randomStrings(FENCE_ALPHABET, 10_000, 24, 777)) expect(stripJsonCodeFence(s), JSON.stringify(s)).toBe(old(s));
  });

  it("is linear on 50,000 spaces before a non-fence character (quadratic for the original)", () => {
    const attack = "{" + " ".repeat(50_000) + "}";
    expect(stripJsonCodeFence(attack)).toBe(attack);
    expect(elapsedMs(() => stripJsonCodeFence(attack))).toBeLessThan(100);
  });
});

describe("trimCharacters", () => {
  it("matches the anchored-alternation trims it replaces", () => {
    const ascii = " \t\n\u000b\f\r";
    const oldAscii = (s: string) => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "");
    const oldSlash = (s: string) => s.replace(/\/+$/, "");
    const oldPadding = (s: string) => s.replace(/=+$/, "");
    for (const s of randomStrings(["=", "a", "-", "_"], 2000, 8, 5)) expect(trimCharacters(s, "=", { end: true }), s).toBe(oldPadding(s));
    for (const s of randomStrings([" ", "\t", "\n", "\u000b", "\f", "\r", "a", "@", "\u00a0", "/"], 5000, 16, 99)) {
      expect(trimCharacters(s, ascii), JSON.stringify(s)).toBe(oldAscii(s));
      expect(trimCharacters(s, "/", { end: true }), JSON.stringify(s)).toBe(oldSlash(s));
    }
  });

  it("is linear on a 50,000-character run that is not at the edge", () => {
    const attack = "a" + " ".repeat(50_000) + "a";
    expect(trimCharacters(attack, " \t\n\u000b\f\r")).toBe(attack);
    expect(elapsedMs(() => trimCharacters(attack, " \t\n\u000b\f\r"))).toBeLessThan(100);
  });
});

describe("stripSpacesBeforeNewlines", () => {
  const old = (s: string) => s.replace(/[ \t]+\n/g, "\n");

  it("agrees with the original pattern", () => {
    expect(stripSpacesBeforeNewlines("a  \nb\t\n\n c ")).toBe("a\nb\n\n c ");
    for (const s of randomStrings([" ", "\t", "\n", "a", "\r"], 10_000, 20, 4242)) expect(stripSpacesBeforeNewlines(s), JSON.stringify(s)).toBe(old(s));
  });

  it("is linear on 50,000 spaces that do not end a line (quadratic for the original)", () => {
    const attack = "a" + " ".repeat(50_000) + "a";
    expect(stripSpacesBeforeNewlines(attack)).toBe(attack);
    expect(elapsedMs(() => stripSpacesBeforeNewlines(attack))).toBeLessThan(100);
  });
});

describe("replaceAngleTags", () => {
  const old = (s: string) => s.replace(/<[^>]*>/g, " ");

  it("agrees with the original pattern", () => {
    expect(replaceAngleTags("<html><body>Error <b>401</b></body>", " ")).toBe(old("<html><body>Error <b>401</b></body>"));
    expect(replaceAngleTags("a<b<c>d<e", " ")).toBe(old("a<b<c>d<e"));
    for (const s of randomStrings(["<", ">", "a", " ", "/"], 10_000, 20, 31337)) expect(replaceAngleTags(s, " "), JSON.stringify(s)).toBe(old(s));
  });

  it("is linear on 50,000 unclosed '<' (quadratic for the original)", () => {
    const attack = "<".repeat(50_000);
    expect(replaceAngleTags(attack, " ")).toBe(attack);
    expect(elapsedMs(() => replaceAngleTags(attack, " "))).toBeLessThan(100);
  });
});

describe("SIMPLE_EMAIL_SHAPE", () => {
  const old = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it("accepts exactly the strings the original pattern accepted", () => {
    for (const s of ["jane@example.com", "a@b.c", "a@.b.c", "a@b..c", "a@.b", "a@b.", "a@b", "@b.c", "a b@c.d", "a@b@c.d", "a@b.c "]) {
      expect(SIMPLE_EMAIL_SHAPE.test(s), s).toBe(old.test(s));
    }
    for (const s of randomStrings(["a", "b", ".", ".", "@", " ", "\t", "-"], 20_000, 12, 8080)) expect(SIMPLE_EMAIL_SHAPE.test(s), JSON.stringify(s)).toBe(old.test(s));
  });

  it("is linear on a 50,000-character dotted domain followed by a space (quadratic for the original)", () => {
    const attack = "a@" + "a.".repeat(25_000) + " ";
    expect(SIMPLE_EMAIL_SHAPE.test(attack)).toBe(false);
    expect(elapsedMs(() => SIMPLE_EMAIL_SHAPE.test(attack))).toBeLessThan(100);
  });
});

describe("replaceEmailAddresses", () => {
  const old = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");

  it("redacts exactly what the original pattern redacted", () => {
    const samples = [
      "Contact jane.doe+cas@example.org or bob@mail.example.co.uk today.",
      "x@y.comz@w.org",
      "a@b.cc1@d.ee",
      "not an email: user@localhost, @example.com, user@.com, user@ex.c",
      "trailing.dot@example.com.",
      "a@b..cc",
      "mixed@Case.COM-x",
    ];
    for (const s of samples) expect(replaceEmailAddresses(s, "[email]"), s).toBe(old(s));
    expect(replaceEmailAddresses("Write to jane@example.org.", "[email]")).toBe("Write to [email].");
  });

  it("agrees with the original pattern on 20,000 random strings", () => {
    const alphabet = ["a", "Z", "1", ".", ".", "-", "_", "%", "+", "@", "@", " ", "c", "o", "m", "!"];
    for (const s of randomStrings(alphabet, 20_000, 24, 2024)) expect(replaceEmailAddresses(s, "[email]"), JSON.stringify(s)).toBe(old(s));
  });

  it("is linear on 50,000 address characters with no '@' (quadratic for the original)", () => {
    const attack = "a".repeat(50_000) + "!";
    expect(replaceEmailAddresses(attack, "[email]")).toBe(attack);
    expect(elapsedMs(() => replaceEmailAddresses(attack, "[email]"))).toBeLessThan(100);
    const attack2 = "a".repeat(25_000) + "@" + "b".repeat(25_000);
    expect(replaceEmailAddresses(attack2, "[email]")).toBe(attack2);
    expect(elapsedMs(() => replaceEmailAddresses(attack2, "[email]"))).toBeLessThan(100);
  });
});
