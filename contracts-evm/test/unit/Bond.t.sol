// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/Bond.sol";

contract BondTest is Test {
    Bond bond;
    address verifier = makeAddr("verifier");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        bond = new Bond();
        bond.setVerifier(verifier);
    }

    // ─── deposit ──────────────────────────────────────────────────────────────

    function test_deposit_zero_reverts() public {
        vm.expectRevert(Bond.ZeroDeposit.selector);
        bond.deposit{ value: 0 }(alice);
    }

    function test_deposit_creditsBalance() public {
        bond.deposit{ value: 1 ether }(alice);
        assertEq(bond.balanceOf(alice), 1 ether);
    }

    function test_deposit_anyoneCanDepositForRelayer() public {
        deal(bob, 1 ether);
        vm.prank(bob);
        bond.deposit{ value: 0.5 ether }(alice);
        assertEq(bond.balanceOf(alice), 0.5 ether);
    }

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Bond.Deposited(alice, 1 ether);
        bond.deposit{ value: 1 ether }(alice);
    }

    // ─── requestWithdrawal ────────────────────────────────────────────────────

    function test_requestWithdrawal_reducesBalance() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        bond.requestWithdrawal(0.25 ether);
        // 0.5 - 0.25 = 0.25 remaining, which equals DEREGISTRATION_THRESHOLD (0.125 ETH)
        // Wait — 0.25 >= 0.125 so this should pass
        assertEq(bond.balanceOf(alice), 0.25 ether);
        assertEq(bond.pendingWithdrawal(alice), 0.25 ether);
    }

    function test_requestWithdrawal_belowDeregistrationThreshold_reverts() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        // Trying to withdraw leaving 0.1 ETH (< 0.125 deregistration threshold) should fail
        vm.expectRevert(Bond.InsufficientBond.selector);
        bond.requestWithdrawal(0.401 ether);
    }

    function test_requestWithdrawal_exactDeregistrationThreshold_passes() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        // Withdraw 0.375, leaving exactly 0.125 = DEREGISTRATION_THRESHOLD
        bond.requestWithdrawal(0.375 ether);
        assertEq(bond.balanceOf(alice), 0.125 ether);
    }

    // ─── withdraw ─────────────────────────────────────────────────────────────

    function test_withdraw_beforeCooldown_reverts() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        bond.requestWithdrawal(0.25 ether);
        vm.prank(alice);
        vm.expectRevert();
        bond.withdraw();
    }

    function test_withdraw_afterCooldown_sendsEth() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        bond.requestWithdrawal(0.25 ether);
        vm.warp(block.timestamp + bond.WITHDRAWAL_COOLDOWN() + 1);
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        bond.withdraw();
        assertEq(alice.balance, balBefore + 0.25 ether);
        assertEq(bond.pendingWithdrawal(alice), 0);
    }

    function test_withdraw_noPending_reverts() public {
        vm.prank(alice);
        vm.expectRevert(Bond.NoPendingWithdrawal.selector);
        bond.withdraw();
    }

    // ─── slash ────────────────────────────────────────────────────────────────

    function test_slash_notVerifier_reverts() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.prank(alice);
        vm.expectRevert(Bond.NotVerifier.selector);
        bond.slash(alice, bob, 5_000);
    }

    function test_slash_50pct_movesHalfToBob() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.prank(verifier);
        bond.slash(alice, bob, 5_000);
        assertEq(bond.balanceOf(alice), 0.5 ether);
        assertEq(bob.balance, 0.5 ether);
    }

    function test_slash_25pct() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.prank(verifier);
        bond.slash(alice, bob, 2_500);
        assertEq(bond.balanceOf(alice), 0.75 ether);
        assertEq(bob.balance, 0.25 ether);
    }

    function test_slash_zeroBps_reverts() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.prank(verifier);
        vm.expectRevert(Bond.InvalidBps.selector);
        bond.slash(alice, bob, 0);
    }

    function test_slash_over100pct_reverts() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.prank(verifier);
        vm.expectRevert(Bond.InvalidBps.selector);
        bond.slash(alice, bob, 10_001);
    }

    function test_slash_emitsEvent() public {
        bond.deposit{ value: 1 ether }(alice);
        vm.expectEmit(true, true, false, true);
        emit Bond.Slashed(alice, bob, 0.5 ether);
        vm.prank(verifier);
        bond.slash(alice, bob, 5_000);
    }

    // ─── meetsOperatingThreshold ──────────────────────────────────────────────

    function test_meetsOperatingThreshold_trueWhenAbove() public {
        bond.deposit{ value: 0.25 ether }(alice);
        assertTrue(bond.meetsOperatingThreshold(alice));
    }

    function test_meetsOperatingThreshold_falseWhenBelow() public {
        bond.deposit{ value: 0.1 ether }(alice);
        assertFalse(bond.meetsOperatingThreshold(alice));
    }

    // ─── fuzz: deposit ────────────────────────────────────────────────────────

    function testFuzz_deposit_creditsExactAmount(uint96 amount) public {
        vm.assume(amount > 0);
        bond.deposit{ value: amount }(alice);
        assertEq(bond.balanceOf(alice), amount);
    }

    receive() external payable {}
}
