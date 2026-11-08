/** Whitelisted provider metadata only. Never return a provider message, request or document text. */
export type ProviderDiagnostic = { httpStatus: number; providerCode: string | null; reason: string | null; category: string };
const codes = new Set(['INVALID_ARGUMENT','FAILED_PRECONDITION','PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND','RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','invalid_request_error','authentication_error','permission_error','not_found_error','rate_limit_error','overloaded_error','api_error','billing_error']);
const reasons = new Set(['API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_SERVICE_BLOCKED','SERVICE_DISABLED','BILLING_DISABLED','CONSUMER_INVALID','API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_ANDROID_APP_BLOCKED','API_KEY_IOS_APP_BLOCKED','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED']);
export function providerDiagnostic(httpStatus: number, body: string): ProviderDiagnostic {
 let error: any; try { error = JSON.parse(body)?.error; } catch {}
 const rawCode = error?.status || error?.type;
 const rawReason = Array.isArray(error?.details) ? error.details.map((d:any) => d?.reason).find((r:any) => reasons.has(r)) : undefined;
 const message = typeof error?.message === 'string' ? error.message : '';
 const category = /credit balance.*too low|insufficient.*credit|out of credits/i.test(message) ? 'INSUFFICIENT_PROVIDER_CREDIT'
  : /key.*(leaked|reported)/i.test(message) ? 'KEY_REPORTED_LEAKED'
  : /API key.*(invalid|not valid|not found|expired)|API_KEY_INVALID|API_KEY_EXPIRED/i.test(message+' '+rawReason) ? 'KEY_INVALID'
  : /SERVICE_DISABLED|API has not been used|service.*disabled/i.test(message+' '+rawReason) ? 'SERVICE_DISABLED'
  : /API_KEY_.*BLOCKED|key.*(restricted|blocked)/i.test(message+' '+rawReason) ? 'KEY_RESTRICTED'
  : /billing|paid plan|payment/i.test(message+' '+rawReason) ? 'BILLING_REQUIRED'
  : /location.*not supported|country.*not.*supported/i.test(message) ? 'LOCATION_UNSUPPORTED'
  : /model.*(not found|not supported|unavailable|invalid|not exist)|not supported for generateContent/i.test(message) ? 'MODEL_UNAVAILABLE'
  : /thinking|budget_tokens|output_config/i.test(message) ? 'THINKING_CONFIGURATION'
  : /max_tokens|maxOutputTokens|token.*limit/i.test(message) ? 'TOKEN_LIMIT'
  : /unknown name|unknown field|unrecognized.*(field|parameter)|pageSize/i.test(message) ? 'REQUEST_FIELD_UNSUPPORTED'
  : !error ? 'NON_JSON_REJECTION' : 'UNCLASSIFIED';
 return { httpStatus, providerCode: codes.has(rawCode) ? rawCode : null, reason: rawReason || null, category };
}
