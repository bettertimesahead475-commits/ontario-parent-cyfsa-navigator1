import pg from 'pg';

let pool: pg.Pool | null = null;

export async function executeHumanReview(params: {
  uid: string;
  matterId: string;
  objectType: string;
  objectId: string;
  state: string;
  expectedUpdatedAt: string;
}) {
  const url = process.env.HUMAN_REVIEW_DATABASE_URL;
  if (!url) {
    throw new Error('Missing HUMAN_REVIEW_DATABASE_URL. Human review DB capability is unconfigured.');
  }

  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      max: 1,
      ssl: { rejectUnauthorized: false }
    });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT public.navigator_intelligence_review_update($1, $2, $3, $4, $5, $6) as data`,
      [params.uid, params.matterId, params.objectType, params.objectId, params.state, params.expectedUpdatedAt]
    );
    return { data: result.rows[0]?.data, error: null };
  } catch (err: any) {
    return { data: null, error: { code: err.code, message: err.message } };
  } finally {
    client.release();
  }
}
