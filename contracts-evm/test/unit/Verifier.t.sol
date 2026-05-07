// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/Bond.sol";
import "../../src/RelayerRegistry.sol";
import "../../src/libraries/MessageEnvelope.sol";
import "../helpers/TestableVerifier.sol";

/// @dev Targeted unit tests for Verifier edge cases not covered by integration tests.
contract VerifierTest is Test {
    Bond bond;
    RelayerRegistry registry;
    TestableVerifier verifier;
    address relayerA = makeAddr("relayerA");
    address relayerB = makeAddr("relayerB");
    bytes constant PUBKEY_A = hex"aaaa";
    bytes constant PUBKEY_B = hex"bbbb";
    bytes32 constant SRC_CHAIN = bytes32(uint256(1));
    bytes32 constant DST_CHAIN = bytes32(uint256(2));

    function setUp() public {
        bond = new Bond();
        registry = new RelayerRegistry(address(bond));
        verifier = new TestableVerifier(address(bond), address(registry));
        bond.setVerifier(address(verifier));
        registry.setVerifier(address(verifier));
    }

    function _register(address r, bytes memory pk) internal {
        deal(r, 2 ether);
        vm.prank(r);
        bond.deposit{ value: 0.5 ether }(r);
        vm.prank(r);
        registry.register(pk);
    }

    function _makeEnvelope(uint64 nonce) internal view returns (MessageEnvelope memory) {
        return MessageEnvelope({
            sourceChainId: SRC_CHAIN,
            sourceApp: abi.encode(address(0x1)),
            destinationChainId: DST_CHAIN,
            destinationApp: abi.encode(address(this)),
            action: bytes4(0),
            payload: bytes(""),
            nonce: nonce
        });
    }

    function _envHash(MessageEnvelope memory env) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                env.sourceChainId,
                env.sourceApp,
                env.destinationChainId,
                env.destinationApp,
                env.action,
                env.payload,
                env.nonce
            )
        );
    }

    // ─── MessageAlreadyExecuted in submitMessage ──────────────────────────────

    function test_submitMessage_afterExecution_reverts() public {
        _register(relayerA, PUBKEY_A);
        MessageEnvelope memory env = _makeEnvelope(0);
        bytes32 fp = keccak256("fp");
        bytes memory proof = bytes("proof");
        verifier.markValid(fp, _envHash(env), proof);

        vm.prank(relayerA);
        bytes32 subId = verifier.submitMessage(env, fp, block.timestamp);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(subId, proof);

        // Now try to re-submit the same message — should hit MessageAlreadyExecuted
        vm.prank(relayerA);
        vm.expectRevert(Verifier.MessageAlreadyExecuted.selector);
        verifier.submitMessage(env, fp, block.timestamp);
    }

    // ─── executeMessage InvalidProof ─────────────────────────────────────────

    function test_executeMessage_invalidProof_reverts() public {
        _register(relayerA, PUBKEY_A);
        MessageEnvelope memory env = _makeEnvelope(1);
        bytes32 fp = keccak256("fp2");
        bytes memory validProof = bytes("real_proof");
        bytes memory badProof = bytes("bad_proof");
        verifier.markValid(fp, _envHash(env), validProof);

        vm.prank(relayerA);
        bytes32 subId = verifier.submitMessage(env, fp, block.timestamp);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        vm.expectRevert(Verifier.InvalidProof.selector);
        verifier.executeMessage(subId, badProof);
    }

    // ─── claimAbsenceSlash — double-claim reverts ────────────────────────────

    function test_claimAbsenceSlash_doubleClaimReverts() public {
        _register(relayerA, PUBKEY_A);
        _register(relayerB, PUBKEY_B);
        MessageEnvelope memory env = _makeEnvelope(0); // nonce=0 → A is original, B is successor
        bytes32 fp = keccak256("fp3");
        bytes memory proof = bytes("proof3");
        uint256 eventTs = block.timestamp;
        verifier.markValid(fp, _envHash(env), proof);

        vm.warp(block.timestamp + verifier.HANDOVER_PERIOD() + 1);
        vm.prank(relayerB);
        bytes32 subId = verifier.submitMessage(env, fp, eventTs);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(subId, proof);
        verifier.claimAbsenceSlash(subId); // first claim succeeds

        vm.expectRevert(Verifier.AbsenceAlreadyClaimed.selector);
        verifier.claimAbsenceSlash(subId); // second must revert
    }

    // ─── claimAbsenceSlash — RegistryEmpty ───────────────────────────────────

    function test_claimAbsenceSlash_emptyRegistry_reverts() public {
        // No relayers registered — registry is empty after deregistering all.
        // Simulate by registering, executing as single relayer (who is both 0 and successor),
        // then deregistering both to empty the registry, then try absence slash.
        // Actually easier: register one, deregister after submission so count=0 at claim time.
        _register(relayerA, PUBKEY_A);
        _register(relayerB, PUBKEY_B);
        MessageEnvelope memory env = _makeEnvelope(0);
        bytes32 fp = keccak256("fp4");
        bytes memory proof = bytes("proof4");
        uint256 eventTs = block.timestamp;
        verifier.markValid(fp, _envHash(env), proof);

        vm.warp(block.timestamp + verifier.HANDOVER_PERIOD() + 1);
        vm.prank(relayerB);
        bytes32 subId = verifier.submitMessage(env, fp, eventTs);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(subId, proof);

        // Deregister both so registry.activeCount() == 0
        vm.prank(relayerA);
        registry.deregister();
        vm.prank(relayerB);
        registry.deregister();

        vm.expectRevert(Verifier.RegistryEmpty.selector);
        verifier.claimAbsenceSlash(subId);
    }

    // ─── claimAbsenceSlash — status must be Executed ─────────────────────────

    function test_claimAbsenceSlash_pendingStatus_reverts() public {
        _register(relayerA, PUBKEY_A);
        MessageEnvelope memory env = _makeEnvelope(2);
        bytes32 fp = keccak256("fp5");
        bytes memory proof = bytes("proof5");
        verifier.markValid(fp, _envHash(env), proof);

        vm.prank(relayerA);
        bytes32 subId = verifier.submitMessage(env, fp, block.timestamp);
        // Status is Pending — claimAbsenceSlash should revert
        vm.expectRevert(Verifier.NotPending.selector);
        verifier.claimAbsenceSlash(subId);
    }

    // ─── IApp dispatch ────────────────────────────────────────────────────────

    // This test contract implements IApp so we can verify dispatch is called
    bool public crossChainCalled;

    function onCrossChainMessage(
        bytes32, /* sourceChainId */
        bytes calldata, /* sourceApp */
        bytes4, /* action */
        bytes calldata /* payload */
    ) external {
        crossChainCalled = true;
    }

    function test_executeMessage_dispatchesToDestApp() public {
        _register(relayerA, PUBKEY_A);
        // Build envelope targeting this test contract as destinationApp
        MessageEnvelope memory env = MessageEnvelope({
            sourceChainId: SRC_CHAIN,
            sourceApp: abi.encode(address(0x1)),
            destinationChainId: DST_CHAIN,
            destinationApp: abi.encode(address(this)),
            action: bytes4(0),
            payload: bytes(""),
            nonce: 99
        });
        bytes32 fp = keccak256("fp_dispatch");
        bytes memory proof = bytes("proof_dispatch");
        verifier.markValid(fp, _envHash(env), proof);

        vm.prank(relayerA);
        bytes32 subId = verifier.submitMessage(env, fp, block.timestamp);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(subId, proof);

        assertTrue(crossChainCalled, "onCrossChainMessage should have been called");
    }

    // ─── executeMessage — MessageAlreadyExecuted when two submissions race ────

    /// @dev Both relayerA and relayerB submit for the same message. relayerA executes first.
    ///      relayerB's submission is still Pending but executeMessage should revert
    ///      with MessageAlreadyExecuted (not NotPending) when the messageId is already done.
    function test_executeMessage_sameMessage_secondSubmission_reverts() public {
        _register(relayerA, PUBKEY_A);
        _register(relayerB, PUBKEY_B);
        MessageEnvelope memory env = _makeEnvelope(7);
        bytes32 fp = keccak256("fp_race");
        bytes memory proof = bytes("proof_race");
        verifier.markValid(fp, _envHash(env), proof);

        uint256 ts = block.timestamp;

        // Both submit for the same message (different timestamps → different submissionIds)
        vm.prank(relayerA);
        bytes32 subIdA = verifier.submitMessage(env, fp, ts);
        vm.warp(block.timestamp + 1);
        vm.prank(relayerB);
        bytes32 subIdB = verifier.submitMessage(env, fp, ts);

        // Wait for both challenge windows to expire
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        // relayerA's submission executes successfully
        verifier.executeMessage(subIdA, proof);

        // relayerB's submission is still Pending but messageId is executed → MessageAlreadyExecuted
        vm.expectRevert(Verifier.MessageAlreadyExecuted.selector);
        verifier.executeMessage(subIdB, proof);
    }

    receive() external payable {}
}
