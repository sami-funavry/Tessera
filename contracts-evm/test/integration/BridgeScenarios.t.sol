// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/TUSDC.sol";
import "../../src/Bond.sol";
import "../../src/RelayerRegistry.sol";
import "../../src/BridgeVault.sol";
import "../../src/BridgeMint.sol";
import "../../src/libraries/MessageEnvelope.sol";
import "../helpers/TestableVerifier.sol";

/// @title BridgeScenariosTest — Integration tests for all four Tessera demo scenarios (R-30 to R-33)
///
///  S-1: Honest delivery       — relayer A submits valid proof, window expires, message executes.
///  S-2: Lying relayer         — relayer A lies (wrong fingerprint), B challenges, A slashed 50%.
///  S-3: Silent relayer        — relayer A is the assigned submitter but stays silent; B submits after
///                               handover, then anyone calls claimAbsenceSlash → A slashed 50%.
///  S-4: Frivolous challenge   — relayer A submits honestly; B files baseless challenge; B slashed 25%.
///
/// Registry has exactly two relayers (A=index 0, B=index 1) so rotation is deterministic.
/// nonce=0 → index 0 % 2 = 0 → relayer A is original assignee.
/// nonce=1 → index 1 % 2 = 1 → relayer B is original assignee.
contract BridgeScenariosTest is Test {
    // ─── Contracts ────────────────────────────────────────────────────────────
    TUSDC tusdc;
    Bond bond;
    RelayerRegistry registry;
    TestableVerifier verifier;
    BridgeMint bridgeMint;

    // ─── Actors ───────────────────────────────────────────────────────────────
    address owner = makeAddr("owner");
    address relayerA = makeAddr("relayerA");
    address relayerB = makeAddr("relayerB");
    address user = makeAddr("user");

    bytes constant PUBKEY_A = hex"aaaa";
    bytes constant PUBKEY_B = hex"bbbb";

    // ─── Chain IDs ────────────────────────────────────────────────────────────
    bytes32 constant SOURCE_CHAIN = bytes32(uint256(11_155_111)); // Sepolia
    bytes32 constant DEST_CHAIN = bytes32(uint256(1_329)); // Neutron pion-1

    function setUp() public {
        // 1. Deploy TUSDC
        vm.prank(owner);
        tusdc = new TUSDC();

        // 2. Deploy Bond and Registry (no verifier address needed at construction now).
        //    Verifier address is set after via setVerifier() — standard deploy pattern.
        bond = new Bond();
        registry = new RelayerRegistry(address(bond));

        // 3. Deploy Verifier (needs Bond + Registry)
        verifier = new TestableVerifier(address(bond), address(registry));

        // 4. Wire Verifier into Bond and Registry (one-time setters)
        bond.setVerifier(address(verifier));
        registry.setVerifier(address(verifier));

        // Step D: deploy BridgeMint pointing to verifier
        bridgeMint = new BridgeMint(address(verifier), address(tusdc));

        // Step E: authorize BridgeMint in TUSDC
        vm.prank(owner);
        tusdc.setBridgeMint(address(bridgeMint));

        // Step F: fund and register two relayers
        deal(relayerA, 2 ether);
        deal(relayerB, 2 ether);

        vm.prank(relayerA);
        bond.deposit{ value: 0.5 ether }(relayerA);
        vm.prank(relayerA);
        registry.register(PUBKEY_A);

        vm.prank(relayerB);
        bond.deposit{ value: 0.5 ether }(relayerB);
        vm.prank(relayerB);
        registry.register(PUBKEY_B);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _buildEnvelope(uint64 nonce, address destApp) internal view returns (MessageEnvelope memory) {
        return MessageEnvelope({
            sourceChainId: SOURCE_CHAIN,
            sourceApp: abi.encode(address(bridgeMint)), // source app on the other side
            destinationChainId: DEST_CHAIN,
            destinationApp: abi.encode(destApp),
            action: bytes4(keccak256("onCrossChainMessage(bytes32,bytes,bytes4,bytes)")),
            payload: abi.encode(user, uint256(500 * 1e18), nonce),
            nonce: nonce
        });
    }

    function _envelopeHash(MessageEnvelope memory env) internal pure returns (bytes32) {
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

    // ─── S-1: Honest delivery (R-30) ──────────────────────────────────────────

    /// @notice Relayer A submits a valid proof. After 60s challenge window, anyone executes.
    ///         User receives bridged tokens. No slashing.
    function test_S1_honest_delivery() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("trueFingerprintS1");
        bytes memory proof = bytes("valid_proof_bytes");
        uint256 eventTs = block.timestamp;

        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);

        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, fp, eventTs);

        // Challenge window passes
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        vm.prank(makeAddr("executor"));
        verifier.executeMessage(submissionId, proof);

        // Verify BridgeMint minted to user
        assertEq(tusdc.balanceOf(user), 500 * 1e18, "user should receive 500 tUSDC");

        // No slashing occurred
        assertEq(bond.balanceOf(relayerA), 0.5 ether, "relayerA bond intact");
    }

    // ─── S-2: Lying relayer (R-31) ────────────────────────────────────────────

    /// @notice Relayer A submits with a wrong fingerprint. Relayer B challenges with correct proof.
    ///         A is slashed 50%; B receives the slash reward. Message does NOT execute.
    function test_S2_lying_relayer() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 trueFingerprint = keccak256("trueFingerprint");
        bytes32 lieFingerprint = keccak256("lieFingerprint");
        bytes memory evidenceProof = bytes("challenger_evidence");
        uint256 eventTs = block.timestamp;

        bytes32 msgHash = _envelopeHash(env);
        // Only the true fingerprint + evidence proof is marked valid
        verifier.markValid(trueFingerprint, msgHash, evidenceProof);

        // Relayer A submits with wrong fingerprint
        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, lieFingerprint, eventTs);

        uint256 aBalBefore = bond.balanceOf(relayerA);
        uint256 bBalBefore = relayerB.balance;

        // Relayer B challenges within the 60s window
        vm.prank(relayerB);
        verifier.challenge(submissionId, trueFingerprint, evidenceProof);

        // A slashed 50%, reward to B
        uint256 slashed = (aBalBefore * 5_000) / 10_000;
        assertEq(bond.balanceOf(relayerA), aBalBefore - slashed, "relayerA should lose 50%");
        assertEq(relayerB.balance, bBalBefore + slashed, "relayerB should gain slash reward");
    }

    // ─── S-3: Silent relayer (R-32) ───────────────────────────────────────────

    /// @notice Relayer A (original assignee for nonce=0) stays silent past the 30s handover.
    ///         Relayer B submits after handover. Message executes. Anyone claims absence slash on A.
    function test_S3_silent_relayer() public {
        // nonce=0 → original assignee = registry.relayerAt(0 % 2) = relayerA (first registered)
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("fingerprintS3");
        bytes memory proof = bytes("valid_proof_s3");
        uint256 eventTs = block.timestamp;

        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);

        // Warp past handover: relayer A was silent
        vm.warp(block.timestamp + verifier.HANDOVER_PERIOD() + 1);

        // Relayer B (successor) submits
        vm.prank(relayerB);
        bytes32 submissionId = verifier.submitMessage(env, fp, eventTs);

        // Wait out challenge window
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        // Execute
        vm.prank(makeAddr("executor"));
        verifier.executeMessage(submissionId, proof);
        assertEq(tusdc.balanceOf(user), 500 * 1e18, "user should receive tokens");

        uint256 aBalBefore = bond.balanceOf(relayerA);
        uint256 bBalBefore = relayerB.balance;

        // Claim absence slash against A
        verifier.claimAbsenceSlash(submissionId);

        uint256 slashed = (aBalBefore * 5_000) / 10_000;
        assertEq(bond.balanceOf(relayerA), aBalBefore - slashed, "relayerA slashed 50% for absence");
        assertEq(relayerB.balance, bBalBefore + slashed, "relayerB receives absence slash reward");
    }

    // ─── S-4: Frivolous challenge (R-33) ──────────────────────────────────────

    /// @notice Relayer A submits an honest proof. Relayer B files a baseless challenge
    ///         with invalid evidence. B is slashed 25%; A receives the reward; message still executes.
    function test_S4_frivolous_challenge() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 trueFingerprint = keccak256("trueFingerprintS4");
        bytes memory validProof = bytes("valid_proof_s4");
        bytes memory badEvidence = bytes(""); // empty = invalid
        uint256 eventTs = block.timestamp;

        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(trueFingerprint, msgHash, validProof);

        // Relayer A submits with correct fingerprint
        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, trueFingerprint, eventTs);

        uint256 aBalBefore = bond.balanceOf(relayerA);
        uint256 bBalBefore = bond.balanceOf(relayerB);

        // Relayer B challenges with invalid evidence (empty bytes → _verifyProof returns false)
        vm.prank(relayerB);
        verifier.challenge(submissionId, keccak256("wrongFp"), badEvidence);

        // B slashed 25%, A receives reward
        uint256 slashed = (bBalBefore * 2_500) / 10_000;
        assertEq(bond.balanceOf(relayerB), bBalBefore - slashed, "relayerB slashed 25%");
        // A's bond stays the same (reward goes to A's wallet, not bond)
        assertEq(bond.balanceOf(relayerA), aBalBefore, "relayerA bond unchanged");

        // Submission remains pending — challenge window still applies
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        // Execute succeeds
        vm.prank(makeAddr("executor"));
        verifier.executeMessage(submissionId, validProof);
        assertEq(tusdc.balanceOf(user), 500 * 1e18, "user receives tokens after frivolous challenge");
    }

    // ─── Edge cases ───────────────────────────────────────────────────────────

    function test_executeMessage_doubleExecution_reverts() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("fp_double");
        bytes memory proof = bytes("proof_double");
        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);

        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, fp, block.timestamp);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(submissionId, proof);

        vm.expectRevert(Verifier.NotPending.selector);
        verifier.executeMessage(submissionId, proof);
    }

    function test_challenge_afterWindowClosed_reverts() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("fp_late");
        bytes memory proof = bytes("proof_late");
        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);

        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, fp, block.timestamp);

        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);

        vm.prank(relayerB);
        vm.expectRevert(Verifier.ChallengeWindowClosed.selector);
        verifier.challenge(submissionId, keccak256("wrong"), proof);
    }

    function test_executeMessage_beforeWindowExpiry_reverts() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("fp_early");
        bytes memory proof = bytes("proof_early");
        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);

        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, fp, block.timestamp);

        vm.expectRevert(Verifier.ChallengeWindowOpen.selector);
        verifier.executeMessage(submissionId, proof);
    }

    function test_claimAbsenceSlash_onlyIfSubmittedAfterHandover() public {
        // Submit BEFORE handover period — original assignee A submitted in time
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 fp = keccak256("fp_absence_noSlash");
        bytes memory proof = bytes("proof_absence_noSlash");
        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(fp, msgHash, proof);
        uint256 eventTs = block.timestamp;

        // Relayer A (original assignee) submits within handover period
        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, fp, eventTs);
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        verifier.executeMessage(submissionId, proof);

        // claimAbsenceSlash should revert because submittedAt == eventTimestamp (< handover period)
        vm.expectRevert(Verifier.HandoverNotElapsed.selector);
        verifier.claimAbsenceSlash(submissionId);
    }

    function test_S2_alreadyChallengedSubmission_cannotBeExecuted() public {
        MessageEnvelope memory env = _buildEnvelope(0, address(bridgeMint));
        bytes32 trueFingerprint = keccak256("tp_challenged");
        bytes32 lieFingerprint = keccak256("lp_challenged");
        bytes memory evidenceProof = bytes("evidence");
        bytes32 msgHash = _envelopeHash(env);
        verifier.markValid(trueFingerprint, msgHash, evidenceProof);

        vm.prank(relayerA);
        bytes32 submissionId = verifier.submitMessage(env, lieFingerprint, block.timestamp);

        vm.prank(relayerB);
        verifier.challenge(submissionId, trueFingerprint, evidenceProof);

        // After successful challenge the submission is Slashed — executeMessage must revert
        vm.warp(block.timestamp + verifier.CHALLENGE_WINDOW() + 1);
        vm.expectRevert(Verifier.NotPending.selector);
        verifier.executeMessage(submissionId, evidenceProof);
    }

    receive() external payable {}
}
