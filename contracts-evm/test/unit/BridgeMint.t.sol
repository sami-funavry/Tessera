// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/BridgeMint.sol";
import "../../src/TUSDC.sol";

contract BridgeMintTest is Test {
    TUSDC tusdc;
    BridgeMint bridgeMint;
    address owner = makeAddr("owner");
    address verifier = makeAddr("verifier");
    address alice = makeAddr("alice");
    bytes32 constant DEST_CHAIN = bytes32(uint256(0xabcd));
    bytes DEST_APP = abi.encode(makeAddr("destVault"));

    function setUp() public {
        vm.prank(owner);
        tusdc = new TUSDC();
        bridgeMint = new BridgeMint(verifier, address(tusdc));
        vm.prank(owner);
        tusdc.setBridgeMint(address(bridgeMint));
    }

    // ─── onCrossChainMessage (mint) ───────────────────────────────────────────

    function test_mint_notVerifier_reverts() public {
        vm.prank(alice);
        vm.expectRevert(BridgeMint.NotVerifier.selector);
        bridgeMint.onCrossChainMessage(
            DEST_CHAIN, DEST_APP, bytes4(0), abi.encode(alice, uint256(100 * 1e18), uint64(1))
        );
    }

    function test_mint_createsTokens() public {
        bytes memory payload = abi.encode(alice, uint256(500 * 1e18), uint64(1));
        vm.prank(verifier);
        bridgeMint.onCrossChainMessage(DEST_CHAIN, DEST_APP, bytes4(0), payload);
        assertEq(tusdc.balanceOf(alice), 500 * 1e18);
    }

    function test_mint_zeroAmount_reverts() public {
        bytes memory payload = abi.encode(alice, uint256(0), uint64(1));
        vm.prank(verifier);
        vm.expectRevert(BridgeMint.ZeroAmount.selector);
        bridgeMint.onCrossChainMessage(DEST_CHAIN, DEST_APP, bytes4(0), payload);
    }

    function test_mint_emitsEvent() public {
        bytes memory payload = abi.encode(alice, uint256(300 * 1e18), uint64(42));
        vm.expectEmit(true, false, false, true);
        emit BridgeMint.Minted(alice, 300 * 1e18, 42);
        vm.prank(verifier);
        bridgeMint.onCrossChainMessage(DEST_CHAIN, DEST_APP, bytes4(0), payload);
    }

    // ─── burn ─────────────────────────────────────────────────────────────────

    function test_burn_destroysTokens() public {
        // First mint some to alice
        vm.prank(verifier);
        bridgeMint.onCrossChainMessage(
            DEST_CHAIN, DEST_APP, bytes4(0), abi.encode(alice, uint256(1_000 * 1e18), uint64(1))
        );
        vm.prank(alice);
        bridgeMint.burn(400 * 1e18, DEST_CHAIN, DEST_APP);
        assertEq(tusdc.balanceOf(alice), 600 * 1e18);
    }

    function test_burn_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(BridgeMint.ZeroAmount.selector);
        bridgeMint.burn(0, DEST_CHAIN, DEST_APP);
    }

    function test_burn_emitsEvent() public {
        vm.prank(verifier);
        bridgeMint.onCrossChainMessage(
            DEST_CHAIN, DEST_APP, bytes4(0), abi.encode(alice, uint256(1_000 * 1e18), uint64(1))
        );
        vm.expectEmit(true, false, false, true);
        emit BridgeMint.Burned(alice, 400 * 1e18, DEST_CHAIN, DEST_APP);
        vm.prank(alice);
        bridgeMint.burn(400 * 1e18, DEST_CHAIN, DEST_APP);
    }
}
