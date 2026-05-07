#!/usr/bin/env node
// scripts/deploy/neutron.js — Deploy all six Tessera CosmWasm contracts to Neutron pion-1
//
// Required env vars (from .env at repo root):
//   KEPLR_PRIVATE_KEY    Raw hex private key for NEUTRON_WALLET_ADDRESS (no 0x prefix)
//   NEUTRON_RPC_URL      e.g. https://rpc-falcron.pion-1.ntrn.tech
//
// Usage: node scripts/deploy/neutron.js
//
// Deploy order (each contract depends on those before it):
//   1. tusdc (owner = deployer)
//   2. bond  (no deps)
//   3. relayer-registry (bond addr)
//   4. verifier (bond, registry)
//   5. bridge-vault (verifier, tusdc)
//   6. bridge-mint (verifier, tusdc)
//   7. bond.set_verifier(verifier)
//   8. registry.set_verifier(verifier)
//   9. tusdc.set_bridge_mint(bridge-mint)

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
const { GasPrice } = require('@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '../../contracts-cosmwasm/target/wasm32-unknown-unknown/release');
const ADDR_FILE = path.join(__dirname, '../addresses.json');

const WASM_FILES = {
  tusdc:            'tusdc.wasm',
  bond:             'bond.wasm',
  relayer_registry: 'relayer_registry.wasm',
  verifier:         'verifier.wasm',
  bridge_vault:     'bridge_vault.wasm',
  bridge_mint:      'bridge_mint.wasm',
};

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  if (!rpc) throw new Error('NEUTRON_RPC_URL not set');

  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!privHex) throw new Error('NEUTRON_DEPLOYER_PRIVATE_KEY not set');

  const privBytes = Uint8Array.from(Buffer.from(privHex, 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();

  console.log('[neutron] Deployer:', admin);
  console.log('[neutron] RPC:', rpc);

  const client = await SigningCosmWasmClient.connectWithSigner(
    rpc,
    wallet,
    { gasPrice: GasPrice.fromString('0.025untrn') }
  );

  const balance = await client.getBalance(admin, 'untrn');
  console.log('[neutron] Balance:', balance.amount, 'untrn');

  // ── helper ────────────────────────────────────────────────────────────────
  async function storeAndInstantiate(label, wasmName, initMsg) {
    console.log(`\n[neutron] Uploading ${label}...`);
    const wasmPath = path.join(WASM_DIR, wasmName);
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`wasm not found: ${wasmPath} — run: cd contracts-cosmwasm && RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown`);
    }
    const wasm = fs.readFileSync(wasmPath);
    const upload = await client.upload(admin, wasm, 'auto', `tessera ${label}`);
    console.log(`  codeId: ${upload.codeId}  txHash: ${upload.transactionHash}`);

    console.log(`[neutron] Instantiating ${label}...`);
    const inst = await client.instantiate(admin, upload.codeId, initMsg, label, 'auto', { admin });
    console.log(`  contractAddress: ${inst.contractAddress}  txHash: ${inst.transactionHash}`);
    return inst.contractAddress;
  }

  // ── deploy in dependency order ─────────────────────────────────────────
  const tusdc    = await storeAndInstantiate('tusdc',            WASM_FILES.tusdc,            { owner: admin });
  const bond     = await storeAndInstantiate('bond',             WASM_FILES.bond,             {});
  const registry = await storeAndInstantiate('relayer-registry', WASM_FILES.relayer_registry, { bond });
  const verifier = await storeAndInstantiate('verifier',         WASM_FILES.verifier,         { bond, registry });
  const vault    = await storeAndInstantiate('bridge-vault',     WASM_FILES.bridge_vault,     { verifier, tusdc });
  const mint     = await storeAndInstantiate('bridge-mint',      WASM_FILES.bridge_mint,      { verifier, tusdc });

  // ── wire inter-contract references ────────────────────────────────────
  console.log('\n[neutron] Wiring: bond.set_verifier...');
  await client.execute(admin, bond, { set_verifier: { verifier } }, 'auto');

  console.log('[neutron] Wiring: registry.set_verifier...');
  await client.execute(admin, registry, { set_verifier: { verifier } }, 'auto');

  console.log('[neutron] Wiring: tusdc.set_bridge_mint...');
  await client.execute(admin, tusdc, { set_bridge_mint: { bridge_mint: mint } }, 'auto');

  // ── print summary ─────────────────────────────────────────────────────
  const addresses = { tusdc, bond, relayer_registry: registry, verifier, bridge_vault: vault, bridge_mint: mint };

  console.log('\n[neutron] Deployed addresses:');
  Object.entries(addresses).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // ── update addresses.json ─────────────────────────────────────────────
  let data = { sepolia: {}, neutron: {} };
  if (fs.existsSync(ADDR_FILE)) {
    data = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  }
  data.neutron = addresses;
  fs.writeFileSync(ADDR_FILE, JSON.stringify(data, null, 2));
  console.log('\n[neutron] addresses.json updated.');

  // ── smoke test: call tusdc.claim() ────────────────────────────────────
  console.log('\n[neutron] Smoke test: claiming tUSDC...');
  const claimResult = await client.execute(admin, tusdc, { claim: {} }, 'auto');
  console.log('  claim txHash:', claimResult.transactionHash);
  const tBalance = await client.queryContractSmart(tusdc, { balance: { addr: admin } });
  console.log('  tUSDC balance after claim:', tBalance.toString());

  console.log('\n[neutron] All done.');
}

main().catch(err => {
  console.error('[neutron] FATAL:', err.message || err);
  process.exit(1);
});
