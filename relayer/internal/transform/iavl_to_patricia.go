// Package transform — IAVLToPatricia direction (Neutron → Sepolia).
package transform

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/tessera-bridge/tessera/internal/chain"
)

// tendermintProofJSON is the JSON format used to store all ABCI proof ops.
// The tendermint plugin serialises its proof data in this structure so that
// the transform layer can access every op.Data without losing information.
type tendermintProofJSON struct {
	Value    hexutil.Bytes   `json:"value"`
	ProofOps []hexutil.Bytes `json:"proof_ops"`
}

// IAVLToPatricia converts a Neutron IAVL proof into a TesseraProof using
// Keccak256 hashing, ready for verification by the Sepolia Solidity verifier
// (R-51, R-52).
//
// The Ed25519 Tendermint consensus is verified off-chain in Go (VerifyConsensus)
// before this function is called. This function only performs the deterministic
// hash transformation; the Solidity verifier sees only the Keccak walk (R-55).
//
// msgId derivation matches Solidity's _envelopeHash:
//
//	keccak256(abi.encode(srcChainId, srcApp, dstChainId, dstApp, action, payload, nonce))
func IAVLToPatricia(proof chain.Proof, env chain.MessageEnvelope) (chain.Proof, error) {
	msgID, err := computeSolidityMsgID(env)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("IAVLToPatricia: compute msgId: %w", err)
	}

	// Parse the JSON blob stored by the tendermint plugin.
	var tmProof tendermintProofJSON
	if len(proof.ProofBytes) > 0 {
		if err := json.Unmarshal(proof.ProofBytes, &tmProof); err != nil {
			// Fall through — the proof may be raw bytes from a legacy format.
			// We treat the entire ProofBytes as a single op.
			tmProof.ProofOps = []hexutil.Bytes{proof.ProofBytes}
			tmProof.Value = proof.Value
		}
	}

	// Build leafKey from proof.KeyPath (zero-pad left to 32 bytes).
	var leafKey [32]byte
	if len(proof.KeyPath) > 0 {
		kb := proof.KeyPath
		if len(kb) > 32 {
			kb = kb[len(kb)-32:]
		}
		copy(leafKey[32-len(kb):], kb)
	}

	// Build leafValue from proof.Value or the parsed JSON value.
	var leafValue [32]byte
	rawValue := proof.Value
	if len(tmProof.Value) > 0 {
		rawValue = tmProof.Value
	}
	if len(rawValue) > 0 {
		vb := rawValue
		if len(vb) > 32 {
			vb = vb[len(vb)-32:]
		}
		copy(leafValue[32-len(vb):], vb)
	}

	// Build nodeHashes: Keccak256 of each raw ABCI proof op.
	nodeHashes := make([][32]byte, len(tmProof.ProofOps))
	for i, opData := range tmProof.ProofOps {
		nodeHashes[i] = crypto.Keccak256Hash(opData)
	}

	tessera := &TesseraProof{
		Flags:      FlagKeccak,
		MsgID:      msgID,
		LeafKey:    leafKey,
		LeafValue:  leafValue,
		NodeHashes: nodeHashes,
	}

	root := tessera.ComputeRoot()
	encoded := tessera.Encode()

	return chain.Proof{
		ChainID:     "sepolia",
		BlockNumber: proof.BlockNumber,
		StateRoot:   root[:],
		ProofBytes:  encoded,
		KeyPath:     leafKey[:],
		Value:       leafValue[:],
	}, nil
}

// computeSolidityMsgID computes keccak256(abi.encode(...)) matching the
// Solidity Verifier._envelopeHash function exactly.
//
// ABI-encode order: sourceChainId (bytes32), sourceApp (bytes), destChainId (bytes32),
// destApp (bytes), action (bytes4), payload (bytes), nonce (uint64).
func computeSolidityMsgID(env chain.MessageEnvelope) ([32]byte, error) {
	bytes32T, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return [32]byte{}, fmt.Errorf("computeSolidityMsgID abi.NewType bytes32: %w", err)
	}
	bytesT, err := abi.NewType("bytes", "", nil)
	if err != nil {
		return [32]byte{}, fmt.Errorf("computeSolidityMsgID abi.NewType bytes: %w", err)
	}
	bytes4T, err := abi.NewType("bytes4", "", nil)
	if err != nil {
		return [32]byte{}, fmt.Errorf("computeSolidityMsgID abi.NewType bytes4: %w", err)
	}
	uint64T, err := abi.NewType("uint64", "", nil)
	if err != nil {
		return [32]byte{}, fmt.Errorf("computeSolidityMsgID abi.NewType uint64: %w", err)
	}

	args := abi.Arguments{
		{Type: bytes32T}, // sourceChainId
		{Type: bytesT},   // sourceApp
		{Type: bytes32T}, // destChainId
		{Type: bytesT},   // destApp
		{Type: bytes4T},  // action
		{Type: bytesT},   // payload
		{Type: uint64T},  // nonce
	}

	srcChain := stringToBytes32(env.SourceChainID)
	dstChain := stringToBytes32(env.DestChainID)

	// Mirror the ethereum plugin's toEVMEnvelope normalisation of destApp:
	// for Sepolia destinations the contract expects 32-byte abi.encode(address),
	// so the relayer must use the same bytes here for the embedded msgID to
	// match the contract's keccak(abi.encode(stored envelope)). We can't
	// import the ethereum plugin from this package (it imports transform),
	// so the conversion is duplicated inline.
	encoded, err := args.Pack(
		srcChain,
		[]byte(env.SourceApp),
		dstChain,
		evmDestAppBytes(env.DestApp),
		env.Action,
		env.Payload,
		env.Nonce,
	)
	if err != nil {
		return [32]byte{}, fmt.Errorf("computeSolidityMsgID abi.Pack: %w", err)
	}
	return crypto.Keccak256Hash(encoded), nil
}

// stringToBytes32 left-aligns a string into a [32]byte (matches Solidity
// bytes32(abi.encodePacked("string"))). Strings longer than 32 bytes are truncated.
func stringToBytes32(s string) [32]byte {
	var b [32]byte
	n := len(s)
	if n > 32 {
		n = 32
	}
	copy(b[:n], s[:n])
	return b
}

// evmDestAppBytes mirrors ethereum.EVMDestAppBytes: when destApp is a 0x-prefixed
// 20-byte hex string (i.e. an EVM address) it returns the abi.encode(address)
// 32-byte left-padded form the Sepolia Verifier expects on storage. Anything
// else falls through to the raw UTF-8 bytes (used for bech32 destApps when
// the destination is Cosmos). Duplicated here because the transform package
// can't import plugins/ethereum (circular).
func evmDestAppBytes(destApp string) []byte {
	s := strings.TrimSpace(destApp)
	if (strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X")) && len(s) == 42 {
		if addr, err := hex.DecodeString(s[2:]); err == nil && len(addr) == 20 {
			out := make([]byte, 32)
			copy(out[12:], addr)
			return out
		}
	}
	return []byte(destApp)
}
