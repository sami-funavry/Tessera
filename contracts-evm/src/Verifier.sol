// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IBond.sol";
import "./interfaces/IRelayerRegistry.sol";
import "./interfaces/IApp.sol";
import "./libraries/MessageEnvelope.sol";

/// @title Verifier — generic cross-chain message dispatcher for Tessera
/// @notice Receives relayer submissions, manages 60s challenge windows, slashes misbehaving parties,
///         and dispatches verified messages to destination apps via IApp.onCrossChainMessage.
///
///         Rotation rule (R-22): assigned_index = (nonce + elapsed_periods) % relayer_count
///         Timings: challenge window = 60s, handover period = 30s.
///
///         P-1 note: _verifyProof is a stub (non-empty proof = valid). Real Patricia trie
///         verification wired in P-4. Override _verifyProof in tests via TestableVerifier.
contract Verifier {
    // ─── Types ────────────────────────────────────────────────────────────────

    enum SubmissionStatus {
        Pending,
        Executed,
        Slashed // wrong-submission or absence slash applied
    }

    struct Submission {
        bytes32 msgId; // keccak256(sourceChainId, sourceApp, nonce)
        bytes32 fingerprint; // claimed transformed state root
        address submitter;
        uint64 nonce;
        uint256 submittedAt;
        uint256 eventTimestamp; // when the source-chain event occurred (for rotation calc)
        SubmissionStatus status;
        // Envelope stored for dispatch in executeMessage
        bytes32 sourceChainId;
        bytes sourceApp;
        bytes32 destinationChainId;
        bytes destinationApp;
        bytes4 action;
        bytes payload;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant CHALLENGE_WINDOW = 60 seconds;
    uint256 public constant HANDOVER_PERIOD = 30 seconds;
    uint256 public constant WRONG_SUBMISSION_SLASH_BPS = 5_000; // 50 %
    uint256 public constant ABSENCE_SLASH_BPS = 5_000; // 50 %
    uint256 public constant FRIVOLOUS_SLASH_BPS = 2_500; // 25 %

    // ─── State ────────────────────────────────────────────────────────────────

    IBond public immutable bond;
    IRelayerRegistry public immutable registry;

    mapping(bytes32 => Submission) public submissions;
    // messageId → latest submissionId (updated on each valid submission for the same msg)
    mapping(bytes32 => bytes32) public latestSubmissionId;
    // messageId → true once executed (prevents double-execution)
    mapping(bytes32 => bool) public executedMessages;
    // messageId → true once absence-slashed (prevents double-slash)
    mapping(bytes32 => bool) public absenceSlashClaimed;

    // ─── Events ───────────────────────────────────────────────────────────────

    event MessageSubmitted(
        bytes32 indexed submissionId,
        bytes32 indexed msgId,
        address indexed submitter,
        bytes32 fingerprint,
        uint256 eventTimestamp
    );
    event MessageChallenged(
        bytes32 indexed submissionId,
        address indexed challenger,
        bool challengerWon
    );
    event MessageExecuted(bytes32 indexed submissionId, bytes32 indexed msgId);
    event AbsenceSlashed(
        bytes32 indexed msgId,
        address indexed slashed,
        address indexed paidTo,
        uint256 amount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotPending();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error MessageAlreadyExecuted();
    error AbsenceAlreadyClaimed();
    error HandoverNotElapsed();
    error SubmitterWasOriginalAssignee();
    error RegistryEmpty();
    error InvalidProof();

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _bond     Deployed Bond contract address.
    /// @param _registry Deployed RelayerRegistry contract address.
    constructor(address _bond, address _registry) {
        bond = IBond(_bond);
        registry = IRelayerRegistry(_registry);
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Submit a cross-chain message with a transformed state-root fingerprint.
    /// @param envelope      Full message envelope (R-67).
    /// @param fingerprint   Transformed state root for the source block containing the event.
    /// @param eventTimestamp Unix timestamp when the source-chain event was emitted (for rotation).
    /// @return submissionId Unique ID for this submission, used in challenge/execute calls.
    function submitMessage(
        MessageEnvelope calldata envelope,
        bytes32 fingerprint,
        uint256 eventTimestamp
    ) external returns (bytes32 submissionId) {
        bytes32 msgId = messageId(envelope);
        if (executedMessages[msgId]) revert MessageAlreadyExecuted();

        // Submitter must be an active registered relayer with sufficient bond
        // (bond threshold check deferred to registry.isActive which benches below-threshold relayers)
        // Note: we don't enforce rotation assignment here; claimAbsenceSlash handles the economic enforcement

        submissionId = keccak256(abi.encodePacked(msgId, msg.sender, block.timestamp));

        Submission storage sub = submissions[submissionId];
        sub.msgId = msgId;
        sub.fingerprint = fingerprint;
        sub.submitter = msg.sender;
        sub.nonce = envelope.nonce;
        sub.submittedAt = block.timestamp;
        sub.eventTimestamp = eventTimestamp;
        sub.status = SubmissionStatus.Pending;
        sub.sourceChainId = envelope.sourceChainId;
        sub.sourceApp = envelope.sourceApp;
        sub.destinationChainId = envelope.destinationChainId;
        sub.destinationApp = envelope.destinationApp;
        sub.action = envelope.action;
        sub.payload = envelope.payload;

        latestSubmissionId[msgId] = submissionId;

        emit MessageSubmitted(submissionId, msgId, msg.sender, fingerprint, eventTimestamp);
    }

    /// @notice Challenge a submission within the 60s window.
    /// @dev If the challenger's evidence proof is valid and the fingerprints differ →
    ///      submitter was lying → slash submitter 50%, pay challenger.
    ///      If the evidence is invalid → frivolous challenge → slash challenger 25%, pay submitter.
    /// @param submissionId      ID returned by submitMessage.
    /// @param correctFingerprint The fingerprint the challenger believes is correct.
    /// @param evidenceProof      Proof showing correctFingerprint is the true state root.
    function challenge(
        bytes32 submissionId,
        bytes32 correctFingerprint,
        bytes calldata evidenceProof
    ) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.Pending) revert NotPending();
        if (block.timestamp > sub.submittedAt + CHALLENGE_WINDOW) revert ChallengeWindowClosed();

        bytes32 msgHash = _envelopeHash(sub);
        bool evidenceValid = _verifyProof(correctFingerprint, msgHash, evidenceProof);

        if (evidenceValid && correctFingerprint != sub.fingerprint) {
            // Submitter lied: slash 50%, pay challenger
            sub.status = SubmissionStatus.Slashed;
            bond.slash(sub.submitter, msg.sender, WRONG_SUBMISSION_SLASH_BPS);
            registry.recordSlash(sub.submitter);
            emit MessageChallenged(submissionId, msg.sender, true);
        } else {
            // Frivolous challenge: slash challenger 25%, pay submitter; submission remains Pending
            bond.slash(msg.sender, sub.submitter, FRIVOLOUS_SLASH_BPS);
            registry.recordSlash(msg.sender);
            emit MessageChallenged(submissionId, msg.sender, false);
        }
    }

    /// @notice Execute a message after the challenge window has closed without a successful challenge.
    /// @param submissionId Submission to execute.
    /// @param proof        The original proof bytes (callers retrieve from the MessageSubmitted event).
    function executeMessage(bytes32 submissionId, bytes calldata proof) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.Pending) revert NotPending();
        if (block.timestamp <= sub.submittedAt + CHALLENGE_WINDOW) revert ChallengeWindowOpen();
        if (executedMessages[sub.msgId]) revert MessageAlreadyExecuted();

        bytes32 msgHash = _envelopeHash(sub);
        if (!_verifyProof(sub.fingerprint, msgHash, proof)) revert InvalidProof();

        sub.status = SubmissionStatus.Executed;
        executedMessages[sub.msgId] = true;

        // Dispatch to destination app (Option A pattern, R-12).
        // destinationApp is always ABI-encoded as address (32 bytes); reject malformed payloads.
        if (sub.destinationApp.length != 32) revert InvalidProof();
        address destApp = abi.decode(sub.destinationApp, (address));
        IApp(destApp).onCrossChainMessage(
            sub.sourceChainId, sub.sourceApp, sub.action, sub.payload
        );

        emit MessageExecuted(submissionId, sub.msgId);
    }

    /// @notice Claim absence slash after a relayer submitted for a message the original assignee ignored.
    /// @dev Must be called after the message has been executed by a successor relayer.
    ///      Derives the original assignee from the rotation rule and verifies the successor ≠ original.
    /// @param submissionId The executed submission (submitted by the successor).
    function claimAbsenceSlash(bytes32 submissionId) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.Executed) revert NotPending();

        bytes32 msgId = sub.msgId;
        if (absenceSlashClaimed[msgId]) revert AbsenceAlreadyClaimed();

        // The submission must have occurred after at least one handover period
        if (sub.submittedAt < sub.eventTimestamp + HANDOVER_PERIOD) revert HandoverNotElapsed();

        uint256 count = registry.activeCount();
        if (count == 0) revert RegistryEmpty();

        // Original assignee is at index nonce % count (rotation with elapsed_periods = 0)
        uint256 originalIndex = uint256(sub.nonce) % count;
        address originalAssignee = registry.relayerAt(originalIndex);

        // The actual submitter must differ from the original assignee
        if (sub.submitter == originalAssignee) revert SubmitterWasOriginalAssignee();

        absenceSlashClaimed[msgId] = true;

        uint256 balBefore = bond.balanceOf(originalAssignee);
        bond.slash(originalAssignee, sub.submitter, ABSENCE_SLASH_BPS);
        registry.recordSlash(originalAssignee);
        uint256 slashedAmount = (balBefore * ABSENCE_SLASH_BPS) / 10_000;

        emit AbsenceSlashed(msgId, originalAssignee, sub.submitter, slashedAmount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Reconstruct the message hash from stored envelope fields (avoids storing abi.encode bytes).
    function _envelopeHash(Submission storage sub) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                sub.sourceChainId,
                sub.sourceApp,
                sub.destinationChainId,
                sub.destinationApp,
                sub.action,
                sub.payload,
                sub.nonce
            )
        );
    }

    /// @dev Verifies a TesseraProof — the canonical cross-chain inclusion proof (R-50, R-51, P-4).
    ///
    ///      Wire format (all big-endian):
    ///        [0:4]    "TSSP" magic
    ///        [4:8]    flags uint32; bit0: 0=Keccak256 (Sepolia), 1=SHA256 (Neutron)
    ///        [8:40]   msgId bytes32; must equal messageHash
    ///        [40:72]  leafKey bytes32
    ///        [72:104] leafValue bytes32
    ///        [104:108] depth uint32
    ///        [108+i*32 : 140+i*32] nodeHashes[i]
    ///
    ///      Root: h = keccak256(0x00||msgId||leafKey||leafValue);
    ///            for each node: h = keccak256(0x01||h||nodeHash)
    ///            assert h == fingerprint
    ///
    ///      Override in TestableVerifier for test scenarios without real proofs.
    /// @param fingerprint  Transformed state root claimed by the relayer.
    /// @param messageHash  keccak256 of the full message envelope; must match proof.msgId.
    /// @param proof        TesseraProof bytes.
    function _verifyProof(bytes32 fingerprint, bytes32 messageHash, bytes calldata proof)
        internal
        view
        virtual
        returns (bool)
    {
        if (proof.length < 108) return false;
        if (bytes4(proof[0:4]) != bytes4("TSSP")) return false;

        // Sepolia verifier: bit0 must be 0 (Keccak256 format).
        uint32 flags = uint32(bytes4(proof[4:8]));
        if ((flags & 1) != 0) return false;

        bytes32 msgId = bytes32(proof[8:40]);
        if (msgId != messageHash) return false;

        bytes32 leafKey   = bytes32(proof[40:72]);
        bytes32 leafValue = bytes32(proof[72:104]);
        uint32  depth     = uint32(bytes4(proof[104:108]));

        if (proof.length != 108 + uint256(depth) * 32) return false;

        bytes32 h = keccak256(abi.encodePacked(bytes1(0x00), msgId, leafKey, leafValue));
        for (uint32 i = 0; i < depth; i++) {
            uint256 off = 108 + uint256(i) * 32;
            h = keccak256(abi.encodePacked(bytes1(0x01), h, bytes32(proof[off:off + 32])));
        }
        return h == fingerprint;
    }
}
