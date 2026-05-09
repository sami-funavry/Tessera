#!/usr/bin/env bash
# Register and bond Relayer A and B on Sepolia using cast.
#
# Reads RELAYER_A_PRIVATE_KEY / RELAYER_B_PRIVATE_KEY from .env (gitignored).
# Earlier revisions of this file hardcoded the testnet private keys directly,
# which committed them into git history; treat those keys as compromised and
# rotate them before any non-testnet use. Going forward, never hardcode keys
# in scripts — load them via env.
#
# Usage: ./scripts/register-sepolia-relayers.sh
set -euo pipefail

# Load .env from repo root if present (so we pick up RELAYER_*_PRIVATE_KEY)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

: "${RELAYER_A_PRIVATE_KEY:?RELAYER_A_PRIVATE_KEY not set — add to .env}"
: "${RELAYER_B_PRIVATE_KEY:?RELAYER_B_PRIVATE_KEY not set — add to .env}"
: "${RELAYER_A_SEPOLIA_ADDRESS:?RELAYER_A_SEPOLIA_ADDRESS not set — add to .env}"
: "${RELAYER_B_SEPOLIA_ADDRESS:?RELAYER_B_SEPOLIA_ADDRESS not set — add to .env}"
: "${ETHEREUM_SEPOLIA_ENDPOINT:?ETHEREUM_SEPOLIA_ENDPOINT not set — add to .env}"

CAST=~/.foundry/bin/cast
RPC="$ETHEREUM_SEPOLIA_ENDPOINT"

BOND_ADDR="0x8c7dc28559B75AF8c3d59B62C87309E65cb37912"
REGISTRY_ADDR="0x43677d5Da5701E061Eefa65e36A4fF6D4BFC1109"
BOND_AMOUNT="20000000000000000"  # 0.02 ETH in wei

# Derive compressed secp256k1 pubkey from private key using cast wallet
# cast wallet address --private-key <key> gives address; pubkey derivation via --show-public-key
derive_pubkey() {
  local pk="$1"
  $CAST wallet public-key --private-key "$pk" 2>/dev/null || echo "UNKNOWN"
}

register_relayer() {
  local label="$1"
  local pk="$2"
  local addr="$3"

  echo ""
  echo "=== $label ($addr) ==="

  # Check if already registered
  local active
  active=$($CAST call "$REGISTRY_ADDR" "isActive(address)(bool)" "$addr" --rpc-url "$RPC")
  if [[ "$active" == "true" ]]; then
    echo "  Already registered — checking bond..."
    local bal
    bal=$($CAST call "$BOND_ADDR" "balanceOf(address)(uint256)" "$addr" --rpc-url "$RPC")
    echo "  Bond: $bal wei"
    return 0
  fi

  # Deposit bond
  local bond_bal
  bond_bal=$($CAST call "$BOND_ADDR" "balanceOf(address)(uint256)" "$addr" --rpc-url "$RPC")
  echo "  Current bond: $bond_bal wei"

  if [[ "$bond_bal" -lt "$BOND_AMOUNT" ]]; then
    echo "  Depositing $BOND_AMOUNT wei bond..."
    local tx
    tx=$($CAST send "$BOND_ADDR" "deposit(address)" "$addr" \
      --private-key "$pk" \
      --value "$BOND_AMOUNT" \
      --rpc-url "$RPC" \
      --json | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null || \
      $CAST send "$BOND_ADDR" "deposit(address)" "$addr" \
      --private-key "$pk" \
      --value "$BOND_AMOUNT" \
      --rpc-url "$RPC")
    echo "  Bond tx: $tx"
  else
    echo "  Bond already sufficient"
  fi

  # Register
  echo "  Registering..."
  local pubkey
  pubkey=$(derive_pubkey "$pk")
  echo "  Pubkey: $pubkey"

  # Use cast to call register — pubkey as bytes
  local reg_tx
  reg_tx=$($CAST send "$REGISTRY_ADDR" "register(bytes)" "$pubkey" \
    --private-key "$pk" \
    --rpc-url "$RPC")
  echo "  Register tx: $reg_tx"

  # Verify
  local is_active
  is_active=$($CAST call "$REGISTRY_ADDR" "isActive(address)(bool)" "$addr" --rpc-url "$RPC")
  echo "  isActive: $is_active"
}

register_relayer "Relayer A" "$RELAYER_A_PRIVATE_KEY" "$RELAYER_A_SEPOLIA_ADDRESS"
register_relayer "Relayer B" "$RELAYER_B_PRIVATE_KEY" "$RELAYER_B_SEPOLIA_ADDRESS"

echo ""
echo "=== Sepolia registration complete ==="
RELA_ACTIVE=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "isActive(address)(bool)" "$RELAYER_A_SEPOLIA_ADDRESS" --rpc-url "$RPC")
RELB_ACTIVE=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "isActive(address)(bool)" "$RELAYER_B_SEPOLIA_ADDRESS" --rpc-url "$RPC")
COUNT=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "activeCount()(uint256)" --rpc-url "$RPC")
echo "Relayer A active: $RELA_ACTIVE"
echo "Relayer B active: $RELB_ACTIVE"
echo "Total active: $COUNT"
