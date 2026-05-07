// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Canonical cross-chain message envelope (R-67).
struct MessageEnvelope {
    bytes32 sourceChainId;
    bytes sourceApp;
    bytes32 destinationChainId;
    bytes destinationApp;
    bytes4 action;
    bytes payload;
    uint64 nonce;
}

/// @dev Derive a deterministic message ID from the envelope's source identity + nonce.
///      Different relayers submitting the same message should produce the same messageId.
function messageId(MessageEnvelope calldata env) pure returns (bytes32) {
    return keccak256(abi.encode(env.sourceChainId, env.sourceApp, env.nonce));
}
