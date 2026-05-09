// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IApp.sol";

/// @title BridgeVault — source-side lock/release for ERC20 tokens on Sepolia
/// @notice Users lock tokens here to initiate a cross-chain transfer.
///         Verifier calls release() when the return message is verified.
contract BridgeVault is IApp, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ────────────────────────────────────────────────────────────────

    address public immutable verifier;
    address public immutable token; // tUSDC on Sepolia

    // nonce → locked amount (for replay protection)
    mapping(uint64 => uint256) public lockedAmount;
    mapping(uint64 => address) public lockedBy;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev `destinationRecipient` is the user's address on the destination chain
    /// (e.g. a Neutron bech32 string for Sepolia→Neutron). The relayer reads this
    /// off the event log and packs it into the `BridgePayload` it sends to the
    /// destination Verifier. Without this field the destination app has no way
    /// to know who to mint/release to (P-10.10 fix; previously the recipient was
    /// never persisted on-chain and the destination app reverted with
    /// `invalid bridge payload`).
    event Locked(
        address indexed user,
        uint256 amount,
        uint64 nonce,
        bytes32 destinationChainId,
        bytes destinationApp,
        bytes destinationRecipient
    );
    event Released(address indexed recipient, uint256 amount, uint64 nonce);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotVerifier();
    error ZeroAmount();
    error ZeroRecipient();
    error NonceDuplicate(uint64 nonce);
    error UnknownNonce(uint64 nonce);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _verifier Address of the Verifier contract.
    /// @param _token Address of the tUSDC ERC20 token on this chain.
    constructor(address _verifier, address _token) {
        verifier = _verifier;
        token = _token;
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Lock `amount` tokens. Caller must have approved this contract first.
    /// @param amount Token amount in wei (18 decimals).
    /// @param nonce Globally unique message nonce assigned by the caller (typically the Verifier on the source side).
    /// @param destinationChainId Target chain identifier.
    /// @param destinationApp Target app contract address encoded as bytes.
    /// @param destinationRecipient Target user address on the destination chain
    /// (e.g. Neutron bech32 string). Must be non-empty — the destination app
    /// uses this to know who to credit. The relayer copies it verbatim into
    /// the cross-chain payload; the bridge has no other path for it to
    /// travel.
    function lock(
        uint256 amount,
        uint64 nonce,
        bytes32 destinationChainId,
        bytes calldata destinationApp,
        bytes calldata destinationRecipient
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (destinationRecipient.length == 0) revert ZeroRecipient();
        if (lockedBy[nonce] != address(0)) revert NonceDuplicate(nonce);

        lockedAmount[nonce] = amount;
        lockedBy[nonce] = msg.sender;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(msg.sender, amount, nonce, destinationChainId, destinationApp, destinationRecipient);
    }

    // ─── IApp ─────────────────────────────────────────────────────────────────

    /// @notice Called by Verifier after a verified return message (burn on destination side).
    /// @dev payload is abi.encode(recipient, amount, nonce).
    function onCrossChainMessage(
        bytes32, /* sourceChainId */
        bytes calldata, /* sourceApp */
        bytes4, /* action */
        bytes calldata payload
    ) external onlyVerifier nonReentrant {
        (address recipient, uint256 amount, uint64 nonce) = abi.decode(payload, (address, uint256, uint64));
        if (amount == 0) revert ZeroAmount();
        // CEI: clear storage before external call to prevent double-release (H-6).
        if (lockedAmount[nonce] == 0) revert UnknownNonce(nonce);
        uint256 locked = lockedAmount[nonce];
        lockedAmount[nonce] = 0;
        lockedBy[nonce] = address(0);
        if (amount > locked) revert ZeroAmount(); // amount must not exceed locked
        IERC20(token).safeTransfer(recipient, amount);
        emit Released(recipient, amount, nonce);
    }
}
