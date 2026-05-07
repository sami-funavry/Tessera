#!/usr/bin/env node
// Redeploy only the Bond contract on Neutron, then re-wire registry and verifier.
// Usage: node scripts/redeploy-bond-neutron.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '../contracts-cosmwasm/target/wasm32-unknown-unknown/release');
const ADDR_FILE = path.join(__dirname, 'addresses.json');

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!rpc || !privHex) throw new Error('Missing env vars');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();
  console.log('Deployer:', admin);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  // Read current addresses
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const neutron = addrs.neutron;

  // Upload + instantiate new bond contract
  console.log('\n[bond] Uploading new bond wasm...');
  const wasm = fs.readFileSync(path.join(WASM_DIR, 'bond.wasm'));
  const upload = await client.upload(admin, wasm, 'auto', 'tessera bond v2');
  console.log(`  codeId: ${upload.codeId}  txHash: ${upload.transactionHash}`);

  console.log('[bond] Instantiating...');
  const inst = await client.instantiate(admin, upload.codeId, {}, 'bond', 'auto', { admin });
  const newBond = inst.contractAddress;
  console.log(`  contractAddress: ${newBond}  txHash: ${inst.transactionHash}`);

  // Wire verifier into new bond
  console.log('[bond] Setting verifier...');
  await client.execute(admin, newBond, { set_verifier: { verifier: neutron.verifier } }, 'auto');
  console.log('  verifier wired');

  // Update registry to point to new bond (if registry has set_bond)
  // Registry stores bond address from instantiation — need to redeploy or use set_bond if available.
  // Try set_bond first, fall back to noting it needs redeploy.
  console.log('[registry] Updating bond reference...');
  try {
    await client.execute(admin, neutron.relayer_registry, { set_bond: { bond: newBond } }, 'auto');
    console.log('  registry bond updated via set_bond');
  } catch (err) {
    console.log('  set_bond not available — redeploying registry with new bond addr...');
    const regWasm = fs.readFileSync(path.join(WASM_DIR, 'relayer_registry.wasm'));
    const regUpload = await client.upload(admin, regWasm, 'auto', 'tessera relayer-registry v2');
    const regInst = await client.instantiate(admin, regUpload.codeId, { bond: newBond }, 'relayer-registry', 'auto', { admin });
    const newRegistry = regInst.contractAddress;
    console.log(`  new registry: ${newRegistry}`);
    await client.execute(admin, newRegistry, { set_verifier: { verifier: neutron.verifier } }, 'auto');
    neutron.relayer_registry = newRegistry;
  }

  // Update addresses.json
  neutron.bond = newBond;
  addrs.neutron = neutron;
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log('\n[bond] addresses.json updated.');
  console.log('New bond address:', newBond);
  console.log('Registry address:', neutron.relayer_registry);
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
