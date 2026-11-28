# Signed-out navigation QA

Run from the repo root with Node 22, Playwright and Chrome. In the Devin environment:

```sh
node tests/devin/nav/harness.cjs --check-guards
CYFSA_PLAYWRIGHT_ROOT="$HOME/qa-artifacts/nav/runner" \
  CYFSA_CHROME="$(command -v google-chrome)" node tests/devin/nav/harness.cjs
```

Without that local runner, point `CYFSA_PLAYWRIGHT_ROOT` at a directory with
Playwright installed. By default the CLI runs `matrix followup`; pass suite
names explicitly to run just one or to include `stable` (cold links and
settled loading) or `slow` (throttled desktop and mobile loading diagnostics).
Screenshots and JSON go to a timestamped subdirectory of
`~/qa-artifacts/nav` by default, not into the repo.

A fresh signed-out browser context disables service workers and installs
request guards **before navigation**. They block direct Anthropic/Gemini
traffic, paid/authenticated API mutations, and other non-read methods except
the same-origin POST for read-only public directory search. The suite does
not enter credentials or capture request headers or bodies.

The matrix uses desktop **1440×900**, tablet **768×1024**, and mobile
**390×844** to exercise visible menus and deep links, expected headings and
paths, sign-in gates, loading settling, mobile menu closure, horizontal
overflow, refresh, and browser Back/Forward. Follow-up checks that one Back
after the upgrade and unknown-route redirects returns to the prior page;
it also checks the duplicate Forms link and whether the glossary, narrator,
statutory desk, and coach widgets are present, in bounds, clear of each other,
and clickable at their centers. It checks whether those controls cover text
in the example report's Document Checked and Firsthand Knowledge cards at the
reported scroll positions. Failed assertions are recorded as failures, not
retried until green.
