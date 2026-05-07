// Package transform implements deterministic proof format conversion (R-50, R-51).
package transform

import "github.com/tessera-bridge/tessera/internal/chain"

// PatriciaToIAVL converts a Sepolia Patricia Merkle Trie proof into an IAVL
// proof suitable for verification by the Neutron CosmWasm verifier.
// This function must be pure and deterministic: identical inputs always produce
// identical outputs so challengers can replicate and detect fraud.
func PatriciaToIAVL(proof chain.Proof) (chain.Proof, error) {
	// TODO: implement in P-4
	panic("PatriciaToIAVL not yet implemented")
}
