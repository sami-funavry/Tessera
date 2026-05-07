// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IApp.sol";
import "./TUSDC.sol";

/// @title BridgeMint — destination-side mint/burn for tUSDC on Sepolia
/// @notice Verifier calls onCrossChainMessage() after verifying a lock on Neutron → Sepolia messages.
///         Users call burn() to initiate Sepolia → Neutron returns.
contract BridgeMint is IApp, ReentrancyGuard {
    // ─── State ────────────────────────────────────────────────────────────────

    address public immutable verifier;
    TUSDC public immutable tusdc;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Minted(address indexed recipient, uint256 amount, uint64 nonce);
    event Burned(address indexed from, uint256 amount, bytes32 destinationChainId, bytes destinationApp);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotVerifier();
    error ZeroAmount();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _verifier Address of the Verifier contract.
    /// @param _tusdc Address of the TUSDC contract (this contract must be authorized as bridgeMint).
    constructor(address _verifier, address _tusdc) {
        verifier = _verifier;
        tusdc = TUSDC(_tusdc);
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Burn `amount` tUSDC from `msg.sender` to initiate a cross-chain return.
    /// @param amount Token amount in wei.
    /// @param destinationChainId Target chain identifier.
    /// @param destinationApp Target vault contract address encoded as bytes.
    function burn(uint256 amount, bytes32 destinationChainId, bytes calldata destinationApp)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        tusdc.bridgeBurnFrom(msg.sender, amount);
        emit Burned(msg.sender, amount, destinationChainId, destinationApp);
    }

    // ─── IApp ─────────────────────────────────────────────────────────────────

    /// @notice Called by Verifier after verifying a lock message from the source chain.
    /// @dev payload is abi.encode(recipient, amount, nonce).
    function onCrossChainMessage(
        bytes32, /* sourceChainId */
        bytes calldata, /* sourceApp */
        bytes4, /* action */
        bytes calldata payload
    ) external onlyVerifier nonReentrant {
        (address recipient, uint256 amount, uint64 nonce) = abi.decode(payload, (address, uint256, uint64));
        if (amount == 0) revert ZeroAmount();
        tusdc.bridgeMintTo(recipient, amount);
        emit Minted(recipient, amount, nonce);
    }
}
