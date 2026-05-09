// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/BridgeVault.sol";
import "../../src/TUSDC.sol";

contract BridgeVaultTest is Test {
    TUSDC tusdc;
    BridgeVault vault;
    address verifier = makeAddr("verifier");
    address alice = makeAddr("alice");
    bytes32 constant DEST_CHAIN = bytes32(uint256(0x1234));
    bytes DEST_APP = abi.encode(makeAddr("destApp"));
    bytes constant DEST_RECIPIENT = bytes("neutron1exampledestinationrecipient");

    function setUp() public {
        tusdc = new TUSDC();
        vault = new BridgeVault(verifier, address(tusdc));
    }

    function _mintAndApprove(address user, uint256 amount) internal {
        vm.prank(user);
        tusdc.claim(); // 1000 tUSDC
        vm.prank(user);
        tusdc.approve(address(vault), amount);
    }

    // ─── lock ─────────────────────────────────────────────────────────────────

    function test_lock_transfersTokens() public {
        _mintAndApprove(alice, 500 * 1e18);
        vm.prank(alice);
        vault.lock(500 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
        assertEq(tusdc.balanceOf(address(vault)), 500 * 1e18);
        assertEq(tusdc.balanceOf(alice), 500 * 1e18);
    }

    function test_lock_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(BridgeVault.ZeroAmount.selector);
        vault.lock(0, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
    }

    function test_lock_emptyRecipient_reverts() public {
        _mintAndApprove(alice, 100 * 1e18);
        vm.prank(alice);
        vm.expectRevert(BridgeVault.ZeroRecipient.selector);
        vault.lock(100 * 1e18, 1, DEST_CHAIN, DEST_APP, bytes(""));
    }

    function test_lock_duplicateNonce_reverts() public {
        _mintAndApprove(alice, tusdc.CLAIM_AMOUNT());
        vm.prank(alice);
        vault.lock(100 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
        vm.prank(alice);
        tusdc.approve(address(vault), 100 * 1e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BridgeVault.NonceDuplicate.selector, uint64(1)));
        vault.lock(100 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
    }

    function test_lock_emitsEvent() public {
        _mintAndApprove(alice, 200 * 1e18);
        vm.expectEmit(true, false, false, true);
        emit BridgeVault.Locked(alice, 200 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
        vm.prank(alice);
        vault.lock(200 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
    }

    // ─── onCrossChainMessage (release) ────────────────────────────────────────

    function test_release_notVerifier_reverts() public {
        _mintAndApprove(alice, 500 * 1e18);
        vm.prank(alice);
        vault.lock(500 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
        vm.prank(alice);
        vm.expectRevert(BridgeVault.NotVerifier.selector);
        vault.onCrossChainMessage(
            DEST_CHAIN,
            DEST_APP,
            bytes4(0),
            abi.encode(alice, uint256(500 * 1e18), uint64(1))
        );
    }

    function test_release_sendsTokensToRecipient() public {
        _mintAndApprove(alice, 500 * 1e18);
        vm.prank(alice);
        vault.lock(500 * 1e18, 1, DEST_CHAIN, DEST_APP, DEST_RECIPIENT);
        address recipient = makeAddr("recipient");
        bytes memory payload = abi.encode(recipient, uint256(500 * 1e18), uint64(1));
        vm.prank(verifier);
        vault.onCrossChainMessage(DEST_CHAIN, DEST_APP, bytes4(0), payload);
        assertEq(tusdc.balanceOf(recipient), 500 * 1e18);
    }
}
