#!/usr/bin/env bash
# register-relayers.sh — registers Relayer A and Relayer B on both chains and posts initial bonds.
#
# Prerequisites:
#   - .env file at repo root with all required variables
#   - tessera CLI binary: cd relayer && go build -o ../bin/tessera ./cmd/tessera
#   - Relayer A: RELAYER_A_PRIVATE_KEY set in env
#   - Relayer B: RELAYER_B_PRIVATE_KEY set in env
#   - Each wallet funded: ≥ 0.05 ETH on Sepolia, ≥ 2 NTRN on Neutron
#
# Bond amounts (testnet thresholds — see SPEC.md R-43):
#   Sepolia: 0.02 ETH = 20000000000000000 wei
#   Neutron: 1 NTRN  = 1000000 uNTRN
#
# Usage: ./scripts/register-relayers.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${REPO_ROOT}/bin/tessera"

# Load .env
if [[ -f "${REPO_ROOT}/.env" ]]; then
  # Export all non-comment, non-empty lines
  set -a
  # shellcheck disable=SC1090
  source "${REPO_ROOT}/.env"
  set +a
fi

# ─── Validate prerequisites ───────────────────────────────────────────────────

required_vars=(
  RELAYER_A_PRIVATE_KEY
  RELAYER_B_PRIVATE_KEY
  ETHERUM_SEPOLIA_ENDPOINT
  NEUTRON_RPC_URL
  NEUTRON_REST_URL
  NEUTRON_CHAIN_ID
  SEPOLIA_REGISTRY
  SEPOLIA_BOND
  NEUTRON_REGISTRY
  NEUTRON_BOND
)

missing=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  exit 1
fi

# Build tessera if binary missing or stale
if [[ ! -f "${BIN}" ]] || [[ "${REPO_ROOT}/relayer" -nt "${BIN}" ]]; then
  echo "Building tessera CLI..."
  (cd "${REPO_ROOT}/relayer" && go build -o "${BIN}" ./cmd/tessera)
fi

# Bond amounts
SEPOLIA_BOND_AMOUNT="20000000000000000"  # 0.02 ETH in wei
NEUTRON_BOND_AMOUNT="1000000"            # 1 NTRN in uNTRN

# ─── Register + bond Relayer A ────────────────────────────────────────────────

echo ""
echo "=== Relayer A: registration + bond ==="

echo "[A] Registering on Sepolia..."
RELAYER_PRIVATE_KEY="${RELAYER_A_PRIVATE_KEY}" "${BIN}" bond register --chain sepolia
echo "[A] Sepolia registration OK"

echo "[A] Depositing bond on Sepolia (${SEPOLIA_BOND_AMOUNT} wei)..."
RELAYER_PRIVATE_KEY="${RELAYER_A_PRIVATE_KEY}" "${BIN}" bond deposit \
  --chain sepolia \
  --amount "${SEPOLIA_BOND_AMOUNT}"
echo "[A] Sepolia bond OK"

echo "[A] Registering on Neutron..."
RELAYER_PRIVATE_KEY="${RELAYER_A_PRIVATE_KEY}" "${BIN}" bond register --chain neutron
echo "[A] Neutron registration OK"

echo "[A] Depositing bond on Neutron (${NEUTRON_BOND_AMOUNT} uNTRN)..."
RELAYER_PRIVATE_KEY="${RELAYER_A_PRIVATE_KEY}" "${BIN}" bond deposit \
  --chain neutron \
  --amount "${NEUTRON_BOND_AMOUNT}"
echo "[A] Neutron bond OK"

# ─── Register + bond Relayer B ────────────────────────────────────────────────

echo ""
echo "=== Relayer B: registration + bond ==="

echo "[B] Registering on Sepolia..."
RELAYER_PRIVATE_KEY="${RELAYER_B_PRIVATE_KEY}" "${BIN}" bond register --chain sepolia
echo "[B] Sepolia registration OK"

echo "[B] Depositing bond on Sepolia (${SEPOLIA_BOND_AMOUNT} wei)..."
RELAYER_PRIVATE_KEY="${RELAYER_B_PRIVATE_KEY}" "${BIN}" bond deposit \
  --chain sepolia \
  --amount "${SEPOLIA_BOND_AMOUNT}"
echo "[B] Sepolia bond OK"

echo "[B] Registering on Neutron..."
RELAYER_PRIVATE_KEY="${RELAYER_B_PRIVATE_KEY}" "${BIN}" bond register --chain neutron
echo "[B] Neutron registration OK"

echo "[B] Depositing bond on Neutron (${NEUTRON_BOND_AMOUNT} uNTRN)..."
RELAYER_PRIVATE_KEY="${RELAYER_B_PRIVATE_KEY}" "${BIN}" bond deposit \
  --chain neutron \
  --amount "${NEUTRON_BOND_AMOUNT}"
echo "[B] Neutron bond OK"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Registration complete ==="
echo "Both relayers (A and B) are registered and bonded on Sepolia and Neutron."
echo ""
echo "Next steps:"
echo "  1. Start Relayer A: RELAYER_PRIVATE_KEY=\${RELAYER_A_PRIVATE_KEY} ./bin/tessera relayer"
echo "  2. Start Relayer B: RELAYER_PRIVATE_KEY=\${RELAYER_B_PRIVATE_KEY} ./bin/tessera relayer"
echo "  3. Initiate a bridge transfer from the frontend or via cast/CosmJS scripts"
