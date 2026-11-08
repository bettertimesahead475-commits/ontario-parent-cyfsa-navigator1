import { beforeEach, describe, expect, it, vi } from 'vitest';
const { verify, pipeline } = vi.hoisted(() => ({ verify: vi.fn(), pipeline: vi.fn() }));
vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: verify }));
vi.mock('../api/services/analyzerSections', () => ({ runSectionedAnalysis: pipeline }));
import { handleProviderCheck } from '../functions/api/admin/analyzer-provider-check';
const env = { FIREBASE_PROJECT_ID:'cyfsa-navigator-e2e-20261108', ANALYZER_ENABLED:'false', STAGING_PROVIDER_CHECKS_ENABLED:'true', STAGING_PROVIDER_CHECK_UIDS:'dedicated-user', ANTHROPIC_API_KEY:'not-a-real-key' };
const req = (body: object = {mode:'fast'}, host='cyfsa-navigator-staging.pages.dev') => new Request(`https://${host}/api/admin/analyzer-provider-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();verify.mockResolvedValue({status:'verified',uid:'dedicated-user'});});
describe('fixed synthetic provider diagnostics authorization',()=>{
 it('is absent on the public production origin',async()=>{expect((await handleProviderCheck(req({},'cyfsanavigator.com'),env)).status).toBe(404);expect(verify).not.toHaveBeenCalled();});
 it('requires disabled chargeable analysis and an explicit staging flag',async()=>{for(const patch of [{ANALYZER_ENABLED:'true'},{STAGING_PROVIDER_CHECKS_ENABLED:undefined},{FIREBASE_PROJECT_ID:'gen-lang-client-0105737183'}])expect((await handleProviderCheck(req(),{...env,...patch})).status).toBe(404);});
 it('requires Firebase verification',async()=>{verify.mockResolvedValue({status:'denied'});expect((await handleProviderCheck(req(),env)).status).toBe(401);expect(pipeline).not.toHaveBeenCalled();});
 it('rejects every authenticated UID outside the explicit test allowlist',async()=>{verify.mockResolvedValue({status:'verified',uid:'another-user'});expect((await handleProviderCheck(req(),env)).status).toBe(403);expect(pipeline).not.toHaveBeenCalled();});
 it('cannot submit arbitrary documents or model overrides',async()=>{for(const body of [{mode:'fast',documentText:'customer data'},{mode:'full',model:'anything'},{mode:'other'}])expect((await handleProviderCheck(req(body),env)).status).toBe(400);expect(pipeline).not.toHaveBeenCalled();});
 it('runs the real pipeline boundary only with the fixed synthetic fixture',async()=>{pipeline.mockResolvedValue({report:{fileSummary:'A sufficiently long structured synthetic report summary for this fixture.'},usageByModel:{},sectionTimingsMs:{}});const response=await handleProviderCheck(req(),env);expect(response.status).toBe(200);expect(pipeline.mock.calls[0][0].documentText).toContain('SYNTHETIC SOFTWARE TEST RECORD');expect(await response.json()).toMatchObject({databaseWrites:false,persistenceTested:false,creditLifecycleTested:false});});
 it('does not return upstream provider messages',async()=>{pipeline.mockRejectedValue(new Error('secret provider diagnostic body'));const response=await handleProviderCheck(req(),env);expect(response.status).toBe(502);expect(await response.text()).not.toContain('secret provider');});
});
