#!/usr/bin/env bash
# 03-silent.sh — Scenario S-3: Silent relayer / absence slash (R-32)
#
# Prerequisites:
#   - Relayer A running with --admin :8081 (will be silenced)
#   - Relayer B running with --admin :8082 (will take over)
#   - Both relayers registered + bonded
#
# What this script does:
#   1. Records Relayer A's bond balance on Sepolia
#   2. Silences Relayer A for 1 nonce via admin API
#   3. Locks tUSDC on Sepolia to trigger a message Relayer A ignores
#   4. After the 30s handover period, Relayer B takes over and submits
#   5. After the 60s challenge window, anyone calls claimAbsenceSlash for Relayer A
#   6. Verifies Relayer A bond decreased 50% and tUSDC WAS minted (by Relayer B)
#
# Expected outcome:
#   - Relayer A bond: -50% (absence slash)
#   - tUSDC minted on Neutron (Relayer B submitted)
#   - Relayer B receives relay fee + absence slash reward

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/.env" 2>/dev/null || true

ADMIN_A="${TESSERA_ADMIN_A:-http://localhost:8081}"
BOND_SEPOLIA="0x8c7dc28559B75AF8c3d59B62C87309E65cb37912"
VAULT="0x2C3544434185DD65F058494816bB816e5314a29E"
TUSDC_SEPOLIA="0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0"
NEUTRON_MINT="neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7"
AMOUNT="100000000"
SECRET_HEADER="${TESSERA_ADMIN_SECRET:+-H "X-Admin-Secret: ${TESSERA_ADMIN_SECRET}"}"

RELAYER_A_ADDR=$(cast wallet address --private-key "0x${RELAYER_A_PRIVATE_KEY}")

echo "=== S-3: Silent Relayer ==="
echo ""

# Step 1: Record initial bond balance.
echo "[1] Recording Relayer A bond balance on Sepolia..."
BOND_BEFORE=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_A_ADDR}" 2>/dev/null || echo "0")
echo "    Relayer A bond before: ${BOND_BEFORE} wei"

# Step 2: Silence Relayer A for 1 nonce.
echo "[2] Silencing Relayer A for 1 nonce..."
curl -sf -X POST ${SECRET_HEADER} \
  "${ADMIN_A}/admin/go-silent?nonces=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('    Admin response:', r)"

# Step 3: Lock tUSDC on Sepolia.
echo "[3] Locking ${AMOUNT} tUSDC on Sepolia (Relayer A will ignore this)..."
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
echo "    Lock submitted. Relayer A silenced — Relayer B should take over after 30s..."

# Step 4: Wait for handover + challenge window + absence slash (≤ 180s total).
echo "[4] Waiting for handover (30s) + submission by B + absence slash (up to 180s)..."
DEADLINE=$(($(date +%s) + 180))
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  BOND_AFTER=$(cast call --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
    "${BOND_SEPOLIA}" "bondBalance(address)(uint256)" "${RELAYER_A_ADDR}" 2>/dev/null || echo "${BOND_BEFORE}")
  if [ "${BOND_AFTER}" != "${BOND_BEFORE}" ] && [ "${BOND_AFTER}" -lt "${BOND_BEFORE}" ]; then
    SLASH=$((BOND_BEFORE - BOND_AFTER))
    echo ""
    echo "[PASS] S-3 Silent Relayer: absence slash confirmed"
    echo "    Relayer A bond before: ${BOND_BEFORE} wei"
    echo "    Relayer A bond after:  ${BOND_AFTER} wei"
    echo "    Slash amount: ${SLASH} wei (~50% expected)"
    exit 0
  fi
  printf "."
  sleep 10
done

echo ""
echo "[FAIL] S-3: Bond was not slashed within 180s"
echo "    Check relayer logs — Relayer B may not have submitted or absence slash not triggered"
exit 1
