// Package transform implements the TesseraProof wire format and deterministic
// proof transformation between Patricia (Keccak256) and IAVL (SHA-256) roots.
// Every function in this package is pure and deterministic: identical inputs
// always produce identical outputs (R-52), enabling challengers to replicate
// any transformation and detect fraud independently.
package transform

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/tessera-bridge/tessera/internal/chain"
)

// Magic is the 4-byte header that identifies a TesseraProof wire payload.
const Magic = "TSSP"

// FlagKeccak signals that the proof uses Keccak256 hashing (Sepolia verifier).
const FlagKeccak = uint32(0)

// FlagSHA256 signals that the proof uses SHA-256 hashing (Neutron verifier).
const FlagSHA256 = uint32(1)

// minWireSize is the minimum valid byte length of a serialised TesseraProof.
// Layout: 4 (magic) + 4 (flags) + 32 (msgId) + 32 (leafKey) + 32 (leafValue) + 4 (depth) = 108.
const minWireSize = 108

// TesseraProof is the canonical cross-chain proof representation exchanged
// between the relayer and the on-chain verifiers.
//
// Wire layout (big-endian):
//
//	[0:4]    magic = "TSSP"
//	[4:8]    flags uint32  — bit 0: 0=Keccak256, 1=SHA-256
//	[8:40]   msgId  [32]byte
//	[40:72]  leafKey [32]byte
//	[72:104] leafValue [32]byte
//	[104:108] depth uint32
//	[108 + i*32 : 140 + i*32]  nodeHashes[i], i in 0..depth-1
type TesseraProof struct {
	Flags      uint32
	MsgID      [32]byte
	LeafKey    [32]byte
	LeafValue  [32]byte
	NodeHashes [][32]byte
}

// Encode serialises the TesseraProof into its canonical wire format.
func (t *TesseraProof) Encode() []byte {
	depth := len(t.NodeHashes)
	size := minWireSize + depth*32
	buf := make([]byte, size)

	copy(buf[0:4], Magic)
	binary.BigEndian.PutUint32(buf[4:8], t.Flags)
	copy(buf[8:40], t.MsgID[:])
	copy(buf[40:72], t.LeafKey[:])
	copy(buf[72:104], t.LeafValue[:])
	binary.BigEndian.PutUint32(buf[104:108], uint32(depth))
	for i, nh := range t.NodeHashes {
		copy(buf[108+i*32:140+i*32], nh[:])
	}
	return buf
}

// Decode deserialises a TesseraProof from its canonical wire format.
// Returns an error if the data is too short, has the wrong magic, or
// the depth field is inconsistent with the remaining bytes.
func Decode(data []byte) (*TesseraProof, error) {
	if len(data) < minWireSize {
		return nil, fmt.Errorf("transform.Decode: too short (%d < %d)", len(data), minWireSize)
	}
	if string(data[0:4]) != Magic {
		return nil, fmt.Errorf("transform.Decode: bad magic %q", string(data[0:4]))
	}

	flags := binary.BigEndian.Uint32(data[4:8])
	depth := binary.BigEndian.Uint32(data[104:108])

	expected := minWireSize + int(depth)*32
	if len(data) < expected {
		return nil, fmt.Errorf("transform.Decode: depth=%d requires %d bytes, got %d",
			depth, expected, len(data))
	}

	tp := &TesseraProof{
		Flags:      flags,
		NodeHashes: make([][32]byte, depth),
	}
	copy(tp.MsgID[:], data[8:40])
	copy(tp.LeafKey[:], data[40:72])
	copy(tp.LeafValue[:], data[72:104])
	for i := uint32(0); i < depth; i++ {
		copy(tp.NodeHashes[i][:], data[108+i*32:140+i*32])
	}
	return tp, nil
}

// ComputeRoot computes the transformed Merkle root for this proof.
//
// Algorithm:
//
//	h = H(0x00 || msgId || leafKey || leafValue)       ← leaf hash
//	for i = 0..depth-1:
//	    h = H(0x01 || h || nodeHashes[i])               ← chain up
//
// Where H = SHA-256 if (flags & 1 == 1), Keccak256 otherwise.
func (t *TesseraProof) ComputeRoot() [32]byte {
	useSHA := (t.Flags & 1) == 1

	// Leaf hash: H(0x00 || msgId || leafKey || leafValue)
	leaf := make([]byte, 1+32+32+32)
	leaf[0] = 0x00
	copy(leaf[1:33], t.MsgID[:])
	copy(leaf[33:65], t.LeafKey[:])
	copy(leaf[65:97], t.LeafValue[:])
	h := hashWith(leaf, useSHA)

	// Chain up through node hashes.
	for _, nh := range t.NodeHashes {
		node := make([]byte, 1+32+32)
		node[0] = 0x01
		copy(node[1:33], h[:])
		copy(node[33:65], nh[:])
		h = hashWith(node, useSHA)
	}
	return h
}

// hashWith computes SHA-256 or Keccak256 of data based on the useSHA flag.
func hashWith(data []byte, useSHA256 bool) [32]byte {
	if useSHA256 {
		return sha256.Sum256(data)
	}
	return [32]byte(crypto.Keccak256Hash(data))
}

// Verify decodes proofBytes, checks the MsgID field matches expectedMsgID,
// recomputes the root, and returns true if it matches fingerprint.
// All three conditions must hold for the proof to be valid.
func Verify(proofBytes []byte, fingerprint [32]byte, expectedMsgID [32]byte) bool {
	tp, err := Decode(proofBytes)
	if err != nil {
		return false
	}
	if tp.MsgID != expectedMsgID {
		return false
	}
	computed := tp.ComputeRoot()
	return computed == fingerprint
}

// FingerprintHex returns the StateRoot of a proof as a lowercase hex string.
// This is the "transformed root" submitted to the destination verifier.
func FingerprintHex(proof chain.Proof) string {
	return hex.EncodeToString(proof.StateRoot)
}

// ErrEmptyProof is returned when a transform function receives a proof with
// no proof bytes and no fallback data.
var ErrEmptyProof = errors.New("transform: empty proof bytes")
