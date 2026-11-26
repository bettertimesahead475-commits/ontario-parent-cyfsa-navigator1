// Application-to-database parity for the pending migration's quote matcher (DEVIN-P2-04).
// The database functions in supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql must
// agree with pageSources.ts verifyQuote on every case below. Runs only where CREDIT_PG_URL is set; CI sets it against
// the postgres:16 service container. Creates and drops its own schema; it touches no other data.
//   CREDIT_PG_URL=postgres://user:pass@host:5432/db npx vitest run api/services/navigatorQuoteHits.pg.test.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { verifyQuote } from "./pageSources";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, "../../supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql");

/** Extracts one `create function public.<name> ... end $$;` (or `... $$;` for SQL bodies) block from the migration. */
function extractFunction(sql: string, name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in migration`);
  const bodyStart = sql.indexOf("$$", start);
  const end = sql.indexOf("$$;", bodyStart + 2);
  if (bodyStart < 0 || end < 0) throw new Error(`function ${name} body not delimited`);
  return sql.slice(start, end + 3);
}

/** Expected database hit count for the exact matcher, derived from the application verdict. */
function appHits(source: string, quote: string): number {
  const v = verifyQuote(source, quote).status;
  if (v === "EXACT") return 1;
  if (v === "AMBIGUOUS") return 2;
  return 0;
}

const CASES: { name: string; source: string; quote: string }[] = [
  { name: "exact single occurrence", source: "The child was placed in care.", quote: "placed in care" },
  { name: "partial word at the start is not a match", source: "The scare was over.", quote: "care" },
  { name: "partial word at the end is not a match", source: "The careful plan.", quote: "care" },
  { name: "two occurrences are ambiguous", source: "the order and the order", quote: "the order" },
  { name: "overlapping partial-word matches are all cut", source: "aaaa", quote: "aa" },
  { name: "contraction is not cut before 't", source: "She can't attend.", quote: "She can" },
  { name: "contraction with the full word matches", source: "She can't attend.", quote: "can't" },
  { name: "Unicode apostrophe contraction is not cut", source: "She can’t attend.", quote: "She can" },
  { name: "negation kept: 'not' inside a word is not a match", source: "It is notable.", quote: "not" },
  { name: "negation kept: 'not' as a whole word matches", source: "It is not valid.", quote: "not" },
  { name: "em dash in the quote", source: "The order — the second one — stands.", quote: "— the second one —" },
  { name: "curly quotes in the source", source: "He said “no” today.", quote: "“no”" },
  { name: "empty quote", source: "anything", quote: "" },
  { name: "whitespace-only quote", source: "anything", quote: "   " },
  { name: "quote absent", source: "The child was placed.", quote: "missing words" },
  { name: "quote at the very start of the source", source: "Start here and go on.", quote: "Start here" },
  { name: "quote at the very end of the source", source: "Go on and end here", quote: "end here" },
  { name: "quote equals the whole source", source: "Exactly this.", quote: "Exactly this." },
  { name: "long document, quote at the end", source: "filler text here. ".repeat(3000) + "The final clause.", quote: "The final clause." },
  { name: "long document, quote in the middle, occurs once", source: "filler text here. ".repeat(1500) + "MARKER-ONE" + " filler text here.".repeat(1500), quote: "MARKER-ONE" },
  { name: "punctuation inside the quote", source: "Section 74(2)(d.1) applies.", quote: "74(2)(d.1)" },
  { name: "quote crossing a line break (normalized whitespace)", source: "placed\nin care", quote: "placed in care" },
];

describe.skipIf(!url)("navigator_quote_hits parity with pageSources.verifyQuote (PostgreSQL)", () => {
  let client: pg.Client;
  let schema: string;

  beforeAll(async () => {
    schema = `qh_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const sql = readFileSync(MIGRATION, "utf8");
    // The matcher and its normalization only; the migration's other functions are not needed here.
    const normalize = extractFunction(sql, "navigator_quote_normalize").replace(/public\./g, `${schema}.`);
    const hits = extractFunction(sql, "navigator_quote_hits").replace(/public\./g, `${schema}.`);
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path = ${schema}, pg_catalog`);
    await client.query(normalize);
    await client.query(hits);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`drop schema if exists ${schema} cascade`).catch(() => undefined);
      await client.end();
    }
  });

  for (const c of CASES) {
    it(`matches the application: ${c.name}`, async () => {
      const { rows } = await client.query<{ n: number }>("select navigator_quote_hits($1::text, $2::text) as n", [c.source, c.quote]);
      expect(rows[0].n).toBe(appHits(c.source, c.quote));
    });
  }

  it("the normalized matcher agrees with the application's normalized verdict", async () => {
    for (const c of CASES) {
      const app = verifyQuote(c.source, c.quote).status;
      if (app !== "NORMALIZED_WHITESPACE" && app !== "ABSENT") continue;
      const { rows } = await client.query<{ n: number }>(
        "select navigator_quote_hits(navigator_quote_normalize($1::text), navigator_quote_normalize($2::text)) as n",
        [c.source, c.quote]
      );
      const expected = app === "NORMALIZED_WHITESPACE" ? 1 : 0;
      expect(rows[0].n, c.name).toBe(expected);
    }
  });

  it("a NULL source is rejected by the strict function (returns NULL, never a count)", async () => {
    const { rows } = await client.query<{ n: number | null }>("select navigator_quote_hits(null::text, 'x'::text) as n");
    expect(rows[0].n).toBeNull();
  });
});
