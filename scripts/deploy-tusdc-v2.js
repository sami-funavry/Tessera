#!/usr/bin/env node
// Deploy tUSDC v2 (with token_info query) to Neutron pion-1.
// Reads wasm from the cargo release build output.
// Updates scripts/addresses.json and prints the new address.
// Usage: node scripts/deploy-tusdc-v2.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

// Use the Docker-optimized wasm (no bulk-memory, compatible with Neutron pion-1).
const WASM_PATH = '/tmp/tusdc_optimized.wasm';
const ADDR_FILE = path.join(__dirname, 'addresses.json');
const ENV_FILE  = path.join(__dirname, '../.env');
const FE_ENV    = path.join(__dirname, '../frontend/.env.local');
const FE_CONFIG = path.join(__dirname, '../frontend/lib/config.ts');

async function main() {
  const rpc     = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  const bridgeMint = process.env.NEUTRON_MINT; // existing bridge_mint address
  if (!rpc || !privHex)    throw new Error('Missing NEUTRON_RPC_URL or NEUTRON_DEPLOYER_PRIVATE_KEY');
  if (!bridgeMint)         throw new Error('Missing NEUTRON_MINT in .env');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet    = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();
  console.log('Deployer:', admin);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  // 1 — Upload new wasm
  console.log('[tusdc-v2] Uploading wasm...');
  const wasm   = fs.readFileSync(WASM_PATH);
  const upload = await client.upload(admin, wasm, 'auto', 'tessera-tusdc-v2-token-info');
  console.log(`  codeId = ${upload.codeId}`);

  // 2 — Instantiate
  console.log('[tusdc-v2] Instantiating...');
  const inst    = await client.instantiate(admin, upload.codeId, { owner: admin }, 'tusdc-v2', 'auto', { admin });
  const newAddr = inst.contractAddress;
  console.log(`  address = ${newAddr}`);

  // 3 — Wire existing bridge_mint
  console.log('[tusdc-v2] Wiring bridge_mint:', bridgeMint);
  await client.execute(admin, newAddr, { set_bridge_mint: { bridge_mint: bridgeMint } }, 'auto');
  console.log('  done');

  // 4 — Smoke test: query token_info
  const info = await client.queryContractSmart(newAddr, { token_info: {} });
  console.log('[tusdc-v2] token_info response:', JSON.stringify(info));

  // 5 — Update addresses.json
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const oldAddr = addrs.neutron.tusdc;
  addrs.neutron.tusdc = newAddr;
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log(`\n[done] addresses.json updated`);
  console.log(`  old tUSDC: ${oldAddr}`);
  console.log(`  new tUSDC: ${newAddr}`);

  // 6 — Update .env
  let envContent = fs.readFileSync(ENV_FILE, 'utf8');
  envContent = envContent.replace(
    /^NEUTRON_TUSDC=.*$/m,
    `NEUTRON_TUSDC=${newAddr}`
  );
  fs.writeFileSync(ENV_FILE, envContent);
  console.log('  .env NEUTRON_TUSDC updated');

  // 7 — Update frontend/.env.local
  let feEnv = fs.readFileSync(FE_ENV, 'utf8');
  if (feEnv.includes('NEUTRON_TUSDC=')) {
    feEnv = feEnv.replace(/^NEUTRON_TUSDC=.*$/m, `NEUTRON_TUSDC=${newAddr}`);
  } else {
    feEnv += `\nNEUTRON_TUSDC=${newAddr}\n`;
  }
  fs.writeFileSync(FE_ENV, feEnv);
  console.log('  frontend/.env.local updated');

  // 8 — Update frontend/lib/config.ts
  let cfgContent = fs.readFileSync(FE_CONFIG, 'utf8');
  cfgContent = cfgContent.replace(
    /tusdc: 'neutron[a-z0-9]+'/,
    `tusdc: '${newAddr}'`
  );
  fs.writeFileSync(FE_CONFIG, cfgContent);
  console.log('  frontend/lib/config.ts updated');

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Fund user wallet:');
  console.log(`   node scripts/claim-tusdc-neutron-v2.js ${newAddr} <wallet>`);
  console.log('2. Fund relayer wallets (same script)');
  console.log('3. Restart frontend: pnpm --filter frontend dev');
  console.log(`\nNew tUSDC address: ${newAddr}`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
