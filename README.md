# Tessera

Trust-minimized cross-chain infrastructure. Assets and messages move between EVM and Cosmos chains — no ZK prover, no trusted committee, no Ed25519 on EVM.

Built for the **ChainGPT Let's AI Hackathon** (May 7–9, 2026).

- **Live demo:** `<LIVE_URL>` (operator fills in once Vercel deploy lands)
- **Documentation:** [`docs/`](docs/) (in-app docs at `/docs`) · [Notion export](docs/notion-export.md)
- **Audit findings:** [`docs/audit-findings.md`](docs/audit-findings.md)

---

## Quick Start

Five steps from `git clone` to a working in-process scenario, no funds required:

```bash
# 1. Configure
cp .env.example .env   # then fill in RPC URLs, deployer/relayer keys, Supabase

# 2. Solidity contracts
cd contracts-evm && forge install && forge test

# 3. Go relayer
cd ../relayer && go build ./... && go test -short ./...

# 4. In-process honest scenario (no real funds)
go run ./cmd/tessera test-scenario mock

# 5. Frontend (separate terminal)
cd ../frontend && pnpm install && pnpm dev   # → http://localhost:3000
```

For the four real-testnet scenarios, see [`scripts/scenarios/0N-*.sh`](scripts/scenarios/) and the [Demo Scenarios doc](docs/05-demo-scenarios.mdx).

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

Click any address to open it on Etherscan.

