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
        uint256 initial = bond.INITIAL_BOND();
        uint256 half = initial / 2;
        bond.deposit{ value: initial }(alice);
        vm.prank(alice);
        // Withdraw half — remaining = half >= DEREGISTRATION_THRESHOLD
        bond.requestWithdrawal(half);
        assertEq(bond.balanceOf(alice), initial - half);
        assertEq(bond.pendingWithdrawal(alice), half);
    }

    function test_requestWithdrawal_belowDeregistrationThreshold_reverts() public {
        uint256 initial = bond.INITIAL_BOND();
        uint256 dereg = bond.DEREGISTRATION_THRESHOLD();
        bond.deposit{ value: initial }(alice);
        vm.prank(alice);
        // Withdraw leaving 1 wei below DEREGISTRATION_THRESHOLD — should revert
        vm.expectRevert(Bond.InsufficientBond.selector);
        bond.requestWithdrawal(initial - dereg + 1);
    }

    function test_requestWithdrawal_exactDeregistrationThreshold_passes() public {
        uint256 initial = bond.INITIAL_BOND();
        uint256 dereg = bond.DEREGISTRATION_THRESHOLD();
        bond.deposit{ value: initial }(alice);
        vm.prank(alice);
        // Withdraw all but DEREGISTRATION_THRESHOLD — leaving exactly the minimum
        bond.requestWithdrawal(initial - dereg);
        assertEq(bond.balanceOf(alice), dereg);
    }

    function test_requestWithdrawal_twiceBeforeWithdraw_reverts() public {
        bond.deposit{ value: 0.5 ether }(alice);
        vm.prank(alice);
        bond.requestWithdrawal(0.005 ether); // first request succeeds
        vm.prank(alice);
        vm.expectRevert(Bond.PendingWithdrawalExists.selector);
        bond.requestWithdrawal(0.005 ether); // second request must revert
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
        bond.deposit{ value: bond.OPERATING_THRESHOLD() }(alice);
        assertTrue(bond.meetsOperatingThreshold(alice));
    }

    function test_meetsOperatingThreshold_falseWhenBelow() public {
        bond.deposit{ value: bond.OPERATING_THRESHOLD() - 1 }(alice);
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
