// Package cosmwasm provides a minimal CosmWasm transaction client for Neutron.
// It encodes MsgExecuteContract transactions manually using protowire (no cosmos-sdk dep)
// and broadcasts them to the Neutron REST endpoint.
package cosmwasm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	btcecdsa "github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // Cosmos uses RIPEMD-160 by spec
	"google.golang.org/protobuf/encoding/protowire"
)

// Client is a minimal Neutron REST client capable of signing and broadcasting
// CosmWasm execute contract transactions.
type Client struct {
	restURL    string
	chainID    string
	privKey    *btcec.PrivateKey
	address    string // bech32 neutron1... address
	httpClient *http.Client
}

// New creates a CosmWasm client from a hex-encoded secp256k1 private key.
// privKeyHex must be 64 hex chars (32 bytes), no 0x prefix.
func New(restURL, chainID, privKeyHex string) (*Client, error) {
	privBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return nil, fmt.Errorf("cosmwasm: decode private key: %w", err)
	}
	privKey, pubKey := btcec.PrivKeyFromBytes(privBytes)
	addr, err := cosmosAddress(pubKey.SerializeCompressed(), "neutron")
	if err != nil {
		return nil, fmt.Errorf("cosmwasm: derive address: %w", err)
	}
	slog.Info("cosmwasm client ready", "address", addr, "chain", chainID)
	return &Client{
		restURL:    restURL,
		chainID:    chainID,
		privKey:    privKey,
		address:    addr,
		httpClient: &http.Client{},
	}, nil
}

// Address returns the bech32 address for this key.
func (c *Client) Address() string { return c.address }

// PubKeyBytes returns the 33-byte compressed secp256k1 public key.
func (c *Client) PubKeyBytes() []byte {
	return c.privKey.PubKey().SerializeCompressed()
}

// Execute broadcasts a CosmWasm ExecuteContract message to contractAddr with msgJSON as the payload.
// It handles account sequence retrieval, signing, and broadcasting automatically.
// Returns the transaction hash on success.
func (c *Client) Execute(ctx context.Context, contractAddr string, msgJSON []byte, gasLimit uint64) (string, error) {
	// 1. Query account info (sequence + account number).
	acctNum, seq, err := c.accountInfo(ctx)
	if err != nil {
		return "", fmt.Errorf("cosmwasm execute: account info: %w", err)
	}
	slog.Debug("cosmwasm execute: account info retrieved",
		"contract", contractAddr, "account_number", acctNum, "sequence", seq)

	// 2. Encode MsgExecuteContract.
	msgBytes := encodeMsgExecuteContract(c.address, contractAddr, msgJSON)

	// 3. Encode TxBody (single message).
	bodyBytes := encodeTxBody(msgBytes)

	// 4. Encode AuthInfo (secp256k1 pubkey, fee).
	pubKeyAny := encodeAny(
		"/cosmos.crypto.secp256k1.PubKey",
		encodeSecp256k1PubKey(c.privKey.PubKey().SerializeCompressed()),
	)
	authInfoBytes := encodeAuthInfo(pubKeyAny, seq, gasLimit)

	// 5. Sign using SIGN_MODE_DIRECT (sha256(SignDoc)).
	signDocBytes := encodeSignDoc(bodyBytes, authInfoBytes, c.chainID, acctNum, seq)
	hash := sha256.Sum256(signDocBytes)
	sig := btcecdsa.Sign(c.privKey, hash[:])
	sigBytes := compactSig(sig)

	// 6. Build TxRaw and broadcast.
	txRaw := encodeTxRaw(bodyBytes, authInfoBytes, sigBytes)
	return c.broadcast(ctx, txRaw)
}

