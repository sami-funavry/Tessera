// Package transform — PatriciaToIAVL direction (Sepolia → Neutron).
package transform

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/tessera-bridge/tessera/internal/chain"
)

// storageProofEntry mirrors the StorageResult inside gethclient.AccountResult
// for JSON parsing. We only need the fields relevant to the proof walk.
type storageProofEntry struct {
	Key   string   `json:"key"`
	Value string   `json:"value"`
	Proof []string `json:"proof"` // hex-encoded RLP nodes
}

// storageProofJSON is the top-level structure of a marshalled AccountResult.
type storageProofJSON struct {
	StorageProof []storageProofEntry `json:"storageProof"`
}

// PatriciaToIAVL transforms a Sepolia Patricia Merkle Trie proof into a
// TesseraProof using SHA-256 hashing, ready for verification by the Neutron
// CosmWasm verifier (R-51, R-52).
//
// The algorithm re-hashes each RLP-encoded Patricia node with SHA-256.
// Any honest party running this on the same proof data gets byte-identical
// output, so challengers can detect fraud by replication (R-52).
//
// msgId derivation matches the CosmWasm tessera_types::message_id():
//
//	sha256("msg:" + sourceChainID + ":" + sourceApp + ":" + nonce)
func PatriciaToIAVL(proof chain.Proof, env chain.MessageEnvelope) (chain.Proof, error) {
	// Build the SHA-256 msgId matching CosmWasm message_id().
	msgIDStr := fmt.Sprintf("msg:%s:%s:%s",
		env.SourceChainID, env.SourceApp, strconv.FormatUint(env.Nonce, 10))
	msgID := sha256.Sum256([]byte(msgIDStr))

	// Parse the JSON-serialised AccountResult stored by the Ethereum plugin.
	var ap storageProofJSON
	if len(proof.ProofBytes) > 0 {
		if err := json.Unmarshal(proof.ProofBytes, &ap); err != nil {
			return chain.Proof{}, fmt.Errorf("PatriciaToIAVL: unmarshal AccountResult: %w", err)
		}
	}

	// Decode leafKey — hex string → bytes, right-aligned (big-endian) into 32 bytes.
	var leafKey [32]byte
	if len(ap.StorageProof) > 0 && ap.StorageProof[0].Key != "" {
		kb, err := hexutil.Decode(ap.StorageProof[0].Key)
		if err != nil {
			// Fall back to the KeyPath from the proof struct.
			kb = proof.KeyPath
		}
		if len(kb) > 32 {
			kb = kb[len(kb)-32:]
		}
		copy(leafKey[32-len(kb):], kb)
	} else if len(proof.KeyPath) > 0 {
		kb := proof.KeyPath
		if len(kb) > 32 {
			kb = kb[len(kb)-32:]
		}
		copy(leafKey[32-len(kb):], kb)
	}

	// Decode leafValue — same right-alignment.
	var leafValue [32]byte
	if len(ap.StorageProof) > 0 && ap.StorageProof[0].Value != "" {
		vb, err := hexutil.Decode(ap.StorageProof[0].Value)
		if err != nil {
			vb = proof.Value
		}
		if len(vb) > 32 {
			vb = vb[len(vb)-32:]
		}
		copy(leafValue[32-len(vb):], vb)
	} else if len(proof.Value) > 0 {
		vb := proof.Value
		if len(vb) > 32 {
			vb = vb[len(vb)-32:]
		}
		copy(leafValue[32-len(vb):], vb)
	}

	// Build nodeHashes: SHA-256 of each raw RLP-encoded Patricia node.
	var nodes []string
	if len(ap.StorageProof) > 0 {
		nodes = ap.StorageProof[0].Proof
	}
	nodeHashes := make([][32]byte, len(nodes))
	for i, hexNode := range nodes {
		rlpBytes, err := hexutil.Decode(hexNode)
		if err != nil {
			return chain.Proof{}, fmt.Errorf("PatriciaToIAVL: decode node[%d]: %w", i, err)
		}
		nodeHashes[i] = sha256.Sum256(rlpBytes)
	}

	tessera := &TesseraProof{
		Flags:      FlagSHA256,
		MsgID:      msgID,
		LeafKey:    leafKey,
		LeafValue:  leafValue,
		NodeHashes: nodeHashes,
	}

	root := tessera.ComputeRoot()
	encoded := tessera.Encode()

	return chain.Proof{
		ChainID:     "pion-1",
		BlockNumber: proof.BlockNumber,
		StateRoot:   root[:],
		ProofBytes:  encoded,
		KeyPath:     leafKey[:],
		Value:       leafValue[:],
	}, nil
}
