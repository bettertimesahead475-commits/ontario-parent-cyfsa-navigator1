/**
 * GET /api/status - readiness of this staging deployment. Public callers get only whether live analysis is ready;
 * a caller presenting ADMIN_SECRET gets which bindings are configured (never their values). See ./_status.ts.
 */
export { onRequestGet } from './_status';
