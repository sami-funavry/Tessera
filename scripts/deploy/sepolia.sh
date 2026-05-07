#!/usr/bin/env bash
# scripts/deploy/sepolia.sh — Deploy Tessera contracts to Sepolia and update addresses.json
#
# Required env vars (from .env at repo root):
#   DEPLOYER_PRIVATE_KEY    EVM hex private key for SEPOLIA_WALLET_ADDRESS
#   ETHEREUM_SEPOLIA_ENDPOINT  Alchemy / other RPC
#   ETHERSCAN_API_KEY       For contract verification
#
# Usage:  bash scripts/deploy/sepolia.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

: "${SEPOLIA_DEPLOYER_PRIVATE_KEY:?SEPOLIA_DEPLOYER_PRIVATE_KEY not set — add it to .env}"
: "${ETHEREUM_SEPOLIA_ENDPOINT:?ETHEREUM_SEPOLIA_ENDPOINT not set}"
: "${ETHERSCAN_API_KEY:?ETHERSCAN_API_KEY not set}"

FORGE="$HOME/.foundry/bin/forge"
ADDR_FILE="$REPO_ROOT/scripts/addresses.json"
EVM_ROOT="$REPO_ROOT/contracts-evm"

# Forge must run with contracts-evm as root so foundry.toml and lib/ are found.
cd "$EVM_ROOT"

echo "==> [sepolia] Running dry-run first..."
"$FORGE" script "script/Deploy.s.sol:DeployTessera" \
  --rpc-url "$ETHEREUM_SEPOLIA_ENDPOINT" \
  --private-key "$SEPOLIA_DEPLOYER_PRIVATE_KEY" \
  -vvv 2>&1

echo ""
echo "==> [sepolia] Broadcasting deployment..."
FORGE_OUT=$("$FORGE" script "script/Deploy.s.sol:DeployTessera" \
  --rpc-url "$ETHEREUM_SEPOLIA_ENDPOINT" \
  --private-key "$SEPOLIA_DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --delay 5 \
  -vvv 2>&1)

echo "$FORGE_OUT"

# Parse deployed addresses from console.log output
parse_addr() {
  echo "$FORGE_OUT" | grep "^$1=" | head -1 | cut -d= -f2 | tr -d '[:space:]'
}

TUSDC=$(parse_addr "SEPOLIA_TUSDC")
BOND=$(parse_addr "SEPOLIA_BOND")
REGISTRY=$(parse_addr "SEPOLIA_REGISTRY")
VERIFIER=$(parse_addr "SEPOLIA_VERIFIER")
VAULT=$(parse_addr "SEPOLIA_VAULT")
MINT=$(parse_addr "SEPOLIA_MINT")

echo ""
echo "==> [sepolia] Deployed addresses:"
echo "  TUSDC:         $TUSDC"
echo "  Bond:          $BOND"
echo "  Registry:      $REGISTRY"
echo "  Verifier:      $VERIFIER"
echo "  BridgeVault:   $VAULT"
echo "  BridgeMint:    $MINT"

# Write to addresses.json (merge with existing neutron section)
python3 - <<PYEOF
import json, os
addr_file = "$ADDR_FILE"
with open(addr_file) as f:
    data = json.load(f)
data["sepolia"] = {
    "tusdc":            "$TUSDC",
    "bond":             "$BOND",
    "relayer_registry": "$REGISTRY",
    "verifier":         "$VERIFIER",
    "bridge_vault":     "$VAULT",
    "bridge_mint":      "$MINT",
}
with open(addr_file, "w") as f:
    json.dump(data, f, indent=2)
print("addresses.json updated (sepolia)")
PYEOF

echo ""
echo "==> [sepolia] Deployment complete. Etherscan verification queued."
echo "    View on Etherscan: https://sepolia.etherscan.io/address/$VERIFIER"
