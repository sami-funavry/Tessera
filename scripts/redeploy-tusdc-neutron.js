#!/usr/bin/env node
// Redeploy tUSDC on Neutron wired to new bridge_mint, update addresses.json.
// Usage: node scripts/redeploy-tusdc-neutron.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '../contracts-cosmwasm/target/wasm32-unknown-unknown/release');
const ADDR_FILE = path.join(__dirname, 'addresses.json');

// Addresses from complete-neutron-deploy.js output
const NEW_BRIDGE_MINT = 'neutron1h9d9emajnm8mq4uv3ftm4cpzrzp279320fn02r762achwuf7lq7qjmq7vh';

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

  // Upload tUSDC
  console.log('[tusdc] Uploading...');
  const wasm = fs.readFileSync(path.join(WASM_DIR, 'tusdc.wasm'));
  const upload = await client.upload(admin, wasm, 'auto', 'tessera-tusdc-v2');
  console.log(`  codeId=${upload.codeId}`);

  // Instantiate
  console.log('[tusdc] Instantiating...');
  const inst = await client.instantiate(admin, upload.codeId, { owner: admin }, 'tusdc', 'auto', { admin });
  const tusdc = inst.contractAddress;
  console.log('  tusdc:', tusdc);

  // Wire bridge_mint
  console.log('[tusdc] set_bridge_mint...');
  await client.execute(admin, tusdc, { set_bridge_mint: { bridge_mint: NEW_BRIDGE_MINT } }, 'auto');
  console.log('  done');

  // Update addresses.json
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  addrs.neutron.tusdc = tusdc;
  // Also update bridge_vault and bridge_mint's tusdc reference — but those use tusdc from instantiation.
  // For now, update the recorded addresses and note that vault/mint were deployed with old tusdc addr.
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log('\n[done] addresses.json updated');
  console.log('New tUSDC:', tusdc);
  console.log('Existing bridge_vault/bridge_mint were deployed with OLD tUSDC — need redeploy if mint/release needed');
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
