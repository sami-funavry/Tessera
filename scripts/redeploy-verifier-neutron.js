#!/usr/bin/env node
// Redeploy Verifier (and re-wire BridgeVault + BridgeMint) with new bond/registry.
// Usage: node scripts/redeploy-verifier-neutron.js
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

  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const n = addrs.neutron;

  // Upload + instantiate new verifier
  console.log('\n[verifier] Uploading...');
  const wasm = fs.readFileSync(path.join(WASM_DIR, 'verifier.wasm'));
  const upload = await client.upload(admin, wasm, 'auto', 'tessera verifier v2');
  console.log(`  codeId: ${upload.codeId}  txHash: ${upload.transactionHash}`);

  console.log('[verifier] Instantiating with new bond+registry...');
  const inst = await client.instantiate(admin, upload.codeId,
    { bond: n.bond, registry: n.relayer_registry }, 'verifier', 'auto', { admin });
  const newVerifier = inst.contractAddress;
  console.log(`  contractAddress: ${newVerifier}`);

  // Wire new verifier into bond and registry
  console.log('[bond] set_verifier...');
  await client.execute(admin, n.bond, { set_verifier: { verifier: newVerifier } }, 'auto');

  console.log('[registry] set_verifier...');
  await client.execute(admin, n.relayer_registry, { set_verifier: { verifier: newVerifier } }, 'auto');

  // Update bridge-vault and bridge-mint to use new verifier
  console.log('[bridge_vault] set_verifier...');
  try {
    await client.execute(admin, n.bridge_vault, { set_verifier: { verifier: newVerifier } }, 'auto');
    console.log('  bridge_vault verifier updated');
  } catch (err) {
    console.log('  bridge_vault has no set_verifier — redeploying...');
    const vaultWasm = fs.readFileSync(path.join(WASM_DIR, 'bridge_vault.wasm'));
    const vaultUpload = await client.upload(admin, vaultWasm, 'auto', 'tessera bridge-vault v2');
    const vaultInst = await client.instantiate(admin, vaultUpload.codeId,
      { verifier: newVerifier, tusdc: n.tusdc }, 'bridge-vault', 'auto', { admin });
    n.bridge_vault = vaultInst.contractAddress;
    console.log(`  new bridge_vault: ${n.bridge_vault}`);
  }

  console.log('[bridge_mint] set_verifier...');
  try {
    await client.execute(admin, n.bridge_mint, { set_verifier: { verifier: newVerifier } }, 'auto');
    console.log('  bridge_mint verifier updated');
  } catch (err) {
    console.log('  bridge_mint has no set_verifier — redeploying...');
    const mintWasm = fs.readFileSync(path.join(WASM_DIR, 'bridge_mint.wasm'));
    const mintUpload = await client.upload(admin, mintWasm, 'auto', 'tessera bridge-mint v2');
    const mintInst = await client.instantiate(admin, mintUpload.codeId,
      { verifier: newVerifier, tusdc: n.tusdc }, 'bridge-mint', 'auto', { admin });
    n.bridge_mint = mintInst.contractAddress;
    console.log(`  new bridge_mint: ${n.bridge_mint}`);
  }

  // Update tUSDC bridge_mint reference if bridge_mint changed
  console.log('[tusdc] set_bridge_mint...');
  try {
    await client.execute(admin, n.tusdc, { set_bridge_mint: { bridge_mint: n.bridge_mint } }, 'auto');
    console.log('  tusdc bridge_mint updated');
  } catch (err) {
    console.log('  tusdc set_bridge_mint failed (might be same addr):', err.message.slice(0, 80));
  }

  // Update addresses.json
  n.verifier = newVerifier;
  addrs.neutron = n;
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log('\n[done] addresses.json updated.');
  console.log('New verifier:', newVerifier);
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
