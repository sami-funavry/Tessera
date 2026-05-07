// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IBond — Bond contract interface consumed by Verifier and RelayerRegistry
interface IBond {
    /// @notice Return the current active bond balance for a relayer.
    function balanceOf(address relayer) external view returns (uint256);

    /// @notice Return true if `relayer` meets the operating threshold (≥50% of initial bond).
    function meetsOperatingThreshold(address relayer) external view returns (bool);

    /// @notice Slash `bps` basis-points of `target`'s bond and award 100% to `recipient`.
    /// @dev Only callable by the Verifier contract.
    function slash(address target, address recipient, uint256 bps) external;

    /// @notice The operating threshold below which new submissions are blocked.
    function OPERATING_THRESHOLD() external view returns (uint256);

    /// @notice The deregistration threshold below which relayers are force-removed.
    function DEREGISTRATION_THRESHOLD() external view returns (uint256);

    /// @notice The initial bond minimum required to register as a relayer.
    function INITIAL_BOND() external view returns (uint256);
}
