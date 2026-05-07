// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/TUSDC.sol";

contract TUSDCTest is Test {
    TUSDC tusdc;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address bridgeMintAddr = makeAddr("bridgeMint");

    function setUp() public {
        vm.prank(owner);
        tusdc = new TUSDC();
    }

    // ─── setBridgeMint ────────────────────────────────────────────────────────

    function test_setBridgeMint_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        tusdc.setBridgeMint(bridgeMintAddr);
    }

    function test_setBridgeMint_zeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(TUSDC.ZeroAddress.selector);
        tusdc.setBridgeMint(address(0));
    }

    function test_setBridgeMint_setsAddress() public {
        vm.prank(owner);
        tusdc.setBridgeMint(bridgeMintAddr);
        assertEq(tusdc.bridgeMint(), bridgeMintAddr);
    }

    // ─── claim ────────────────────────────────────────────────────────────────

    function test_claim_mintsClaimAmount() public {
        vm.prank(alice);
        tusdc.claim();
        assertEq(tusdc.balanceOf(alice), tusdc.CLAIM_AMOUNT());
    }

    function test_claim_tooSoonReverts() public {
        vm.prank(alice);
        tusdc.claim();
        vm.prank(alice);
        vm.expectRevert();
        tusdc.claim();
    }

    function test_claim_allowedAfterCooldown() public {
        vm.prank(alice);
        tusdc.claim();
        vm.warp(block.timestamp + tusdc.CLAIM_COOLDOWN() + 1);
        vm.prank(alice);
        tusdc.claim();
        assertEq(tusdc.balanceOf(alice), tusdc.CLAIM_AMOUNT() * 2);
    }

    function test_claim_differentUsers_independent() public {
        vm.prank(alice);
        tusdc.claim();
        vm.prank(bob);
        tusdc.claim();
        assertEq(tusdc.balanceOf(alice), tusdc.CLAIM_AMOUNT());
        assertEq(tusdc.balanceOf(bob), tusdc.CLAIM_AMOUNT());
    }

    function test_claim_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit TUSDC.Claimed(alice, tusdc.CLAIM_AMOUNT());
        vm.prank(alice);
        tusdc.claim();
    }

    // ─── bridgeMintTo ─────────────────────────────────────────────────────────

    function test_bridgeMintTo_notBridgeMintReverts() public {
        vm.prank(owner);
        tusdc.setBridgeMint(bridgeMintAddr);
        vm.prank(alice);
        vm.expectRevert(TUSDC.NotBridgeMint.selector);
        tusdc.bridgeMintTo(alice, 1e18);
    }

    function test_bridgeMintTo_mintsTokens() public {
        vm.prank(owner);
        tusdc.setBridgeMint(bridgeMintAddr);
        vm.prank(bridgeMintAddr);
        tusdc.bridgeMintTo(alice, 500 * 1e18);
        assertEq(tusdc.balanceOf(alice), 500 * 1e18);
    }

    // ─── bridgeBurnFrom ───────────────────────────────────────────────────────

    function test_bridgeBurnFrom_burnsTokens() public {
        vm.prank(owner);
        tusdc.setBridgeMint(bridgeMintAddr);
        vm.prank(bridgeMintAddr);
        tusdc.bridgeMintTo(alice, 1_000 * 1e18);

        vm.prank(bridgeMintAddr);
        tusdc.bridgeBurnFrom(alice, 400 * 1e18);
        assertEq(tusdc.balanceOf(alice), 600 * 1e18);
    }

    function test_bridgeBurnFrom_notBridgeMintReverts() public {
        vm.prank(alice);
        vm.expectRevert(TUSDC.NotBridgeMint.selector);
        tusdc.bridgeBurnFrom(alice, 1e18);
    }

    // ─── ERC20 basics ─────────────────────────────────────────────────────────

    function test_decimals() public view {
        assertEq(tusdc.decimals(), 18);
    }

    function test_name_and_symbol() public view {
        assertEq(tusdc.name(), "Test USDC");
        assertEq(tusdc.symbol(), "tUSDC");
    }
}
