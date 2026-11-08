/**
 * Staging-only entitlement gate. Never grants access without verified database
 * state. Deliberately does not attempt credit accounting or mutate data.
 */
interface Env {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  // This is an explicit migration guard, not an entitlement implementation.
  // Firebase authentication and Supabase-backed paid/free checks must both
  // be verified before replacing this fail-closed response.
  return Response.json({
    entitled: false,
    analyzerReady: false,
    code: 'ENTITLEMENT_VERIFICATION_PENDING',
    databaseConfigured: Boolean(env.STAGING_SUPABASE_URL && env.STAGING_SUPABASE_READ_KEY),
  }, { status: 503, headers });
};