// BankSend broadcasts a cosmos.bank.v1beta1.MsgSend from this client's address to toAddr.
// amount is in uNTRN (or the specified denom).
func (c *Client) BankSend(ctx context.Context, toAddr, denom string, amount uint64) (string, error) {
	acctNum, seq, err := c.accountInfo(ctx)
	if err != nil {
		return "", fmt.Errorf("BankSend: account info: %w", err)
	}

	msgBytes := encodeMsgSend(c.address, toAddr, denom, amount)

	var bodyBytes []byte
	anyBytes := encodeAny("/cosmos.bank.v1beta1.MsgSend", msgBytes)
	bodyBytes = appendField(bodyBytes, 1, anyBytes)

	pubKeyAny := encodeAny(
		"/cosmos.crypto.secp256k1.PubKey",
		encodeSecp256k1PubKey(c.privKey.PubKey().SerializeCompressed()),
	)
	const gasLimit = 80_000
	authInfoBytes := encodeAuthInfo(pubKeyAny, seq, gasLimit)

	signDocBytes := encodeSignDoc(bodyBytes, authInfoBytes, c.chainID, acctNum, seq)
	hash := sha256.Sum256(signDocBytes)
	sig := btcecdsa.Sign(c.privKey, hash[:])
	sigBytes := compactSig(sig)

	txRaw := encodeTxRaw(bodyBytes, authInfoBytes, sigBytes)
	txHash, err := c.broadcast(ctx, txRaw)
	if err != nil {
		return "", fmt.Errorf("BankSend: %w", err)
	}
	slog.Info("BankSend success", "to", toAddr, "amount", amount, "denom", denom, "txhash", txHash)
	return txHash, nil
}

// encodeMsgSend encodes a cosmos.bank.v1beta1.MsgSend.
func encodeMsgSend(fromAddr, toAddr, denom string, amount uint64) []byte {
	var coin []byte
	coin = appendField(coin, 1, []byte(denom))
	coin = appendField(coin, 2, []byte(fmt.Sprintf("%d", amount)))
	var b []byte
	b = appendField(b, 1, []byte(fromAddr))
	b = appendField(b, 2, []byte(toAddr))
	b = appendField(b, 3, coin)
	return b
}

// ─── Protobuf helpers ────────────────────────────────────────────────────────

// appendField appends a length-delimited (bytes/string) field.
func appendField(b []byte, fieldNum uint32, data []byte) []byte {
	b = protowire.AppendTag(b, protowire.Number(fieldNum), protowire.BytesType)
	b = protowire.AppendBytes(b, data)
	return b
}

// appendVarintField appends a varint field.
func appendVarintField(b []byte, fieldNum uint32, v uint64) []byte {
	b = protowire.AppendTag(b, protowire.Number(fieldNum), protowire.VarintType)
	b = protowire.AppendVarint(b, v)
	return b
}

// encodeMsgExecuteContract encodes a cosmwasm.wasm.v1.MsgExecuteContract.
// field 1: sender (string), field 2: contract (string), field 3: msg (bytes).
func encodeMsgExecuteContract(sender, contract string, msg []byte) []byte {
	var b []byte
	b = appendField(b, 1, []byte(sender))
	b = appendField(b, 2, []byte(contract))
	b = appendField(b, 3, msg)
	return b
}

// encodeAny encodes a google.protobuf.Any{type_url, value}.
func encodeAny(typeURL string, value []byte) []byte {
	var b []byte
	b = appendField(b, 1, []byte(typeURL))
	b = appendField(b, 2, value)
	return b
}

// encodeTxBody encodes a cosmos.tx.v1beta1.TxBody with a single Any message.
func encodeTxBody(msgBytes []byte) []byte {
	anyBytes := encodeAny("/cosmwasm.wasm.v1.MsgExecuteContract", msgBytes)
	var b []byte
	b = appendField(b, 1, anyBytes) // messages field
	return b
}

// encodeSecp256k1PubKey encodes a cosmos.crypto.secp256k1.PubKey.
func encodeSecp256k1PubKey(compressedKey []byte) []byte {
	var b []byte
	b = appendField(b, 1, compressedKey)
	return b
}

// encodeModeInfoSingle encodes ModeInfo{Single{SIGN_MODE_DIRECT}}.
func encodeModeInfoSingle() []byte {
	// Single{mode: 1 (SIGN_MODE_DIRECT)}
	var single []byte
	single = appendVarintField(single, 1, 1)
	var b []byte
	b = appendField(b, 1, single) // oneof sum: single
	return b
}

// encodeSignerInfo encodes a SignerInfo.
func encodeSignerInfo(pubKeyAny []byte, seq uint64) []byte {
	var b []byte
	b = appendField(b, 1, pubKeyAny)
	b = appendField(b, 2, encodeModeInfoSingle())
	b = appendVarintField(b, 3, seq)
	return b
}

