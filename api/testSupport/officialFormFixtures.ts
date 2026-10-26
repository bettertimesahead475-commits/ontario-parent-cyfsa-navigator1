/**
 * Locations of the official court-form fixture files used by the real-artifact tests.
 *
 * Nothing here is a sandbox path. Each directory is taken from an environment variable when it is set, and otherwise
 * defaults to a folder inside this repository that git does not track:
 *   OFFICIAL_FORMS_DIR          historical pinned fixtures (scripts/official-forms/manifest.json)
 *   OFFICIAL_FORMS_CURRENT_DIR  current official PDFs (scripts/official-forms/current-manifest.json)
 *
 * A test that needs a file skips when the file is absent. A file that is present is always hash-checked by the test
 * itself, so a wrong file fails rather than passing. Verify a folder with: node scripts/official-forms/verify.mjs <dir>
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const OFFICIAL_FORMS_DIR = resolve(process.env.OFFICIAL_FORMS_DIR ?? resolve(REPO_ROOT, "fixtures/official-forms"));
export const OFFICIAL_FORMS_CURRENT_DIR = resolve(
  process.env.OFFICIAL_FORMS_CURRENT_DIR ?? resolve(REPO_ROOT, "fixtures/official-forms-current")
);

/** Path of a historical fixture by its manifest file name. */
export const officialFormFile = (fileName: string): string => resolve(OFFICIAL_FORMS_DIR, fileName);

/** Path of a current official PDF by its manifest file name. */
export const officialFormCurrentFile = (fileName: string): string => resolve(OFFICIAL_FORMS_CURRENT_DIR, fileName);
