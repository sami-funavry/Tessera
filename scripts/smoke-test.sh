#!/usr/bin/env bash
# smoke-test.sh — Tessera phase smoke tests.
# Run manually or via cron. Appends results to scripts/smoke-test.log.
# Add new checks as phases complete. Each check must be idempotent.

set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG="$SCRIPT_DIR/smoke-test.log"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

pass() { echo "[PASS] $1" | tee -a "$LOG"; }
fail() { echo "[FAIL] $1" | tee -a "$LOG"; FAILURES=$((FAILURES+1)); }
FAILURES=0

echo "=== Smoke test $TIMESTAMP ===" | tee -a "$LOG"

# ── P-0: Environment ──────────────────────────────────────────────────────

check_env() {
  local var=$1
  val="${!var:-}"
  if [ -z "$val" ]; then
    fail "ENV $var is not set"
  else
    pass "ENV $var set"
  fi
}

# Load .env if not already in environment
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi

# Audit fix PROD-04: accept either the correctly-spelled
# ETHEREUM_SEPOLIA_ENDPOINT or the historic ETHERUM_SEPOLIA_ENDPOINT typo so
# the smoke test passes for an operator who only set the correct name.
if [ -z "${ETHEREUM_SEPOLIA_ENDPOINT:-}" ] && [ -n "${ETHERUM_SEPOLIA_ENDPOINT:-}" ]; then
  export ETHEREUM_SEPOLIA_ENDPOINT="$ETHERUM_SEPOLIA_ENDPOINT"
fi

for var in ETHEREUM_SEPOLIA_ENDPOINT NEUTRON_RPC_URL NEUTRON_REST_URL \
           SUPABASE_PROJECT_URL SUPABASE_SERVICE_ROLE_KEY \
           ETHERSCAN_API_KEY ETHERSCAN_API_URL; do
  check_env "$var"
done

# Sepolia RPC
CHAIN_ID=$(curl -sf -X POST "$ETHEREUM_SEPOLIA_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null || echo "")
if [ "$CHAIN_ID" = "0xaa36a7" ]; then
  pass "Sepolia RPC reachable (chainId=0xaa36a7)"
else
  fail "Sepolia RPC unreachable or wrong chainId: '$CHAIN_ID'"
fi

# Neutron RPC
NEUTRON_NET=$(curl -sf "$NEUTRON_RPC_URL/status" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['node_info']['network'])" 2>/dev/null || echo "")
if [ "$NEUTRON_NET" = "pion-1" ]; then
  pass "Neutron RPC reachable (network=pion-1)"
else
  fail "Neutron RPC unreachable or wrong network: '$NEUTRON_NET'"
fi

# Supabase
SB_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_PROJECT_URL/rest/v1/" 2>/dev/null || echo "000")
if [ "$SB_STATUS" = "200" ]; then
  pass "Supabase reachable (HTTP 200)"
else
  fail "Supabase unreachable (HTTP $SB_STATUS)"
fi

# Toolchain versions
command -v forge  >/dev/null 2>&1 && pass "forge present"   || fail "forge not found"
command -v cargo  >/dev/null 2>&1 && pass "cargo present"   || fail "cargo not found"
command -v go     >/dev/null 2>&1 && pass "go present"      || fail "go not found"
command -v pnpm   >/dev/null 2>&1 && pass "pnpm present"    || fail "pnpm not found"

# ── P-1 checks appended here when contracts are built ─────────────────────
# ── P-2 checks appended here when CosmWasm compiles ──────────────────────
# ── P-3 checks appended here when relayer binary builds ──────────────────
# ── P-5 checks appended here when contracts are deployed ─────────────────
# ── P-6 checks appended here when E2E honest path passes ─────────────────

echo "=== $FAILURES failure(s) ===" | tee -a "$LOG"
echo "" >> "$LOG"
exit $FAILURES