| Contract | Address |
|----------|---------|
| tUSDC | [`0x7dcA…EC5B0`](https://sepolia.etherscan.io/address/0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0) |
| Bond | [`0x8c7d…7912`](https://sepolia.etherscan.io/address/0x8c7dc28559B75AF8c3d59B62C87309E65cb37912) |
| RelayerRegistry | [`0x4367…1109`](https://sepolia.etherscan.io/address/0x43677d5Da5701E061Eefa65e36A4fF6D4BFC1109) |
| Verifier | [`0x2EfA…F72a`](https://sepolia.etherscan.io/address/0x2EfAB8cC7ed7C11cfC23C215731aaFA2A602F72a) |
| BridgeVault | [`0x2C35…a29E`](https://sepolia.etherscan.io/address/0x2C3544434185DD65F058494816bB816e5314a29E) |
| BridgeMint | [`0x61ca…43cd`](https://sepolia.etherscan.io/address/0x61cab20856b16003b6a3FB213F86355515AD43cd) |

### Neutron (pion-1 testnet)

Click any address to open it on Celatone.

| Contract | Address |
|----------|---------|
| tUSDC | [`neutron1fw6…sck0vld`](https://neutron.celat.one/pion-1/contracts/neutron1fw6unz7a9j4zf9gnvhup5qe6dlftytdc0y0rwyn3lyxdazz22rtsck0vld) |
| Bond | [`neutron1nnz…seunvg8`](https://neutron.celat.one/pion-1/contracts/neutron1nnz9j6c3d25wnwj4h3jqkvazgawcmgjjk5unysvf6e0j90gavvsseunvg8) |
| RelayerRegistry | [`neutron1jq5…qfrya5k`](https://neutron.celat.one/pion-1/contracts/neutron1jq5kku3r0sxdkcxvkx7ke4dlcwq4my0m2gncrx4zf7g37hxtwj7qfrya5k) |
| Verifier | [`neutron1sda…qf002f0`](https://neutron.celat.one/pion-1/contracts/neutron1sda4ucdq06de7h7lxg66n6sq29ft9hk76a5mpjwehk3a8wfga0eqf002f0) |
| BridgeVault | [`neutron12z7…aq8j7dam`](https://neutron.celat.one/pion-1/contracts/neutron12z7xqgwgp6vsk5s96z4n6vjupqjg3zmvv5v068vvy3n69gshvhaq8j7dam) |
| BridgeMint | [`neutron18am…ksq8ltt7`](https://neutron.celat.one/pion-1/contracts/neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7) |

Machine-readable: [`scripts/addresses.json`](scripts/addresses.json)

---

## Running Tests

### Solidity (requires Foundry)

```bash
cd contracts-evm
forge test -vvv          # 88 tests
forge coverage           # ~91% line coverage
```

### CosmWasm (requires Rust + wasm32 target)

```bash
cd contracts-cosmwasm
cargo test --workspace   # full workspace incl. 4 demo scenarios
cargo clippy -- -D warnings
```

### Go Relayer

```bash
cd relayer
go test -race ./...      # includes 100x determinism tests on transform layer
```

---

## Running the Relayer

Requires `.env` populated. See `.env.example`. All runtime config is via env vars; copy `.env.example` to `.env` and fill in. To run a second relayer instance, set `RELAYER_PRIVATE_KEY` to the second key and rerun.

```bash
cd relayer

# Register and bond (first time only)
go run ./cmd/tessera bond register
go run ./cmd/tessera bond deposit --chain sepolia --amount 20000000000000000
go run ./cmd/tessera bond deposit --chain neutron --amount 80000

# Run the daemon
go run ./cmd/tessera relayer
```

---

## Demo Scenarios

These run as in-process simulations. For testnet runs, see `scripts/scenarios/0N-*.sh`.

```bash
go run ./cmd/tessera test-scenario 1   # S-1 honest delivery
go run ./cmd/tessera test-scenario 2   # S-2 fraud detected, 50% slashed
go run ./cmd/tessera test-scenario 3   # S-3 absence slashed, successor submits
go run ./cmd/tessera test-scenario 4   # S-4 baseless challenge, challenger slashed 25%
```

Each scenario reads on-chain rotation state at runtime — roles are not hardcoded. The matching shell scripts at `scripts/scenarios/` exercise the same flows against live testnets.

---

## Documentation

- **In-app docs** (this repo): [`docs/`](docs/) — 16 sections, MDX format with Mermaid diagrams (PM brief, Overview, Background & Comparison, Architecture, Economics, Demo scenarios, Repo structure, Developer guide, Protocol user guide, tUSDC bridge, Limitations, Future work, Technical decisions, **State & Database**, **Scripts & Tests**, **Cryptography Deep-Dive**)
- **Notion submission deliverable** (PM brief + Architecture + Technical decisions + Post-hackathon roadmap): [`docs/notion-export.md`](docs/notion-export.md) — copy/paste import to Notion
- **Audit findings** (Phase 10 gating doc): [`docs/audit-findings.md`](docs/audit-findings.md)
- **Reflection** (Form-2 deliverable): [`docs/reflection.md`](docs/reflection.md)
- **Post-hackathon roadmap** (Form-2 deliverable): [`docs/post-hackathon-roadmap.md`](docs/post-hackathon-roadmap.md)
- **SPEC.md**: full requirements + build plan (authoritative)
- **PROMPT_LOG.md**: per-prompt build history (hackathon deliverable)
- **Cost log**: [`docs/cost-log.md`](docs/cost-log.md) — per-phase spend, model discipline notes
- **Prompt-log highlights** (5 best + 3 worst): [`docs/prompt-log-highlights.md`](docs/prompt-log-highlights.md)

---

## Project Structure

```
contracts-evm/       Solidity contracts (Foundry)
contracts-cosmwasm/  Rust + CosmWasm contracts
relayer/             Go service (plugin-based)
frontend/            Next.js 14 app (live at <LIVE_URL>)
scripts/             Deploy + scenario scripts
docs/                In-app documentation (MDX)
supabase/            Schema migrations
```

---

## Relayer Status

Both relayers registered and bonded on both chains.

| Relayer | Sepolia address | Neutron address | Bond (testnet) |
|---------|----------------|-----------------|----------------|
| A | `0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37` | `neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9` | 0.02 ETH / 80,000 uNTRN |
| B | `0xdFac507Cee79D909af53EC89b981DD9C431264C2` | `neutron16cpjlg5x70ahp8wvvmrnjslzw3kqzvatmqp933` | 0.02 ETH / 80,000 uNTRN |

> Bond thresholds shown are testnet-tuned for faucet limits. Production deployments would use significantly higher thresholds — see [`docs/04-economics.mdx`](docs/04-economics.mdx) and [`docs/12-technical-decisions.mdx`](docs/12-technical-decisions.mdx).

---

## Built With

- Solidity 0.8.24 + Foundry
- Rust + CosmWasm 2.1.4 + cw-multi-test
- Go 1.22 + go-ethereum + cometbft
- Next.js 14 (App Router) — wagmi + viem + Keplr + Supabase realtime
- Supabase (state + realtime)
- Claude Code (Anthropic) — AI-assisted build, hackathon rules compliant
