# Synthetic upload and cabinet browser harness

Targets the production UI at `82dfe65` with **all extraction, OCR, analysis,
analysis status, and entitlement responses mocked**. Google/Firebase sign-in
and page assets are real. This cannot qualify the live backends or payments.

From the repo root, with Node 22, Python and Pillow:

```sh
python tests/devin/upload/generate_fixtures.py
node --test tests/devin/upload/mocks.test.mjs
CYFSA_PLAYWRIGHT_ROOT="$HOME/qa-artifacts/nav/runner" \
  CYFSA_CHROME="$(command -v google-chrome)" node tests/devin/upload/run.mjs
```

For the browser run, use only the dedicated synthetic account and inject
`CYFSA_TEST_GOOGLE_EMAIL`, `CYFSA_TEST_GOOGLE_PASSWORD`, and
`_2FA_CYFSA_TEST_GOOGLE` through secure environment storage. The script skips
without all three. The profile is isolated at `~/qa-artifacts/upload/profile`;
don't use it for a personal or administrator account, or share the profile.
The account's browser-local cabinet must be empty before the run. If sign-in
requires a different or interactive verification step, the harness stops
before uploads; do not circumvent the challenge.

Timestamped output is outside the repo: `results.json`, `requests.jsonl`,
and viewport/failure screenshots. Extraction bodies are recorded as fixture
name, MIME, size and SHA-256 rather than full base64; analyzer bodies retain
only byte-for-byte matched synthetic text and the fields used in assertions.
The timeout scenario models an interrupted SSE connection and a job that
transitions from running to timed out, not a wall-clock provider timeout.
