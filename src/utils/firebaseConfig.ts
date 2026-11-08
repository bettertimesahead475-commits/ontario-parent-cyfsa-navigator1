import type { FirebaseOptions } from 'firebase/app';

/** Test authentication is accepted only by the isolated staging origin. */
export function selectFirebaseConfig(defaultConfig: FirebaseOptions, stagingJson: string | undefined, hostname: string): FirebaseOptions {
  if (!stagingJson) return defaultConfig;
  if (hostname !== 'cyfsa-navigator-staging.pages.dev' && !hostname.endsWith('.cyfsa-navigator-staging.pages.dev')) {
    throw new Error('Staging Firebase configuration requires the isolated staging origin.');
  }
  const candidate = JSON.parse(stagingJson) as FirebaseOptions;
  if (candidate.projectId !== 'cyfsa-navigator-e2e-20261108' || !candidate.apiKey || !candidate.appId || candidate.authDomain !== 'cyfsa-navigator-e2e-20261108.firebaseapp.com') {
    throw new Error('Invalid isolated Firebase test configuration.');
  }
  return candidate;
}
