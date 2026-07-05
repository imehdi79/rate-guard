#!/usr/bin/env bash
# =============================================================================
# rate-guard demo driver — for recording the README GIF (or any live demo).
#
# Does everything, prettily: pulls the admin key from the VPS, creates a
# demo tenant with a tight quota, then WAITS so you can frame the shot and
# start recording — Enter fires the traffic (some allowed, then 429s) while
# the dashboard updates beside it.
#
#   ./scripts/demo.sh                        # fetch admin key via ssh
#   ADMIN_API_KEY=... ./scripts/demo.sh      # skip ssh
#
# Tunables (env):
#   VPS_HOST=root@mehdify.com   VPS_ENV_PATH=/root/rate-guard/.env
#   API_URL=https://rate-guard-api.mehdify.com
#   DASHBOARD_URL=https://rate-guard.mehdify.com
#   TENANT_NAME=acme-demo  MAX_REQUESTS=6  WINDOW_SECONDS=60  TOTAL_SHOTS=9
# =============================================================================
set -euo pipefail

API_URL=${API_URL:-https://rate-guard-api.mehdify.com}
DASHBOARD_URL=${DASHBOARD_URL:-https://rate-guard.mehdify.com}
VPS_HOST=${VPS_HOST:-root@mehdify.com}
VPS_ENV_PATH=${VPS_ENV_PATH:-/root/rate-guard/.env}
TENANT_NAME=${TENANT_NAME:-acme-demo}
MAX_REQUESTS=${MAX_REQUESTS:-6}
WINDOW_SECONDS=${WINDOW_SECONDS:-60}
TOTAL_SHOTS=${TOTAL_SHOTS:-9}

if [[ -t 1 ]]; then
  B=$'\e[1m' DIM=$'\e[2m' GREEN=$'\e[32m' RED=$'\e[31m' CYAN=$'\e[36m' YELLOW=$'\e[33m' RS=$'\e[0m'
else
  B='' DIM='' GREEN='' RED='' CYAN='' YELLOW='' RS=''
fi

say()  { printf '  %s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "${B}${CYAN}" "$*" "$RS"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RS" "$*"; }
die()  { printf '  %s✗ %s%s\n' "$RED" "$*" "$RS" >&2; exit 1; }

printf '\n%s┌──────────────────────────────────────────────┐%s\n' "$B" "$RS"
printf '%s│   rate-guard · live demo                     │%s\n' "$B" "$RS"
printf '%s└──────────────────────────────────────────────┘%s\n' "$B" "$RS"

# --- admin key ---------------------------------------------------------------
step "Admin key"
if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  say "${DIM}fetching from ${VPS_HOST}:${VPS_ENV_PATH}${RS}"
  ADMIN_API_KEY=$(ssh "$VPS_HOST" "grep '^ADMIN_API_KEY=' '$VPS_ENV_PATH'" \
    | cut -d= -f2- | tr -d '\r"' ) \
    || die "ssh failed — set VPS_HOST or pass ADMIN_API_KEY=... directly"
fi
[[ -n "$ADMIN_API_KEY" ]] || die "ADMIN_API_KEY is empty"
ok "loaded (${#ADMIN_API_KEY} chars — never printed)"

# --- tenant ------------------------------------------------------------------
# The api key is only ever returned on create, so it is cached (gitignored,
# next to this script) — re-runs and re-takes reuse the same tenant, which
# keeps the dashboard showing a stable name on camera.
step "Demo tenant"
CACHE="$(dirname "$0")/.demo-tenant.env"
name=$TENANT_NAME tenant_id='' api_key=''

if [[ -f $CACHE ]]; then
  # shellcheck source=/dev/null
  source "$CACHE"
  if [[ ${DEMO_TENANT_NAME:-} == "$name" && -n ${DEMO_API_KEY:-} ]]; then
    probe=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $DEMO_API_KEY" "$API_URL/api")
    if [[ $probe == 200 || $probe == 429 ]]; then
      tenant_id=$DEMO_TENANT_ID api_key=$DEMO_API_KEY
      ok "reusing ${B}${name}${RS} (cached key still valid)"
    fi
  fi
fi

if [[ -z $api_key ]]; then
  res=$(curl -s -w $'\n%{http_code}' -X POST "$API_URL/api/admin/tenants" \
    -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
    -d "{\"name\":\"$name\"}")
  code=${res##*$'\n'} body=${res%$'\n'*}
  if [[ $code == 201 ]]; then
    tenant_id=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$body")
    api_key=$(sed -n 's/.*"api_key":"\([^"]*\)".*/\1/p' <<<"$body")
    [[ -n $tenant_id && -n $api_key ]] || die "could not parse tenant response: $body"
    printf 'DEMO_TENANT_NAME=%s\nDEMO_TENANT_ID=%s\nDEMO_API_KEY=%s\n' \
      "$name" "$tenant_id" "$api_key" > "$CACHE"
    chmod 600 "$CACHE" 2>/dev/null || true
    ok "created ${B}${name}${RS} (key cached for re-takes)"
  elif [[ $code == 409 ]]; then
    die "tenant '$name' exists but its key isn't cached here — its key was \
shown only at creation. Either delete the tenant, pick another name \
(TENANT_NAME=acme-demo-2), or restore $CACHE"
  else
    die "tenant create failed ($code): $body"
  fi
fi

step "Quota"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  "$API_URL/api/admin/tenants/$tenant_id/quota" \
  -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d "{\"max_requests\":$MAX_REQUESTS,\"window_seconds\":$WINDOW_SECONDS}")
[[ $code == 200 ]] || die "quota update failed ($code)"
ok "${B}${MAX_REQUESTS} requests / ${WINDOW_SECONDS}s${RS} — sliding window"

# --- hold for the camera -------------------------------------------------------
step "Ready to record"
say "1. open ${B}${DASHBOARD_URL}${RS} and select tenant ${B}${name}${RS}"
say "2. frame the browser + this terminal, start your recording"
say "3. press ${B}Enter${RS} to fire ${TOTAL_SHOTS} requests (1/s)"
read -r

printf '\n%s$ GET %s/api%s   %sx-api-key: %s…%s\n\n' \
  "$B" "$API_URL" "$RS" "$DIM" "${api_key:0:8}" "$RS"

# --- the money shot -------------------------------------------------------------
allowed=0 denied=0
for i in $(seq 1 "$TOTAL_SHOTS"); do
  IFS='|' read -r status remaining retry < <(curl -s -o /dev/null \
    -w '%{http_code}|%header{x-ratelimit-remaining}|%header{retry-after}' \
    -H "x-api-key: $api_key" "$API_URL/api")
  if [[ $status == 200 ]]; then
    allowed=$((allowed + 1))
    printf '  %s●%s request %d   %s200 OK%s            remaining in window: %s%s%s\n' \
      "$GREEN" "$RS" "$i" "${B}${GREEN}" "$RS" "$B" "$remaining" "$RS"
  elif [[ $status == 429 ]]; then
    denied=$((denied + 1))
    printf '  %s●%s request %d   %s429 RATE LIMITED%s  retry after %ss\n' \
      "$RED" "$RS" "$i" "${B}${RED}" "$RS" "$retry"
  else
    printf '  %s● request %d   unexpected %s%s\n' "$YELLOW" "$i" "$status" "$RS"
  fi
  sleep 1
done

printf '\n  %s%d allowed%s · %s%d throttled%s — watch the dashboard update ⟶\n\n' \
  "${B}${GREEN}" "$allowed" "$RS" "${B}${RED}" "$denied" "$RS"
