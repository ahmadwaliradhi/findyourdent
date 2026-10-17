#!/usr/bin/env bash
# Post-deploy smoke test (spec 00, ticket T02). Run by infra/gcp/deploy.sh web, or
# on its own:
#
#   infra/gcp/smoke.sh                          # against https://findyourdent.web.app
#   BASE_URL=https://<web>.run.app infra/gcp/smoke.sh
#
# Checks the landing page, the language toggle, both health routes, that the agent
# refuses anonymous calls, and one Guidance round trip from web to agent. The
# Guidance stub calls no paid API.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-findyourdent}"
REGION="${REGION:-asia-southeast2}"
BASE_URL="${BASE_URL:-https://${PROJECT_ID}.web.app}"
AGENT_URL="${AGENT_URL:-$(gcloud run services describe fyd-agent --project "$PROJECT_ID" \
  --region "$REGION" --format='value(status.url)')}"

failures=0
pass() { printf '    ok    %s\n' "$*"; }
fail() { printf '    FAIL  %s\n' "$*" >&2; failures=$((failures + 1)); }

# check <description> <command...>: runs the command, records pass or fail.
check() {
  local what="$1"
  shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}

# The __session cookie from a Set-Cookie header in a curl header dump.
session_cookie() {
  grep -i '^set-cookie: __session=' | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]*).*/\1/' | tr -d '\r'
}

# A non-JSON body (an error page) is a failed check, not a jq error.
health_ok() { [[ "$(jq -r .status <<<"$1" 2>/dev/null)" == ok ]]; }

echo "Smoke test: ${BASE_URL} (agent ${AGENT_URL})"

# Every curl below ends in `|| true` so one failed request is reported by `check`
# and the remaining checks still run; the script exits 1 at the end if any failed.

web_health=$(curl -sS --max-time 30 "${BASE_URL}/health" || true)
check "web /health" health_ok "$web_health"

landing=$(curl -sS --max-time 30 "${BASE_URL}/" || true)
check "landing page is Indonesian" grep -q '<html[^>]*lang="id"' <<<"$landing"
check "landing page shows the consent line" grep -q 'Informasi edukasi, bukan diagnosis' <<<"$landing"

toggle_headers=$(curl -sS --max-time 30 -o /dev/null -D - -X POST \
  --data-urlencode lang=en --data-urlencode redirectTo=/ "${BASE_URL}/language" || true)
cookie=$(session_cookie <<<"$toggle_headers")
check "language toggle sets the __session cookie" test -n "$cookie"
english=$(curl -sS --max-time 30 -H "Cookie: ${cookie}" "${BASE_URL}/" || true)
check "toggle switches the page to English" grep -q '<html[^>]*lang="en"' <<<"$english"

anonymous=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "${AGENT_URL}/health" || true)
check "agent refuses anonymous calls (got ${anonymous})" test "$anonymous" = 403

# The token goes in through stdin so it never shows up in `ps`.
agent_health=$(printf 'Authorization: Bearer %s\n' "$(gcloud auth print-identity-token)" \
  | curl -sS --max-time 30 -H @- "${AGENT_URL}/health" || true)
check "agent /health with an identity token" health_ok "$agent_health"

guidance=$(curl -sS --max-time 60 -H 'Content-Type: application/json' \
  -d "$(jq -nc '{complaintText: "Uji asap: gigi ngilu", language: "id"}')" \
  "${BASE_URL}/api/guidance" || true)
# When App Check guards /api/guidance (spec 00), this check needs a debug token.
check "web reaches the agent with its identity token (Guidance round trip)" \
  jq -e '.kind == "guidance" or .kind == "followUp" or .kind == "emergency"' <<<"$guidance"

if ((failures > 0)); then
  echo "${failures} smoke check(s) failed" >&2
  exit 1
fi
echo "All smoke checks passed"
