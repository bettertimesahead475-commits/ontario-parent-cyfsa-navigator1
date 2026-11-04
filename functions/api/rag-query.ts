/**
 * Cloudflare Pages Functions - POST /api/rag-query
 *
 * Backward-compatibility wrapper for legacy /api/rag-query requests.
 * Internally delegates to the upgraded Kace interactive AI engine.
 */

import { handleChatRequest, type ChatEnv } from './chat';

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: ChatEnv;
}): Promise<Response> => {
  return handleChatRequest(request, env);
};
