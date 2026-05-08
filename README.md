# Tessera

Trust-minimized cross-chain infrastructure. Assets and messages move between EVM and Cosmos chains — no ZK prover, no trusted committee, no Ed25519 on EVM.

Built for the **ChainGPT Let's AI Hackathon** (May 7–9, 2026).

---

## Architecture at a Glance

```
Sepolia (EVM)               Go Relayer × 2             Neutron (CosmWasm)
─────────────────           ─────────────              ──────────────────
RelayerRegistry  ◀─ bond ─▶                   bond ─▶  RelayerRegistry
Bond                        EthereumPlugin              Bond
Verifier         ◀──────── submit / challenge ────────▶ Verifier
BridgeVault                 TendermintPlugin            BridgeVault
BridgeMint                  Transform layer             BridgeMint
tUSDC (ERC20)               Patricia ↔ IAVL            tUSDC (CW20)
```

Three things that make this different:

1. **Bonded economic enforcement** — relayers post bonds; fraud costs 50% of bond to the challenger who catches it.
2. **Native proof verification** — destination contracts verify proofs in their own Merkle format (Patricia on EVM, IAVL on Cosmos). No ZK prover.
3. **Ed25519 bypass** — Tendermint validator signatures are verified off-chain in Go; EVM never sees them.

---

## Deployed Contracts

### Sepolia (Ethereum testnet)

| Contract | Address |
|----------|---------|
| tUSDC | `0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0` |
| Bond | `0x8c7dc28559B75AF8c3d59B62C87309E65cb37912` |
| RelayerRegistry | `0x43677d5Da5701E061Eefa65e36A4fF6D4BFC1109` |
| Verifier | `0x2EfAB8cC7ed7C11cfC23C215731aaFA2A602F72a` |
| BridgeVault | `0x2C3544434185DD65F058494816bB816e5314a29E` |
| BridgeMint | `0x61cab20856b16003b6a3FB213F86355515AD43cd` |

### Neutron (pion-1 testnet)

| Contract | Address |
|----------|---------|
| tUSDC | `neutron16ket7npnkekn76nzhfjauwkwsea49rssp9fkn7fyxu35fwavfrxqxp5qnz` |
| Bond | `neutron1nnz9j6c3d25wnwj4h3jqkvazgawcmgjjk5unysvf6e0j90gavvsseunvg8` |
| RelayerRegistry | `neutron1jq5kku3r0sxdkcxvkx7ke4dlcwq4my0m2gncrx4zf7g37hxtwj7qfrya5k` |
| Verifier | `neutron1sda4ucdq06de7h7lxg66n6sq29ft9hk76a5mpjwehk3a8wfga0eqf002f0` |
| BridgeVault | `neutron12z7xqgwgp6vsk5s96z4n6vjupqjg3zmvv5v068vvy3n69gshvhaq8j7dam` |
| BridgeMint | `neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7` |

Machine-readable: [`scripts/addresses.json`](scripts/addresses.json)

---

## Running Tests

### Solidity (requires Foundry)

```bash
cd contracts-evm
forge test -vvv          # 77 tests
forge coverage           # 91% line coverage
```

### CosmWasm (requires Rust + wasm32 target)

```bash
cd contracts-cosmwasm
cargo test               # 28 tests
cargo clippy -- -D warnings
```

### Go Relayer

```bash
cd relayer
go test -race ./...      # includes 100x determinism tests on transform layer
```

---

## Running the Relayer

Requires `.env` populated. See `.env.example`.

```bash
cd relayer

# Register and bond (first time only)
go run ./cmd/relayer bond deposit  --config configs/relayer-a.yaml
go run ./cmd/relayer bond register --config configs/relayer-a.yaml

# Run
go run ./cmd/relayer relayer --config configs/relayer-a.yaml
```

---

## Demo Scenarios

Four scenarios demonstrate the complete economic enforcement model:

```bash
go run ./cmd/relayer test-scenario s1-honest    # honest delivery
go run ./cmd/relayer test-scenario s2-lying     # fraud detected, 50% slashed
go run ./cmd/relayer test-scenario s3-silent    # absence slashed, successor submits
go run ./cmd/relayer test-scenario s4-frivolous # baseless challenge, challenger slashed 25%
```

Each script reads on-chain rotation state at runtime — roles are not hardcoded.

---

## Documentation

- **In-app docs** (this repo): [`docs/`](docs/) — 11 sections, MDX format
- **Notion** (whitepaper depth): [link TBD — published at P-11 polish]
- **SPEC.md**: full requirements + build plan (authoritative)
- **PROMPT_LOG.md**: per-prompt build history (hackathon deliverable)

---

## Project Structure

```
contracts-evm/       Solidity contracts (Foundry)
contracts-cosmwasm/  Rust + CosmWasm contracts
relayer/             Go service (plugin-based)
frontend/            Next.js 14 app (P-9)
scripts/             Deploy + scenario scripts
docs/                In-app documentation (MDX)
supabase/            Schema migrations
```

---

## Relayer Status

Both relayers registered and bonded on both chains.

| Relayer | Sepolia address | Neutron address | Bond |
|---------|----------------|-----------------|------|
| A | `0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37` | `neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9` | 0.02 ETH / 80k uNTRN |
| B | `0xdFac507Cee79D909af53EC89b981DD9C431264C2` | `neutron16cpjlg5x70ahp8wvvmrnjslzw3kqzvatmqp933` | 0.02 ETH / 80k uNTRN |

---

## Built With

- Solidity 0.8.24 + Foundry
- Rust + CosmWasm 2.1.4 + cw-multi-test
- Go 1.22 + go-ethereum + cometbft
- Next.js 14 (App Router) — frontend in P-9
- Supabase (state + realtime)
- Claude Code (Anthropic) — AI-assisted build, hackathon rules compliant