// encodeFee encodes a Fee with untrn gas price and gas_limit.
func encodeFee(gasLimit uint64) []byte {
	// Gas price: typically 0.01 untrn/gas on Neutron pion-1.
	gasPrice := gasLimit / 100
	if gasPrice < 1 {
		gasPrice = 1
	}
	// Coin{denom: "untrn", amount: "N"}
	var coin []byte
	coin = appendField(coin, 1, []byte("untrn"))
	coin = appendField(coin, 2, []byte(fmt.Sprintf("%d", gasPrice)))
	var b []byte
	b = appendField(b, 1, coin)
	b = appendVarintField(b, 2, gasLimit)
	return b
}

// encodeAuthInfo encodes AuthInfo with one signer and a fee.
func encodeAuthInfo(pubKeyAny []byte, seq, gasLimit uint64) []byte {
	var b []byte
	b = appendField(b, 1, encodeSignerInfo(pubKeyAny, seq))
	b = appendField(b, 2, encodeFee(gasLimit))
	return b
}

// encodeSignDoc encodes a SignDoc for SIGN_MODE_DIRECT.
func encodeSignDoc(bodyBytes, authInfoBytes []byte, chainID string, accountNumber, sequence uint64) []byte {
	var b []byte
	b = appendField(b, 1, bodyBytes)
	b = appendField(b, 2, authInfoBytes)
	b = appendField(b, 3, []byte(chainID))
	b = appendVarintField(b, 4, accountNumber)
	b = appendVarintField(b, 5, sequence)
	return b
}

// encodeTxRaw encodes a TxRaw (the broadcast format).
func encodeTxRaw(bodyBytes, authInfoBytes, sigBytes []byte) []byte {
	var b []byte
	b = appendField(b, 1, bodyBytes)
	b = appendField(b, 2, authInfoBytes)
	b = appendField(b, 3, sigBytes)
	return b
}

// compactSig converts a btcec ECDSA signature to 64-byte (R||S) compact form.
// Cosmos uses raw 64-byte compact signatures, not DER encoding.
// Uses R() and S() scalar accessors to avoid DER parsing edge-cases.
func compactSig(sig *btcecdsa.Signature) []byte {
	r := sig.R()
	s := sig.S()
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	out := make([]byte, 64)
	copy(out[:32], rBytes[:])
	copy(out[32:], sBytes[:])
	return out
}

// ─── REST helpers ────────────────────────────────────────────────────────────

// accountInfo queries the Neutron REST endpoint for the signer's account number and sequence.
//
// Public Cosmos REST endpoints (Polkachu, Allnodes, etc.) periodically return
// 5xx — Polkachu's pion-1 REST returned a solid 502 for ~30 minutes during
// P-10.7g — so we retry with exponential backoff on transient gateway / DNS
// failures. The relayer's submitter goroutine drops events on error, so a
// single-shot failure here costs us a whole bridge.
func (c *Client) accountInfo(ctx context.Context) (accountNumber, sequence uint64, err error) {
	const maxAttempts = 5
	url := fmt.Sprintf("%s/cosmos/auth/v1beta1/accounts/%s", c.restURL, c.address)

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if reqErr != nil {
			return 0, 0, reqErr
		}
		resp, doErr := c.httpClient.Do(req)
		if doErr != nil {
			lastErr = fmt.Errorf("account info GET: %w", doErr)
		} else {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				lastErr = readErr
			} else if resp.StatusCode == http.StatusOK {
				var result struct {
					Account struct {
						AccountNumber string `json:"account_number"`
						Sequence      string `json:"sequence"`
					} `json:"account"`
				}
				if uErr := json.Unmarshal(body, &result); uErr != nil {
					return 0, 0, fmt.Errorf("account info parse: %w", uErr)
				}
				fmt.Sscanf(result.Account.AccountNumber, "%d", &accountNumber)
				fmt.Sscanf(result.Account.Sequence, "%d", &sequence)
				return accountNumber, sequence, nil
			} else if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
				// Retryable upstream failure.
				lastErr = fmt.Errorf("account info: status %d: %s", resp.StatusCode, body)
			} else {
				// 4xx other than 429 — not retryable, return now.
				return 0, 0, fmt.Errorf("account info: status %d: %s", resp.StatusCode, body)
			}
		}

		if attempt < maxAttempts {
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second // 1s, 2s, 4s, 8s
			slog.Warn("cosmwasm accountInfo: retrying after upstream error",
				"attempt", attempt, "backoff_sec", backoff.Seconds(), "err", lastErr)
			select {
			case <-ctx.Done():
				return 0, 0, ctx.Err()
			case <-time.After(backoff):
			}
		}
	}
	return 0, 0, fmt.Errorf("account info: %d attempts exhausted: %w", maxAttempts, lastErr)
}

