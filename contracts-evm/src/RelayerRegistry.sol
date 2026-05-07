// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IRelayerRegistry.sol";
import "./interfaces/IBond.sol";

/// @title RelayerRegistry — identity, bond state, and ordered relayer list for Tessera
/// @notice Tracks relayer state machine: Active → Benched → Deregistered → CoolingDown.
///         Bond thresholds are enforced by reading from the Bond contract.
contract RelayerRegistry is IRelayerRegistry {
    // ─── Types ────────────────────────────────────────────────────────────────

    enum RelayerStatus {
        Unknown,
        Active,
        Benched, // below operating threshold
        CoolingDown, // deregistered but within re-registration cooldown
        Deregistered
    }

    struct RelayerInfo {
        RelayerStatus status;
        bytes pubkey; // Ed25519 public key for off-chain signature verification
        uint256 registeredAt;
        uint256 deregisteredAt;
        uint256 slashCount;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant REREGISTRATION_COOLDOWN = 1 hours;

    // ─── State ────────────────────────────────────────────────────────────────

    IBond public immutable bond;
    address public verifier;
    address private _deployer;

    mapping(address => RelayerInfo) public relayers;

    // Ordered active list — append-only insert, swap-and-pop remove
    address[] private _activeList;
    mapping(address => uint256) private _activeIndex; // relayer → index in _activeList

    // ─── Events ───────────────────────────────────────────────────────────────

    event Registered(address indexed relayer, bytes pubkey);
    event Deregistered(address indexed relayer);
    event KeyRotated(address indexed relayer, bytes newPubkey);
    event StatusChanged(address indexed relayer, RelayerStatus newStatus);

    // ─── Events (additional) ──────────────────────────────────────────────────

    event VerifierSet(address indexed verifier);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotVerifier();
    error NotDeployer();
    error VerifierAlreadySet();
    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientBond();
    error CoolingDown(uint256 unlocksAt);
    error NotActive();
    error ZeroPubkey();
    error ZeroAddress();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _bond Address of the Bond contract.
    constructor(address _bond) {
        bond = IBond(_bond);
        _deployer = msg.sender;
    }

    // ─── One-time verifier init ───────────────────────────────────────────────

    /// @notice Set the Verifier address. Can only be called once by the deployer.
    ///         Standard deploy order: Bond → Registry → Verifier → setVerifier on both.
    function setVerifier(address _verifier) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (verifier != address(0)) revert VerifierAlreadySet();
        if (_verifier == address(0)) revert ZeroAddress();
        verifier = _verifier;
        _deployer = address(0);
        emit VerifierSet(_verifier);
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Register as a relayer. Caller must have already deposited ≥INITIAL_BOND in Bond.
    /// @param pubkey Ed25519 public key used for off-chain proof signing.
    function register(bytes calldata pubkey) external {
        if (pubkey.length == 0) revert ZeroPubkey();
        RelayerInfo storage info = relayers[msg.sender];

        if (info.status == RelayerStatus.Active || info.status == RelayerStatus.Benched) {
            revert AlreadyRegistered();
        }
        if (info.status == RelayerStatus.CoolingDown) {
            uint256 unlocksAt = info.deregisteredAt + REREGISTRATION_COOLDOWN;
            if (block.timestamp < unlocksAt) revert CoolingDown(unlocksAt);
        }
        if (bond.balanceOf(msg.sender) < bond.INITIAL_BOND()) revert InsufficientBond();

        info.status = RelayerStatus.Active;
        info.pubkey = pubkey;
        info.registeredAt = block.timestamp;
        info.slashCount = 0;

        _activeIndex[msg.sender] = _activeList.length;
        _activeList.push(msg.sender);

        emit Registered(msg.sender, pubkey);
        emit StatusChanged(msg.sender, RelayerStatus.Active);
    }

    /// @notice Voluntarily deregister. Moves status to CoolingDown.
    function deregister() external {
        RelayerInfo storage info = relayers[msg.sender];
        if (info.status != RelayerStatus.Active && info.status != RelayerStatus.Benched) {
            revert NotRegistered();
        }
        info.status = RelayerStatus.CoolingDown;
        info.deregisteredAt = block.timestamp;
        _removeFromActiveList(msg.sender);
        emit Deregistered(msg.sender);
        emit StatusChanged(msg.sender, RelayerStatus.CoolingDown);
    }

    /// @notice Rotate Ed25519 public key. Only active relayers.
    /// @param newPubkey New Ed25519 public key bytes.
    function rotateKey(bytes calldata newPubkey) external {
        if (newPubkey.length == 0) revert ZeroPubkey();
        RelayerInfo storage info = relayers[msg.sender];
        if (info.status != RelayerStatus.Active) revert NotActive();
        info.pubkey = newPubkey;
        emit KeyRotated(msg.sender, newPubkey);
    }

    // ─── IRelayerRegistry ─────────────────────────────────────────────────────

    /// @inheritdoc IRelayerRegistry
    function activeCount() external view returns (uint256) {
        return _activeList.length;
    }

    /// @inheritdoc IRelayerRegistry
    function relayerAt(uint256 index) external view returns (address) {
        return _activeList[index];
    }

    /// @inheritdoc IRelayerRegistry
    function isActive(address relayer) external view returns (bool) {
        return relayers[relayer].status == RelayerStatus.Active;
    }

    /// @inheritdoc IRelayerRegistry
    /// @dev Called by Verifier after slashing. Updates status based on new bond balance.
    function recordSlash(address relayer) external onlyVerifier {
        RelayerInfo storage info = relayers[relayer];
        info.slashCount += 1;

        uint256 bal = bond.balanceOf(relayer);
        if (bal < bond.DEREGISTRATION_THRESHOLD()) {
            // Double-slashed: forced deregistration
            if (info.status == RelayerStatus.Active || info.status == RelayerStatus.Benched) {
                _removeFromActiveList(relayer);
            }
            info.status = RelayerStatus.Deregistered;
            info.deregisteredAt = block.timestamp;
            emit Deregistered(relayer);
            emit StatusChanged(relayer, RelayerStatus.Deregistered);
        } else if (bal < bond.OPERATING_THRESHOLD()) {
            // Below operating threshold: benched (can still be challenged, cannot submit)
            if (info.status == RelayerStatus.Active) {
                info.status = RelayerStatus.Benched;
                emit StatusChanged(relayer, RelayerStatus.Benched);
            }
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _removeFromActiveList(address relayer) internal {
        uint256 idx = _activeIndex[relayer];
        uint256 last = _activeList.length - 1;
        if (idx != last) {
            address moved = _activeList[last];
            _activeList[idx] = moved;
            _activeIndex[moved] = idx;
        }
        _activeList.pop();
        delete _activeIndex[relayer];
    }
}
