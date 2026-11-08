import { describe, expect, it } from 'vitest';
import { providerDiagnostic } from '../shared/providerDiagnostics';
describe('safe provider rejection metadata',()=>{
 it('classifies exhausted provider credit without exposing the message',()=>expect(providerDiagnostic(400,JSON.stringify({error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API.'}}))).toMatchObject({httpStatus:400,providerCode:'invalid_request_error',reason:null,category:'INSUFFICIENT_PROVIDER_CREDIT'}));
 it('keeps only known Google error codes and reasons',()=>expect(providerDiagnostic(400,JSON.stringify({error:{status:'INVALID_ARGUMENT',message:'Request rejected',details:[{reason:'API_KEY_SERVICE_BLOCKED'}]}}))).toMatchObject({providerCode:'INVALID_ARGUMENT',reason:'API_KEY_SERVICE_BLOCKED',category:'KEY_RESTRICTED'}));
 it('detects leaked keys, billing and region restrictions',()=>{
  for(const [message,category] of [['Your API key was reported as leaked.','KEY_REPORTED_LEAKED'],['Enable billing for this API.','BILLING_REQUIRED'],['User location is not supported for API use.','LOCATION_UNSUPPORTED']])expect(providerDiagnostic(400,JSON.stringify({error:{message}})).category).toBe(category);
 });
 it('does not reflect arbitrary error codes, document contents or key values',()=>{
  const raw=JSON.stringify({error:{type:'CUSTOMER_NAME',message:'Private affidavit text and secret API key',details:[{reason:'PRIVATE_CONTENT'}]}});
  const result=providerDiagnostic(400,raw);expect(result).toMatchObject({httpStatus:400,providerCode:null,reason:null,category:'UNCLASSIFIED'});expect(JSON.stringify(result)).not.toContain('Private');
 });
 it('does not reflect non-JSON upstream bodies',()=>expect(providerDiagnostic(400,'<html>private request</html>')).toMatchObject({httpStatus:400,providerCode:null,reason:null,category:'NON_JSON_REJECTION'}));
});
