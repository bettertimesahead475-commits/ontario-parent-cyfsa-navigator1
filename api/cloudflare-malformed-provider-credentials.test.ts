import { describe, expect, it, vi } from 'vitest';
import { generateGemini, listGeminiModels } from '../functions/api/_gemini';
import { createCloudflareGenerateFn } from '../functions/api/_analyzer-model-adapter';
describe('observed malformed staging credentials',()=>{
 it('classifies the empty Gemini 400 with a too-short key as configuration, not damaged PDF or request rejection',async()=>{
  const fetcher=vi.fn(async()=>new Response('',{status:400}));
  await expect(generateGemini({GEMINI_API_KEY:'short-placeholder'},'gemini-2.5-flash',{}, {timeoutMs:1000,fetcher:fetcher as typeof fetch})).rejects.toMatchObject({kind:'NOT_CONFIGURED',diagnostic:{httpStatus:400,responseLength:0}});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('identifies the same failure without a PDF via model listing',async()=>{
  await expect(listGeminiModels({GEMINI_API_KEY:'short-placeholder'},vi.fn(async()=>new Response('',{status:400})) as typeof fetch)).rejects.toMatchObject({kind:'NOT_CONFIGURED'});
 });
 it('keeps a real structured invalid-request classification distinct',async()=>{
  await expect(generateGemini({GEMINI_API_KEY:'short-placeholder'},'gemini-2.5-flash',{}, {timeoutMs:1000,fetcher:vi.fn(async()=>Response.json({error:{status:'INVALID_ARGUMENT',message:'invalid input'}},{status:400})) as typeof fetch})).rejects.toMatchObject({kind:'BAD_REQUEST'});
 });
 it('classifies the observed empty Anthropic 400 as a non-retryable service configuration failure',async()=>{
  const fetcher=vi.fn(async()=>new Response('',{status:400}));const generate=createCloudflareGenerateFn({ANTHROPIC_API_KEY:'short-placeholder'},fetcher as typeof fetch);
  await expect(generate({system:'synthetic',messages:[{role:'user',content:[{type:'text',text:'synthetic fixture'}]}],max_tokens:100,timeoutMs:1000,requestId:'synthetic-check',stage:'overview',mode:'fast'},'claude-sonnet-5')).rejects.toMatchObject({code:'AI_PROVIDER_CONFIGURATION_ERROR',statusCode:503,retryable:false});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
