// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/Verifier.sol";

/// @dev Test-only override of Verifier that allows whitelisting specific (fingerprint, msgHash, proof)
///      triples as valid. Any other combination returns false.
///      This lets tests model S-1/S-2/S-3/S-4 without real Patricia trie proofs.
contract TestableVerifier is Verifier {
    // keccak256(fingerprint, msgHash, proof) → valid
    mapping(bytes32 => bool) public validProofKeys;

    constructor(address _bond, address _registry) Verifier(_bond, _registry) {}

    /// @notice Mark a specific (fingerprint, msgHash, proofBytes) triple as valid.
    function markValid(bytes32 fp, bytes32 msgHash, bytes memory proof) external {
        validProofKeys[keccak256(abi.encodePacked(fp, msgHash, proof))] = true;
    }

    function _verifyProof(bytes32 fingerprint, bytes32 msgHash, bytes calldata proof)
        internal
        view
        override
        returns (bool)
    {
        return validProofKeys[keccak256(abi.encodePacked(fingerprint, msgHash, proof))];
    }
}
