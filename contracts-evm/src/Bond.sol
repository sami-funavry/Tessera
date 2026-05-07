// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IBond.sol";

/// @title Bond — ETH custody and slashing for Tessera relayers
/// @notice Relayers deposit ETH here. Verifier slashes misbehaving relayers.
///         Three-tier thresholds: Initial 0.5 ETH, Operating 0.25 ETH, Deregistration 0.125 ETH.
contract Bond is IBond {
    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant INITIAL_BOND = 0.5 ether;
    uint256 public constant OPERATING_THRESHOLD = 0.25 ether;
    uint256 public constant DEREGISTRATION_THRESHOLD = 0.125 ether;
    uint256 public constant WITHDRAWAL_COOLDOWN = 1 hours;
    uint256 public constant BASIS_POINTS = 10_000;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @dev Verifier address. Set once by deployer via setVerifier(); never changeable after.
    address public verifier;
    address private _deployer;

    mapping(address => uint256) private _balance;
    mapping(address => uint256) public withdrawalRequestedAt;
    mapping(address => uint256) public pendingWithdrawal;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(address indexed relayer, uint256 amount);
    event WithdrawalRequested(address indexed relayer, uint256 amount, uint256 unlocksAt);
    event Withdrawn(address indexed relayer, uint256 amount);
    event Slashed(address indexed target, address indexed recipient, uint256 amount);

    // ─── Events ─ (additional) ───────────────────────────────────────────────

    event VerifierSet(address indexed verifier);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotVerifier();
    error NotDeployer();
    error VerifierAlreadySet();
    error ZeroAddress();
    error ZeroDeposit();
    error InsufficientBond();
    error CooldownNotElapsed(uint256 unlocksAt);
    error NoPendingWithdrawal();
    error TransferFailed();
    error InvalidBps();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        _deployer = msg.sender;
    }

    // ─── One-time verifier init ───────────────────────────────────────────────

    /// @notice Set the Verifier address. Can only be called once, by the deployer, before any slashing.
    ///         Follows the standard deploy pattern: Bond → Registry → Verifier → setVerifier.
    /// @param _verifier Address of the deployed Verifier contract.
    function setVerifier(address _verifier) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (verifier != address(0)) revert VerifierAlreadySet();
        if (_verifier == address(0)) revert ZeroAddress();
        verifier = _verifier;
        _deployer = address(0); // prevent second call
        emit VerifierSet(_verifier);
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Deposit ETH as bond for `relayer`. Anyone can top up a relayer's bond.
    /// @param relayer The relayer account whose bond is increased.
    function deposit(address relayer) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        _balance[relayer] += msg.value;
        emit Deposited(relayer, msg.value);
    }

    /// @notice Request a withdrawal of `amount` ETH. Starts the 1-hour cooldown.
    ///         Balance is immediately locked (deducted from active balance).
    ///         The remaining active balance must stay at or above DEREGISTRATION_THRESHOLD.
    /// @param amount ETH amount in wei.
    function requestWithdrawal(uint256 amount) external {
        if (amount == 0) revert ZeroDeposit();
        uint256 bal = _balance[msg.sender];
        if (bal < amount) revert InsufficientBond();
        uint256 remaining = bal - amount;
        if (remaining < DEREGISTRATION_THRESHOLD) revert InsufficientBond();
        _balance[msg.sender] = remaining;
        pendingWithdrawal[msg.sender] += amount;
        withdrawalRequestedAt[msg.sender] = block.timestamp;
        emit WithdrawalRequested(msg.sender, amount, block.timestamp + WITHDRAWAL_COOLDOWN);
    }

    /// @notice Complete a pending withdrawal after the 1-hour cooldown has elapsed.
    function withdraw() external {
        uint256 pending = pendingWithdrawal[msg.sender];
        if (pending == 0) revert NoPendingWithdrawal();
        uint256 unlocksAt = withdrawalRequestedAt[msg.sender] + WITHDRAWAL_COOLDOWN;
        if (block.timestamp < unlocksAt) revert CooldownNotElapsed(unlocksAt);
        pendingWithdrawal[msg.sender] = 0;
        withdrawalRequestedAt[msg.sender] = 0;
        (bool ok,) = msg.sender.call{ value: pending }("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, pending);
    }

    // ─── IBond ────────────────────────────────────────────────────────────────

    /// @inheritdoc IBond
    function balanceOf(address relayer) external view returns (uint256) {
        return _balance[relayer];
    }

    /// @inheritdoc IBond
    function meetsOperatingThreshold(address relayer) external view returns (bool) {
        return _balance[relayer] >= OPERATING_THRESHOLD;
    }

    /// @inheritdoc IBond
    /// @dev `bps` is in basis-points (10_000 = 100%). The full slashed amount is sent to `recipient`.
    function slash(address target, address recipient, uint256 bps) external onlyVerifier {
        if (bps == 0 || bps > BASIS_POINTS) revert InvalidBps();
        uint256 bal = _balance[target];
        if (bal == 0) revert InsufficientBond();
        uint256 amount = (bal * bps) / BASIS_POINTS;
        _balance[target] -= amount;
        (bool ok,) = recipient.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit Slashed(target, recipient, amount);
    }

    // ─── Receive ──────────────────────────────────────────────────────────────

    receive() external payable {}
}
