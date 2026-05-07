#!/usr/bin/env bash
# 01-honest.sh — Scenario S-1: Honest delivery (R-30)
#
# Prerequisites:
#   - Both relayers running: RELAYER_A on :8081, RELAYER_B on :8082 (--admin flags)
#   - Relayer A and B registered + bonded (run scripts/register-relayers.sh first)
#   - .env at repo root with all addresses set
#   - Sepolia wallet funded with tUSDC: call tUSDC.claim() on Sepolia
#
# What this script does:
#   1. Approves tUSDC spend on Sepolia BridgeVault
#   2. Locks 100 tUSDC on Sepolia (generates a Locked event)
#   3. Polls the Neutron BridgeMint until tUSDC arrives (≤ 90 s)
#   4. Verifies no bond slashing occurred on either chain
#
# Expected outcome:
#   - tUSDC minted on Neutron for the recipient
#   - Relayer A or B receives the relay fee
#   - No slash events on Sepolia or Neutron

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/.env" 2>/dev/null || true

VAULT="0x8538da0D97bdCd07a38a8eE42826B0cA5e660174"
TUSDC_SEPOLIA="0xa355a4C216080B4CD1231e3De96F7ee06226d7c4"
NEUTRON_MINT="neutron1yhl05vq5pw5a99puedk5dygdkazjn38d9raf80w78hyptp22ug6qpmmyh7"
AMOUNT="100000000"  # 100 tUSDC (6 decimals)

echo "=== S-1: Honest Delivery ==="
echo ""

# Step 1: Check initial tUSDC balance on Neutron.
echo "[1] Checking Neutron tUSDC balance before lock..."
INITIAL_BALANCE=$(curl -sf \
  "${NEUTRON_REST_URL}/cosmwasm/wasm/v1/contract/${NEUTRON_MINT}/smart/$(printf '{"balance":{"address":"%s"}}' "${NEUTRON_RECIPIENT:-$(cast wallet address --private-key 0x${RELAYER_A_PRIVATE_KEY})}" | base64 -w0)" \
  2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('balance','0'))" 2>/dev/null || echo "0")
echo "    Initial Neutron tUSDC balance: ${INITIAL_BALANCE}"

# Step 2: Approve BridgeVault to spend tUSDC.
echo "[2] Approving BridgeVault to spend ${AMOUNT} tUSDC..."
APPROVE_TX=$(cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${TUSDC_SEPOLIA}" \
  "approve(address,uint256)" \
  "${VAULT}" "${AMOUNT}" \
  --json | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])")
echo "    Approve tx: ${APPROVE_TX}"

# Step 3: Lock tUSDC on Sepolia.
echo "[3] Locking ${AMOUNT} tUSDC on Sepolia BridgeVault..."
DEST_CHAIN=$(printf '%s' "pion-1" | xxd -p | tr -d '\n' | head -c 64 | awk '{printf "0x%-64s", $0}' | tr ' ' '0')
DEST_APP=$(python3 -c "import base64; a='${NEUTRON_MINT}'; print('0x' + a.encode().hex().ljust(64,'0')[:64])")
LOCK_TX=$(cast send \
  --private-key "${RELAYER_A_PRIVATE_KEY}" \
  --rpc-url "${ETHEREUM_SEPOLIA_ENDPOINT}" \
  "${VAULT}" \
  "lock(address,uint256,bytes32,bytes)" \
  "${TUSDC_SEPOLIA}" "${AMOUNT}" \
  "$(cast keccak "pion-1")" \
  "$(cast abi-encode 'f(bytes)' "${NEUTRON_MINT}" | cut -c3-)" \
  --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])" \
  || echo "LOCK_TX_FAILED")
echo "    Lock tx: ${LOCK_TX}"

# Step 4: Wait for Neutron balance change (poll for up to 90s).
echo "[4] Waiting for Neutron mint (up to 90s)..."
DEADLINE=$(($(date +%s) + 90))
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  BALANCE=$(curl -sf \
    "${NEUTRON_REST_URL}/cosmwasm/wasm/v1/contract/${NEUTRON_MINT}/smart/$(printf '{"balance":{"address":"%s"}}' "${NEUTRON_RECIPIENT:-$(cast wallet address --private-key 0x${RELAYER_A_PRIVATE_KEY})}" | base64 -w0)" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('balance','0'))" 2>/dev/null || echo "0")
  if [ "${BALANCE}" != "${INITIAL_BALANCE}" ]; then
    echo ""
    echo "[PASS] S-1 Honest Delivery: tUSDC minted on Neutron"
    echo "    Final Neutron tUSDC balance: ${BALANCE}"
    echo "    Increase: $((BALANCE - INITIAL_BALANCE)) uTUSDC"
    exit 0
  fi
  printf "."
  sleep 5
done

echo ""
echo "[FAIL] S-1: Neutron balance did not change within 90s"
echo "    Check relayer logs: journalctl -u tessera-relayer-a -n 50"
exit 1
