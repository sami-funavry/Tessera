// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TUSDC — test token for the Tessera bridge demo
/// @notice Freely mintable via claim() with a per-address 24h rate limit. BridgeMint can also mint/burn.
contract TUSDC is ERC20, Ownable {
    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant CLAIM_AMOUNT = 1_000 * 1e18;
    uint256 public constant CLAIM_COOLDOWN = 24 hours;

    // ─── State ────────────────────────────────────────────────────────────────

    address public bridgeMint;
    mapping(address => uint256) public lastClaim;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Claimed(address indexed to, uint256 amount);
    event BridgeMintSet(address indexed bridgeMint);
    event BridgeMinted(address indexed to, uint256 amount);
    event BridgeBurned(address indexed from, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ClaimTooSoon(uint256 nextClaimAt);
    error NotBridgeMint();
    error ZeroAddress();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyBridgeMint() {
        if (msg.sender != bridgeMint) revert NotBridgeMint();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() ERC20("Test USDC", "tUSDC") Ownable(msg.sender) {}

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Set the BridgeMint contract address (the only one allowed to bridge-mint/burn).
    /// @param _bridgeMint Address of the deployed BridgeMint contract.
    function setBridgeMint(address _bridgeMint) external onlyOwner {
        if (_bridgeMint == address(0)) revert ZeroAddress();
        bridgeMint = _bridgeMint;
        emit BridgeMintSet(_bridgeMint);
    }

    /// @notice Claim 1000 tUSDC. Rate-limited to once every 24 hours per address.
    function claim() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0) {
            uint256 next = last + CLAIM_COOLDOWN;
            if (block.timestamp < next) revert ClaimTooSoon(next);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice Mint `amount` tokens to `to`. Only callable by the BridgeMint contract.
    /// @param to Recipient address.
    /// @param amount Amount in wei (18 decimals).
    function bridgeMintTo(address to, uint256 amount) external onlyBridgeMint {
        _mint(to, amount);
        emit BridgeMinted(to, amount);
    }

    /// @notice Burn `amount` tokens from `from`. Only callable by the BridgeMint contract.
    /// @param from Token holder whose tokens are burned.
    /// @param amount Amount in wei (18 decimals).
    function bridgeBurnFrom(address from, uint256 amount) external onlyBridgeMint {
        _burn(from, amount);
        emit BridgeBurned(from, amount);
    }
}
