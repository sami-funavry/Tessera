// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IApp
/// @notice All destination applications must implement this interface.
///         Called by Verifier after proof verification. Implement onlyVerifier.
interface IApp {
    function onCrossChainMessage(
        bytes32 sourceChainId,
        bytes calldata sourceApp,
        bytes4 action,
        bytes calldata payload
    ) external;
}
