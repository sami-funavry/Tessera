#!/usr/bin/env node
// Full Neutron redeploy: bond (INITIAL_BOND=600k) → verifier → registry → vault → mint → wire
// Usage: node scripts/redeploy-all-neutron.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM = p => path.join(__dirname, '../contracts-cosmwasm/target/wasm32-unknown-unknown/release', p);
const ADDR_FILE = path.join(__dirname, 'addresses.json');

async function upload(client, admin, file, label) {
  console.log(`  uploading ${label}...`);
  const r = await client.upload(admin, fs.readFileSync(WASM(file)), 'auto', label);
  console.log(`    codeId=${r.codeId}`);
  return r.codeId;
}

async function instantiate(client, admin, codeId, msg, label) {
  const r = await client.instantiate(admin, codeId, msg, label, 'auto', { admin });
  console.log(`  [${label}] ${r.contractAddress}`);
  return r.contractAddress;
}

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!rpc || !privHex) throw new Error('Missing NEUTRON_RPC_URL or NEUTRON_DEPLOYER_PRIVATE_KEY');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();
  console.log('Deployer:', admin);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const tusdc = addrs.neutron.tusdc; // reuse existing tUSDC

  // 1. Deploy bond (no set_verifier yet)
  console.log('\n=== bond ===');
  const bondCode = await upload(client, admin, 'bond.wasm', 'tessera-bond-v3');
  const bond = await instantiate(client, admin, bondCode, {}, 'bond');

  // 2. Deploy registry (bond addr known)
  console.log('\n=== relayer-registry ===');
  const regCode = await upload(client, admin, 'relayer_registry.wasm', 'tessera-registry-v3');
  const registry = await instantiate(client, admin, regCode, { bond }, 'relayer-registry');

  // 3. Deploy verifier (bond + registry known)
  console.log('\n=== verifier ===');
  const verCode = await upload(client, admin, 'verifier.wasm', 'tessera-verifier-v3');
  const verifier = await instantiate(client, admin, verCode, { bond, registry }, 'verifier');

  // 4. Deploy bridge-vault
  console.log('\n=== bridge-vault ===');
  const vaultCode = await upload(client, admin, 'bridge_vault.wasm', 'tessera-vault-v3');
  const bridge_vault = await instantiate(client, admin, vaultCode, { verifier, tusdc }, 'bridge-vault');

  // 5. Deploy bridge-mint
  console.log('\n=== bridge-mint ===');
  const mintCode = await upload(client, admin, 'bridge_mint.wasm', 'tessera-mint-v3');
  const bridge_mint = await instantiate(client, admin, mintCode, { verifier, tusdc }, 'bridge-mint');

  // 6. Wire: bond.set_verifier, registry.set_verifier, tusdc.set_bridge_mint
  console.log('\n=== wiring ===');
  console.log('  bond.set_verifier...');
  await client.execute(admin, bond, { set_verifier: { verifier } }, 'auto');

  console.log('  registry.set_verifier...');
  await client.execute(admin, registry, { set_verifier: { verifier } }, 'auto');

  console.log('  tusdc.set_bridge_mint...');
  await client.execute(admin, tusdc, { set_bridge_mint: { bridge_mint } }, 'auto');

  // 7. Update addresses.json
  addrs.neutron = { tusdc, bond, relayer_registry: registry, verifier, bridge_vault, bridge_mint };
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log('\n=== addresses.json updated ===');
  console.log(JSON.stringify(addrs.neutron, null, 2));
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
