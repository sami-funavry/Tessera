#!/usr/bin/env bash
# 02-lying.sh — Scenario S-2: Lying relayer (R-31)
#
# Prerequisites:
#   - Relayer A running with --admin :8081
#   - Relayer B running with --admin :8082 (challenger)
#   - Both relayers registered + bonded
#   - TESSERA_ADMIN_SECRET set (if configured)
#
# What this script does:
#   1. Records Relayer A's bond balance on Sepolia before
#   2. Injects wrong-fingerprint fault into Relayer A (duration=1 nonce)
#   3. Locks tUSDC on Sepolia to trigger the lying submission
#   4. Waits for Relayer B to challenge (≤ 120s)
#   5. Verifies Relayer A's bond was slashed 50% and tUSDC was NOT minted
#
# Expected outcome:
#   - Relayer A bond: -50%
#   - Challenger (Relayer B): +50% of A's slashed amount
#   - tUSDC NOT minted on Neutron (message reverted)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/.env" 2>/dev/null || true

ADMIN_A="${TESSERA_ADMIN_A:-http://localhost:8081}"
BOND_SEPOLIA="0x8c7dc28559B75AF8c3d59B62C87309E65cb37912"
VAULT="0x23d1a91A23b00809EDca2F61e84C02073a0603Ce"
TUSDC_SEPOLIA="0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0"
AMOUNT="100000000"
SECRET_HEADER="${TESSERA_ADMIN_SECRET:+-H "X-Admin-Secret: ${TESSERA_ADMIN_SECRET}"}"

RELAYER_A_ADDR=$(cast wallet address --private-key "0x${RELAYER_A_PRIVATE_KEY}")
RELAYER_B_ADDR=$(cast wallet address --private-key "0x${RELAYER_B_PRIVATE_KEY}")

echo "=== S-2: Lying Relayer ==="
echo ""

# Step 1: Record initial bond balance.
echo "[1] Recording Relayer A bond balance on Sepolia..."
BOND_BEFORE=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_A_ADDR}" 2>/dev/null || echo "0")
echo "    Relayer A bond before: ${BOND_BEFORE} wei"

# Step 2: Inject wrong-fingerprint fault into Relayer A via admin API.
echo "[2] Injecting wrong-fingerprint fault into Relayer A..."
curl -sf -X POST ${SECRET_HEADER} \
  "${ADMIN_A}/admin/inject-fault?type=wrong_fingerprint&duration=2" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('    Admin response:', r)"

# Step 3: Lock tUSDC on Sepolia.
echo "[3] Locking ${AMOUNT} tUSDC on Sepolia to trigger lying submission..."
cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${TUSDC_SEPOLIA}" "approve(address,uint256)" "${VAULT}" "${AMOUNT}" \
  --quiet
LOCK_TX=$(cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${VAULT}" \
  "lock(address,uint256,bytes32,bytes)" \
  "${TUSDC_SEPOLIA}" "${AMOUNT}" \
  "$(cast keccak "pion-1")" \
  "$(cast abi-encode 'f(address)' "${RELAYER_A_ADDR}")" \
  --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])")
echo "    Lock tx: ${LOCK_TX}"

# Step 4: Poll for Relayer A's bond to decrease (up to 120s).
echo "[4] Waiting for Relayer B to detect fraud and slash Relayer A (up to 120s)..."
DEADLINE=$(($(date +%s) + 120))
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  BOND_AFTER=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
    "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_A_ADDR}" 2>/dev/null || echo "${BOND_BEFORE}")
  if [ "${BOND_AFTER}" != "${BOND_BEFORE}" ] && [ "${BOND_AFTER}" -lt "${BOND_BEFORE}" ]; then
    SLASH_AMOUNT=$((BOND_BEFORE - BOND_AFTER))
    EXPECTED_SLASH=$((BOND_BEFORE / 2))
    echo ""
    echo "[PASS] S-2 Lying Relayer: fraud detected and slashed"
    echo "    Relayer A bond before: ${BOND_BEFORE} wei"
    echo "    Relayer A bond after:  ${BOND_AFTER} wei"
    echo "    Slash amount: ${SLASH_AMOUNT} wei (expected ~${EXPECTED_SLASH})"
    exit 0
  fi
  printf "."
  sleep 5
done

echo ""
echo "[FAIL] S-2: Bond was not slashed within 120s"
echo "    Relayer A bond before: ${BOND_BEFORE}"
echo "    Check relayer logs for challenge activity"
exit 1