// broadcast sends TxRaw bytes to the Neutron broadcast endpoint.
// Returns the transaction hash.
func (c *Client) broadcast(ctx context.Context, txRawBytes []byte) (string, error) {
	payload := map[string]any{
		"tx_bytes": base64.StdEncoding.EncodeToString(txRawBytes),
		"mode":     "BROADCAST_MODE_SYNC",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	url := c.restURL + "/cosmos/tx/v1beta1/txs"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("broadcast: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("broadcast: status %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		TxResponse struct {
			TxHash string `json:"txhash"`
			Code   uint32 `json:"code"`
			RawLog string `json:"raw_log"`
		} `json:"tx_response"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("broadcast parse: %w", err)
	}
	if result.TxResponse.Code != 0 {
		return "", fmt.Errorf("broadcast: chain error code=%d log=%s",
			result.TxResponse.Code, result.TxResponse.RawLog)
	}
	slog.Info("cosmwasm broadcast success", "txhash", result.TxResponse.TxHash)
	return result.TxResponse.TxHash, nil
}

// ─── Address derivation ────────────────────────────────────────────────────

// cosmosAddress derives a bech32 address from a compressed secp256k1 public key.
// Algorithm: bech32(prefix, convertbits(ripemd160(sha256(pubkey)), 8→5)).
// Returns an error instead of panicking so callers can propagate it cleanly.
func cosmosAddress(compressedPubKey []byte, prefix string) (string, error) {
	sha := sha256.Sum256(compressedPubKey)
	h := ripemd160.New()
	h.Write(sha[:])
	addrBytes := h.Sum(nil) // 20 bytes
	converted, err := convertBits(addrBytes, 8, 5, true)
	if err != nil {
		return "", fmt.Errorf("cosmosAddress convertBits: %w", err)
	}
	encoded, err := bech32Encode(prefix, converted)
	if err != nil {
		return "", fmt.Errorf("cosmosAddress bech32Encode: %w", err)
	}
	return encoded, nil
}

// ─── Minimal bech32 ─────────────────────────────────────────────────────────

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

func bech32Encode(hrp string, data []byte) (string, error) {
	chk := bech32Checksum(hrp, data)
	combined := append(data, chk...)
	var out []byte
	out = append(out, []byte(hrp)...)
	out = append(out, '1')
	for _, b := range combined {
		if b >= 32 {
			return "", fmt.Errorf("invalid data byte %d", b)
		}
		out = append(out, bech32Charset[b])
	}
	return string(out), nil
}

func bech32Polymod(values []byte) uint32 {
	gen := []uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (top>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func bech32HRPExpand(hrp string) []byte {
	out := make([]byte, len(hrp)*2+1)
	for i, c := range hrp {
		out[i] = byte(c) >> 5
		out[i+len(hrp)+1] = byte(c) & 31
	}
	out[len(hrp)] = 0
	return out
}

func bech32Checksum(hrp string, data []byte) []byte {
	values := append(bech32HRPExpand(hrp), data...)
	values = append(values, []byte{0, 0, 0, 0, 0, 0}...)
	poly := bech32Polymod(values) ^ 1
	ret := make([]byte, 6)
	for i := range ret {
		ret[i] = byte((poly >> uint(5*(5-i))) & 31)
	}
	return ret
}

// convertBits re-encodes a byte slice from fromBits bits per byte to toBits bits per byte.
func convertBits(data []byte, fromBits, toBits uint, pad bool) ([]byte, error) {
	acc, bits := 0, uint(0)
	var ret []byte
	maxv := (1 << toBits) - 1
	for _, b := range data {
		acc = (acc << fromBits) | int(b)
		bits += fromBits
		for bits >= toBits {
			bits -= toBits
			ret = append(ret, byte((acc>>bits)&maxv))
		}
	}
	if pad && bits > 0 {
		ret = append(ret, byte((acc<<(toBits-bits))&maxv))
	} else if bits >= fromBits || ((acc<<(toBits-bits))&maxv) != 0 {
		return nil, fmt.Errorf("convertBits: invalid padding")
	}
	return ret, nil
}
