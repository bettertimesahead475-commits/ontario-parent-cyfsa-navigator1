import { describe, expect, it } from 'vitest';
import { selectFirebaseConfig } from './firebaseConfig';
const production = { projectId: 'production' };
const testConfig = { projectId: 'cyfsa-navigator-e2e-20261108', apiKey: 'public-test-key', appId: 'test-app', authDomain: 'cyfsa-navigator-e2e-20261108.firebaseapp.com' };
describe('isolated staging Firebase configuration', () => {
  it('keeps the existing configuration when no override is supplied', () => expect(selectFirebaseConfig(production, undefined, 'cyfsanavigator.com')).toBe(production));
  it('accepts only the isolated project on staging origins', () => {
    for (const host of ['cyfsa-navigator-staging.pages.dev','release.cyfsa-navigator-staging.pages.dev']) expect(selectFirebaseConfig(production, JSON.stringify(testConfig), host)).toEqual(testConfig);
  });
  it('rejects production and deceptive origin overrides', () => {
    for (const host of ['cyfsanavigator.com','evilcyfsa-navigator-staging.pages.dev','cyfsa-navigator-staging.pages.dev.evil.test']) expect(() => selectFirebaseConfig(production, JSON.stringify(testConfig), host)).toThrow();
  });
  it('rejects a production project or a foreign auth domain on staging', () => {
    for (const bad of [{...testConfig, projectId:'gen-lang-client-0105737183'},{...testConfig,authDomain:'foreign.test'}]) expect(() => selectFirebaseConfig(production, JSON.stringify(bad),'cyfsa-navigator-staging.pages.dev')).toThrow();
  });
});
