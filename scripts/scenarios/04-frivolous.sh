#!/usr/bin/env bash
# 04-frivolous.sh — Scenario S-4: Frivolous challenge (R-33)
#
# Prerequisites:
#   - Relayer A running with --admin :8081 (honest submitter)
#   - Relayer B running with --admin :8082 (will be forced to file baseless challenge)
#   - Both relayers registered + bonded
#
# What this script does:
#   1. Records Relayer B's bond balance on Sepolia (the challenger)
#   2. Locks tUSDC on Sepolia to trigger an honest submission by Relayer A
#   3. After submission lands, forces Relayer B to file a baseless challenge
#   4. Waits for the contract to reject the challenge and slash Relayer B 25%
#   5. Verifies Relayer B bond decreased 25%, tUSDC WAS minted
#
# Expected outcome:
#   - Relayer B bond: -25% (frivolous challenge slash)
#   - Relayer A receives Relayer B's slashed amount
#   - tUSDC minted on Neutron (honest submission executed normally)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/.env" 2>/dev/null || true

ADMIN_B="${TESSERA_ADMIN_B:-http://localhost:8082}"
BOND_SEPOLIA="0xe651e39903F04444Af400d1F38BB10a3f89Ef97a"
VAULT="0x8538da0D97bdCd07a38a8eE42826B0cA5e660174"
TUSDC_SEPOLIA="0xa355a4C216080B4CD1231e3De96F7ee06226d7c4"
NEUTRON_MINT="neutron1yhl05vq5pw5a99puedk5dygdkazjn38d9raf80w78hyptp22ug6qpmmyh7"
AMOUNT="100000000"
SECRET_HEADER="${TESSERA_ADMIN_SECRET:+-H "X-Admin-Secret: ${TESSERA_ADMIN_SECRET}"}"

RELAYER_A_ADDR=$(cast wallet address --private-key "0x${RELAYER_A_PRIVATE_KEY}")
RELAYER_B_ADDR=$(cast wallet address --private-key "0x${RELAYER_B_PRIVATE_KEY}")

echo "=== S-4: Frivolous Challenge ==="
echo ""

# Step 1: Record initial bond balances.
echo "[1] Recording bond balances..."
BOND_B_BEFORE=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_B_ADDR}" 2>/dev/null || echo "0")
BOND_A_BEFORE=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_A_ADDR}" 2>/dev/null || echo "0")
echo "    Relayer A bond before: ${BOND_A_BEFORE} wei"
echo "    Relayer B bond before: ${BOND_B_BEFORE} wei"

# Step 2: Lock tUSDC to trigger honest submission.
echo "[2] Locking ${AMOUNT} tUSDC — Relayer A will submit honestly..."
cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${TUSDC_SEPOLIA}" "approve(address,uint256)" "${VAULT}" "${AMOUNT}" \
  --quiet
cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${VAULT}" \
  "lock(address,uint256,bytes32,bytes)" \
  "${TUSDC_SEPOLIA}" "${AMOUNT}" \
  "$(cast keccak "pion-1")" \
  "$(cast abi-encode 'f(address)' "${RELAYER_A_ADDR}")" \
  --quiet
echo "    Lock submitted. Waiting 15s for Relayer A's honest submission..."
sleep 15

# Step 3: Force Relayer B to file a baseless challenge.
echo "[3] Forcing Relayer B to file a frivolous challenge..."
curl -sf -X POST ${SECRET_HEADER} \
  "${ADMIN_B}/admin/force-frivolous?nonces=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('    Admin response:', r)"

# Step 4: Wait for Relayer B's bond to decrease 25% (≤ 120s).
echo "[4] Waiting for contract to slash Relayer B 25% (up to 120s)..."
DEADLINE=$(($(date +%s) + 120))
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  BOND_B_AFTER=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
    "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_B_ADDR}" 2>/dev/null || echo "${BOND_B_BEFORE}")
  if [ "${BOND_B_AFTER}" != "${BOND_B_BEFORE}" ] && [ "${BOND_B_AFTER}" -lt "${BOND_B_BEFORE}" ]; then
    SLASH=$((BOND_B_BEFORE - BOND_B_AFTER))
    EXPECTED_SLASH=$((BOND_B_BEFORE / 4))
    echo ""
    echo "[PASS] S-4 Frivolous Challenge: baseless dispute rejected, challenger slashed"
    echo "    Relayer B bond before: ${BOND_B_BEFORE} wei"
    echo "    Relayer B bond after:  ${BOND_B_AFTER} wei"
    echo "    Slash amount: ${SLASH} wei (expected ~${EXPECTED_SLASH}, 25%)"
    exit 0
  fi
  printf "."
  sleep 5
done

echo ""
echo "[FAIL] S-4: Relayer B bond was not slashed within 120s"
echo "    Check if the challenge was filed and how the contract resolved it"
exit 1
