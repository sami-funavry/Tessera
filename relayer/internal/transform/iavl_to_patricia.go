package transform

import "github.com/tessera-bridge/tessera/internal/chain"

// IAVLToPatricia converts a Neutron IAVL proof into a Patricia Merkle Trie
// proof suitable for verification by the Sepolia Solidity verifier.
// The Ed25519 Tendermint signatures are verified off-chain here before
// transformation; the Solidity verifier sees only the Patricia walk (R-51).
func IAVLToPatricia(proof chain.Proof) (chain.Proof, error) {
	// TODO: implement in P-4
	panic("IAVLToPatricia not yet implemented")
}
