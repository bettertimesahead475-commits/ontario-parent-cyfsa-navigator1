// Runs the exact row-level statements that freeUsageStore.ts issues (through PostgREST), against a real
// PostgreSQL database, under concurrency. The mocked tests prove the application logic; this proves the
// database guarantees it relies on: a primary-key insert admits one winner, a compare-and-set update changes
// one row only when the expected value still holds, and a conditional marker transition happens once.
//
// Skipped unless CREDIT_PG_URL is set. It creates and drops its own schema and touches no other data:
//   CREDIT_PG_URL=postgres://user:pass@host:5432/db npx vitest run api/services/freeUsageStore.pg.test.ts

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const schema = `credit_verify_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

describe.skipIf(!url)("free_usage row guarantees on real PostgreSQL", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 40 });
    await pool.query(`create schema ${schema}`);
    await pool.query(`
      create table ${schema}.free_usage (
        uid text primary key,
        email text,
        analyses_used integer not null default 0,
        first_analysis_at timestamptz,
        last_analysis_at timestamptz
      )`);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`drop schema if exists ${schema} cascade`);
      await pool.end();
    }
  });

  // The same loop as creditAccounting.claimCounterUnit: read, compare-and-set, retry on a lost race.
  async function claimOne(uid: string, granted: number): Promise<"claimed" | "limit"> {
    for (;;) {
      const read = await pool.query(`select analyses_used from ${schema}.free_usage where uid = $1`, [uid]);
      const used = read.rows[0]?.analyses_used ?? 0;
      if (used >= granted) return "limit";
      if (read.rows.length === 0) {
        try {
          await pool.query(`insert into ${schema}.free_usage (uid, analyses_used) values ($1, 1)`, [uid]);
          return "claimed";
        } catch (err: any) {
          if (err.code !== "23505") throw err;
          continue;
        }
      }
      const cas = await pool.query(
        `update ${schema}.free_usage set analyses_used = $2 where uid = $1 and analyses_used = $3 returning uid`,
        [uid, used + 1, used]
      );
      if (cas.rowCount === 1) return "claimed";
    }
  }

  it("twenty concurrent reservations against a limit of three: exactly three win and the counter is exact", async () => {
    const uid = "paid_session_limit_check_total";
    const results = await Promise.all(Array.from({ length: 20 }, () => claimOne(uid, 3)));
    expect(results.filter((r) => r === "claimed")).toHaveLength(3);
    const row = await pool.query(`select analyses_used from ${schema}.free_usage where uid = $1`, [uid]);
    expect(row.rows[0].analyses_used).toBe(3);
  });

  it("thirty concurrent first-time inserts of one uid: exactly one wins, the rest get 23505", async () => {
    const uid = "paid_session_first_insert_total";
    const outcomes = await Promise.allSettled(
      Array.from({ length: 30 }, () => pool.query(`insert into ${schema}.free_usage (uid, analyses_used) values ($1, 1)`, [uid]))
    );
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled").length;
    const duplicates = outcomes.filter((o) => o.status === "rejected" && (o.reason as any).code === "23505").length;
    expect(fulfilled).toBe(1);
    expect(duplicates).toBe(29);
  });

  it("twenty concurrent increments on one counter lose no updates", async () => {
    const uid = "paid_session_increment_total";
    await Promise.all(Array.from({ length: 20 }, () => claimOne(uid, 1000)));
    const row = await pool.query(`select analyses_used from ${schema}.free_usage where uid = $1`, [uid]);
    expect(row.rows[0].analyses_used).toBe(20);
  });

  it("twenty concurrent transitions of one marker: exactly one reports the change", async () => {
    const uid = "paid_res_marker_check_0001";
    await pool.query(`insert into ${schema}.free_usage (uid, email, analyses_used) values ($1, 'reservation:reserved', 1)`, [uid]);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          `update ${schema}.free_usage set email = 'reservation:released' where uid = $1 and email = 'reservation:reserved' returning uid`,
          [uid]
        )
      )
    );
    expect(results.filter((r) => r.rowCount === 1)).toHaveLength(1);
  });
});
