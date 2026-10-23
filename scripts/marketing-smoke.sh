#!/usr/bin/env bash
# Read-only smoke test for the Marketing Agent admin API on a deployed URL.
#
# Usage (secrets come from the environment, never from arguments or files):
#   PREVIEW_URL=https://<preview-host> \
#   ADMIN_SECRET=<value of ADMIN_SECRET> \
#   CRON_SECRET=<value of CRON_SECRET, optional> \
#   VERCEL_BYPASS_TOKEN=<protection bypass token, if the preview is protected> \
#   scripts/marketing-smoke.sh
#
# Writes nothing: no posts, campaigns or channel changes. Prints HTTP status
# codes and key names only. It never prints a secret.
set -u

: "${PREVIEW_URL:?Set PREVIEW_URL to the deployed origin, e.g. https://host}"
: "${ADMIN_SECRET:?Set ADMIN_SECRET from the Vercel environment (do not paste it into chat)}"

BASE="${PREVIEW_URL%/}/api/admin/marketing"
pass=0; fail=0

extra=()
[ -n "${VERCEL_BYPASS_TOKEN:-}" ] && extra+=(-H "x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN}")

# status <expected-code> <label> [curl args...]
check() {
  local want="$1" label="$2"; shift 2
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "${extra[@]}" "$@")
  if [ "$got" = "$want" ]; then
    echo "PASS  $label  ($got)"; pass=$((pass+1))
  else
    echo "FAIL  $label  (expected $want, got $got)"; fail=$((fail+1))
  fi
}

check 401 "overview rejects missing secret"        "$BASE/overview"
check 401 "overview rejects wrong secret"          -H "x-admin-secret: not-the-secret" "$BASE/overview"
check 200 "channels accepts admin secret"          -H "x-admin-secret: $ADMIN_SECRET" "$BASE/channels"
check 200 "overview accepts admin secret"          -H "x-admin-secret: $ADMIN_SECRET" "$BASE/overview"
check 200 "analytics accepts admin secret"         -H "x-admin-secret: $ADMIN_SECRET" "$BASE/analytics"
check 400 "generate rejects a javascript: link"    -X POST -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
          -d '{"platforms":["facebook"],"topic":"smoke","linkUrl":"javascript:alert(1)"}' "$BASE/generate"
check 400 "campaign update rejects invalid status" -X PATCH -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
          -d '{"status":"deleted"}' "$BASE/campaigns/00000000-0000-0000-0000-000000000000"

if [ -n "${CRON_SECRET:-}" ]; then
  check 401 "scheduler rejects admin secret used as cron" -H "Authorization: Bearer $ADMIN_SECRET" "$BASE/run-scheduler"
  check 401 "scheduler rejects missing bearer"            "$BASE/run-scheduler"
  # With a valid bearer the scheduler runs. It is read-only when nothing is due,
  # but on a database with due posts it would publish. Run only against staging.
  echo "SKIP  scheduler run with valid bearer (runs publishing logic; run only against verified staging)"
else
  echo "SKIP  cron checks (CRON_SECRET not provided)"
fi

echo
echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
