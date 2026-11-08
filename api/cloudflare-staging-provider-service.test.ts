import { beforeEach, describe, expect, it, vi } from 'vitest';
const handler=vi.hoisted(()=>vi.fn());
vi.mock('../functions/api/admin/analyzer-provider-check',()=>({handleProviderCheck:handler}));
import { checkStagingProvider } from '../workers/staging-provider-service';
const env:any={ANALYZER_JOBS_QUEUE_NAME:'cyfsa-staging-analyzer-jobs',ANALYZER_JOBS_DLQ_NAME:'cyfsa-staging-analyzer-dead-letter',ANTHROPIC_API_KEY:'not-a-real-key'};
beforeEach(()=>vi.clearAllMocks());
describe('existing private staging provider credential reuse',()=>{
 it('rejects an executor configured for a production queue',async()=>{await expect(checkStagingProvider({...env,ANALYZER_JOBS_QUEUE_NAME:'cyfsa-analyzer-jobs'},'token','fast')).rejects.toThrow();expect(handler).not.toHaveBeenCalled();});
 it('does not accept arbitrary operation names',async()=>{await expect(checkStagingProvider(env,'token','customer-document')).rejects.toThrow();});
 it('retains Firebase verification and fixed input through the same handler',async()=>{handler.mockResolvedValue(Response.json({code:'AUTH_REQUIRED'},{status:401}));expect(await checkStagingProvider(env,'invalid-token','full')).toEqual({status:401,body:{code:'AUTH_REQUIRED'}});const [request,config]=handler.mock.calls[0];expect(request.headers.get('Authorization')).toBe('Bearer invalid-token');expect(await request.json()).toEqual({mode:'full'});expect(config).toMatchObject({ANALYZER_ENABLED:'false',FIREBASE_PROJECT_ID:'cyfsa-navigator-e2e-20261108'});});
});
