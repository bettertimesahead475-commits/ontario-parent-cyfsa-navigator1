# Owner inputs needed to clear the remaining release blockers

Nothing here requires code changes. Each step has a check you can run before the test suite, so you can see
whether it worked. Never paste a key or a service-role credential into chat, a ticket, or a commit.

## 1. Official Ontario court forms (102 tests)

The tests pin the exact SHA-256 and byte length of 11 files. The manifest is `scripts/official-forms/manifest.json`.

Check what is currently in place:

    node scripts/official-forms/verify.mjs

Install the files:

1. Allow the official host, or download the files yourself. The index page is
   https://ontariocourtforms.on.ca/en/family-law-rules-forms/ . If your environment blocks that host, add
   `ontariocourtforms.on.ca` under Allowed domains in the environment's network settings, or download the files on
   a machine that can reach it.
2. Put the 11 downloaded files in one folder, under the exact names listed by the verifier.
3. Run the installer on that folder. It refuses to copy anything unless all 11 match the pinned hashes:

       scripts/official-forms/install.sh /path/to/folder-with-the-11-files

4. Confirm with `node scripts/official-forms/verify.mjs` (exit 0 means all 11 match).

Do not rename a file to make it pass. A hash mismatch means the file is not the one the tests pin.

## 2. Staging Supabase (6 tests)

Target: the staging project `cyfsa-navigator-staging` (its ref is in the URL below). It must never be the
production project, and the test refuses it.

Set two environment secrets for the test run:

- `STAGING_SUPABASE_URL` = `https://nxfhvebzzobegubefcda.supabase.co`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY` = the staging service-role key, from the Supabase dashboard for that project.

Check readiness without printing the key:

    node scripts/staging/check-staging-config.mjs

Then run the six tests:

    npx vitest run api/services/creditStaging.test.ts

The test seeds synthetic session ids and deletes only the rows it created.

## 3. Provider keys for the model-identifier check

    ANTHROPIC_API_KEY=... GEMINI_API_KEY=... node scripts/verify-analyzer-models.mjs

The script only lists models. It does not run inference or spend credits. Exit 0 means every configured identifier is
listed by its provider.

## 4. Preview smoke test

The authoritative preview is the `cyfsanavigator` project (`prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR`), not Navigator One.
An HTTP smoke test needs a route to the preview. Approve a temporary share link, or run the smoke test yourself
against the preview URL.
