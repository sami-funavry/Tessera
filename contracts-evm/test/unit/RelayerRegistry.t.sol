// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/RelayerRegistry.sol";
import "../../src/Bond.sol";

contract RelayerRegistryTest is Test {
    Bond bond;
    RelayerRegistry registry;
    address verifier = makeAddr("verifier");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes constant PUBKEY_A = hex"aabbccdd";
    bytes constant PUBKEY_B = hex"eeff0011";

    function setUp() public {
        bond = new Bond();
        bond.setVerifier(verifier);
        registry = new RelayerRegistry(address(bond));
        registry.setVerifier(verifier);
    }

    function _fund(address relayer, uint256 amount) internal {
        deal(relayer, amount);
        vm.prank(relayer);
        bond.deposit{ value: amount }(relayer);
    }

    // ─── register ─────────────────────────────────────────────────────────────

    function test_register_insufficientBond_reverts() public {
        _fund(alice, 0.4 ether); // below 0.5 ETH threshold
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.InsufficientBond.selector);
        registry.register(PUBKEY_A);
    }

    function test_register_zeroPubkey_reverts() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.ZeroPubkey.selector);
        registry.register("");
    }

    function test_register_success() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        assertTrue(registry.isActive(alice));
        assertEq(registry.activeCount(), 1);
        assertEq(registry.relayerAt(0), alice);
    }

    function test_register_emitsEvent() public {
        _fund(alice, 0.5 ether);
        vm.expectEmit(true, false, false, true);
        emit RelayerRegistry.Registered(alice, PUBKEY_A);
        vm.prank(alice);
        registry.register(PUBKEY_A);
    }

    function test_register_duplicate_reverts() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.AlreadyRegistered.selector);
        registry.register(PUBKEY_B);
    }

    function test_register_twoRelayers() public {
        _fund(alice, 0.5 ether);
        _fund(bob, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(bob);
        registry.register(PUBKEY_B);
        assertEq(registry.activeCount(), 2);
    }

    // ─── deregister ───────────────────────────────────────────────────────────

    function test_deregister_removesFromActiveList() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        registry.deregister();
        assertFalse(registry.isActive(alice));
        assertEq(registry.activeCount(), 0);
    }

    function test_deregister_notRegistered_reverts() public {
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.NotRegistered.selector);
        registry.deregister();
    }

    function test_deregister_reregistrationBlockedDuringCooldown() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        registry.deregister();
        vm.prank(alice);
        vm.expectRevert();
        registry.register(PUBKEY_A);
    }

    function test_deregister_reregistrationAllowedAfterCooldown() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        registry.deregister();
        vm.warp(block.timestamp + registry.REREGISTRATION_COOLDOWN() + 1);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        assertTrue(registry.isActive(alice));
    }

    // ─── rotateKey ────────────────────────────────────────────────────────────

    function test_rotateKey_updatesKey() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        registry.rotateKey(PUBKEY_B);
        (,bytes memory key,,, ) = registry.relayers(alice);
        assertEq(key, PUBKEY_B);
    }

    function test_rotateKey_notActive_reverts() public {
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.NotActive.selector);
        registry.rotateKey(PUBKEY_B);
    }

    // ─── recordSlash (via verifier) ───────────────────────────────────────────

    function test_recordSlash_notVerifier_reverts() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(alice);
        vm.expectRevert(RelayerRegistry.NotVerifier.selector);
        registry.recordSlash(alice);
    }

    function test_recordSlash_belowOperatingThreshold_benches() public {
        _fund(alice, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        // Slash alice 50% via bond (drops to 0.25 ETH — exactly at operating threshold)
        vm.prank(verifier);
        bond.slash(alice, bob, 5_000);
        // Now slash again to drop to 0.125 ETH (deregistration threshold)
        vm.prank(verifier);
        bond.slash(alice, bob, 5_000);
        // recordSlash twice to trigger state machine
        vm.prank(verifier);
        registry.recordSlash(alice);
        vm.prank(verifier);
        registry.recordSlash(alice);
        assertFalse(registry.isActive(alice));
    }

    // ─── active list integrity ────────────────────────────────────────────────

    function test_activeList_swapAndPop_integrity() public {
        address charlie = makeAddr("charlie");
        _fund(alice, 0.5 ether);
        _fund(bob, 0.5 ether);
        _fund(charlie, 0.5 ether);
        vm.prank(alice);
        registry.register(PUBKEY_A);
        vm.prank(bob);
        registry.register(PUBKEY_B);
        vm.prank(charlie);
        registry.register(hex"cc");

        assertEq(registry.activeCount(), 3);
        // Deregister alice (index 0): bob or charlie moves to index 0
        vm.prank(alice);
        registry.deregister();
        assertEq(registry.activeCount(), 2);
        // Remaining two should still be findable
        bool foundBob = false;
        bool foundCharlie = false;
        for (uint256 i = 0; i < 2; i++) {
            address r = registry.relayerAt(i);
            if (r == bob) foundBob = true;
            if (r == charlie) foundCharlie = true;
        }
        assertTrue(foundBob);
        assertTrue(foundCharlie);
    }

    receive() external payable {}
}
