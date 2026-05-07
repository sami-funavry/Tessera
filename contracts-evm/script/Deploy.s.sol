// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/TUSDC.sol";
import "../src/Bond.sol";
import "../src/RelayerRegistry.sol";
import "../src/Verifier.sol";
import "../src/BridgeVault.sol";
import "../src/BridgeMint.sol";

/// @title DeployTessera — deploys all six Tessera contracts to Sepolia and wires them.
///
/// Deploy order (each contract depends on the ones before it):
///   1. TUSDC        (no deps)
///   2. Bond         (no deps)
///   3. RelayerRegistry(bond)
///   4. Verifier(bond, registry)
///   5. BridgeVault(verifier, tusdc)
///   6. BridgeMint(verifier, tusdc)
///   7. bond.setVerifier(verifier)
///   8. registry.setVerifier(verifier)
///   9. tusdc.setBridgeMint(bridgeMint)
///
/// Run:
///   forge script script/Deploy.s.sol:DeployTessera \
///     --rpc-url $ETHERUM_SEPOLIA_ENDPOINT \
///     --private-key $SEPOLIA_DEPLOYER_PRIVATE_KEY \
///     --broadcast --verify \
///     --etherscan-api-key $ETHERSCAN_API_KEY -vvv
contract DeployTessera is Script {
    function run() external {
        address deployer = msg.sender;

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast();

        // 1. TUSDC — ERC20 test token, freely claimable, bridge-mintable
        TUSDC tusdc = new TUSDC();

        // 2. Bond — ETH custody for relayer bonds (testnet: INITIAL=0.02 ETH)
        Bond bond = new Bond();

        // 3. RelayerRegistry — ordered list of active relayers
        RelayerRegistry registry = new RelayerRegistry(address(bond));

        // 4. Verifier — proof submission, challenge, and dispatch
        Verifier verifier = new Verifier(address(bond), address(registry));

        // 5. BridgeVault — users lock tUSDC here to initiate Sepolia → Neutron transfers
        BridgeVault vault = new BridgeVault(address(verifier), address(tusdc));

        // 6. BridgeMint — verifier calls this when a Neutron → Sepolia message executes
        BridgeMint mint = new BridgeMint(address(verifier), address(tusdc));

        // 7-9. Wire all inter-contract references
        bond.setVerifier(address(verifier));
        registry.setVerifier(address(verifier));
        tusdc.setBridgeMint(address(mint));

        vm.stopBroadcast();

        // Print addresses for capture by the shell script
        console.log("SEPOLIA_TUSDC=%s", address(tusdc));
        console.log("SEPOLIA_BOND=%s", address(bond));
        console.log("SEPOLIA_REGISTRY=%s", address(registry));
        console.log("SEPOLIA_VERIFIER=%s", address(verifier));
        console.log("SEPOLIA_VAULT=%s", address(vault));
        console.log("SEPOLIA_MINT=%s", address(mint));
    }
}
