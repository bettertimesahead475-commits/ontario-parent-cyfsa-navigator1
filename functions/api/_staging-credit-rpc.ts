/**
 * Server-only Supabase RPC transport for staging. Do not expose this key in
 * browser bundles or responses. The caller must have already authenticated
 * the Firebase UID and verified the paid session's database ownership.
 */
export type StagingRpcEnv = { STAGING_SUPABASE_URL?: string; STAGING_SUPABASE_SERVICE_ROLE_KEY?: string };

export class StagingRpcError extends Error {
  readonly rpcName: string;
  readonly httpStatus: number;
  readonly pgCode: string | null;
  readonly pgMessage: string | null;
  readonly pgDetails: string | null;
  readonly pgHint: string | null;

  constructor(params: {
    rpcName: string;
    httpStatus: number;
    pgCode?: string | null;
    pgMessage?: string | null;
    pgDetails?: string | null;
    pgHint?: string | null;
  }) {
    const summary = [
      `Staging credit RPC ${params.rpcName} failed (HTTP ${params.httpStatus})`,
      params.pgCode ? `[${params.pgCode}]` : null,
      params.pgMessage || null,
    ].filter(Boolean).join(' ');
    super(summary);
    this.name = 'StagingRpcError';
    this.rpcName = params.rpcName;
    this.httpStatus = params.httpStatus;
    this.pgCode = params.pgCode ?? null;
    this.pgMessage = params.pgMessage ?? null;
    this.pgDetails = params.pgDetails ?? null;
    this.pgHint = params.pgHint ?? null;
  }
}

export function createStagingCreditRpc(env: StagingRpcEnv, fetcher: typeof fetch = fetch) {
  return async (name: string, args: Record<string, unknown>): Promise<{ status: string; reservation_id?: string | null; [key: string]: unknown }> => {
    if (!['paid_reserve_credit', 'paid_finalize_credit', 'paid_release_credit', 'free_reserve_scan', 'free_finalize_scan', 'free_release_scan'].includes(name)) {
      throw new Error('Unsupported credit RPC');
    }
    if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Staging RPC not configured');
    const url = new URL('/rest/v1/rpc/' + name, env.STAGING_SUPABASE_URL);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');

    let response: Response;
    try {
      response = await fetcher(url.toString(), {
        method: 'POST',
        headers: {
          apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(args),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (fetchErr: any) {
      console.error(JSON.stringify({
        tag: '[STAGING_RPC_NETWORK_ERROR]',
        rpc: name,
        error: fetchErr?.message || String(fetchErr),
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: 503,
        pgCode: 'NETWORK_TIMEOUT',
        pgMessage: fetchErr?.message || 'RPC transport connection failed',
      });
    }

    if (!response.ok) {
      let pgCode: string | null = null;
      let pgMessage: string | null = null;
      let pgDetails: string | null = null;
      let pgHint: string | null = null;
      try {
        const errPayload: any = await response.json();
        if (errPayload && typeof errPayload === 'object') {
          pgCode = typeof errPayload.code === 'string' ? errPayload.code : null;
          pgMessage = typeof errPayload.message === 'string' ? errPayload.message : null;
          pgDetails = typeof errPayload.details === 'string' ? errPayload.details : null;
          pgHint = typeof errPayload.hint === 'string' ? errPayload.hint : null;
        }
      } catch {
        // Body was not JSON
      }
      console.error(JSON.stringify({
        tag: '[STAGING_RPC_ERROR]',
        rpc: name,
        httpStatus: response.status,
        pgCode,
        pgMessage,
        pgDetails,
        pgHint,
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode,
        pgMessage,
        pgDetails,
        pgHint,
      });
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (parseErr: any) {
      console.error(JSON.stringify({
        tag: '[STAGING_RPC_JSON_PARSE_ERROR]',
        rpc: name,
        error: parseErr?.message || String(parseErr),
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode: 'MALFORMED_JSON',
        pgMessage: 'Response body could not be parsed as JSON',
      });
    }

    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof (value as { status?: unknown }).status !== 'string') {
      console.error(JSON.stringify({
        tag: '[STAGING_RPC_INVALID_PAYLOAD]',
        rpc: name,
        httpStatus: response.status,
        bodyType: Array.isArray(value) ? 'array' : typeof value,
      }));
      throw new StagingRpcError({
        rpcName: name,
        httpStatus: response.status,
        pgCode: 'INVALID_RPC_RESPONSE',
        pgMessage: 'Expected JSON object with status property',
      });
    }

    return value as { status: string; reservation_id?: string | null; [key: string]: unknown };
  };
}
