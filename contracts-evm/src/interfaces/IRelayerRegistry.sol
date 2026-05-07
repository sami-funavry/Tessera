// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IRelayerRegistry — registry interface consumed by Verifier
interface IRelayerRegistry {
    /// @notice Return the number of currently active relayers.
    function activeCount() external view returns (uint256);

    /// @notice Return the address of the relayer at position `index` in the active list.
    function relayerAt(uint256 index) external view returns (address);

    /// @notice Return true if `relayer` is in the Active state.
    function isActive(address relayer) external view returns (bool);

    /// @notice Record a slash against `relayer` (called by Verifier after Bond.slash).
    function recordSlash(address relayer) external;
}
