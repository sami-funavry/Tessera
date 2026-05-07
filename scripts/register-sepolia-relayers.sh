#!/usr/bin/env bash
# Register and bond Relayer A and B on Sepolia using cast.
# Usage: ./scripts/register-sepolia-relayers.sh
set -euo pipefail

CAST=~/.foundry/bin/cast
RPC="https://eth-sepolia.g.alchemy.com/v2/hFtFHxhTG9OsvAP5OHNOm"

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

register_relayer "Relayer A" "0x1ee4df24028890af9aadd8f41213c63c8273598700e063186a9277e0c5d2c9a2" "0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37"
register_relayer "Relayer B" "0x9b16f6ae1df944068863913534b8e9829c43cab6e653a05b4433dcc1b19be99c" "0xdFac507Cee79D909af53EC89b981DD9C431264C2"

echo ""
echo "=== Sepolia registration complete ==="
RELA_ACTIVE=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "isActive(address)(bool)" "0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37" --rpc-url "$RPC")
RELB_ACTIVE=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "isActive(address)(bool)" "0xdFac507Cee79D909af53EC89b981DD9C431264C2" --rpc-url "$RPC")
COUNT=$(~/.foundry/bin/cast call "$REGISTRY_ADDR" "activeCount()(uint256)" --rpc-url "$RPC")
echo "Relayer A active: $RELA_ACTIVE"
echo "Relayer B active: $RELB_ACTIVE"
echo "Total active: $COUNT"
