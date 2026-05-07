#!/usr/bin/env node
// Full Neutron v4 deploy: upload new bond (80k threshold), reuse existing code IDs for all others.
// Deploys all 6 contracts fresh and wires them consistently.
// Usage: node scripts/deploy-neutron-v4.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '../contracts-cosmwasm/artifacts');
const ADDR_FILE = path.join(__dirname, 'addresses.json');

// Existing code IDs (already on-chain — no upload needed)
const REGISTRY_CODE  = 14004;
const VERIFIER_CODE  = 14005;
const VAULT_CODE     = 14006;
const MINT_CODE      = 14007;
const TUSDC_CODE     = 13994;

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

  const bal = await client.getBalance(admin, 'untrn');
  console.log('Balance:', bal.amount, 'untrn');

  // 1. Upload new bond.wasm (80k threshold)
  console.log('\n[bond] Uploading new bond wasm (80k threshold)...');
  const bondWasm = fs.readFileSync(path.join(WASM_DIR, 'bond.wasm'));
  const bondUpload = await client.upload(admin, bondWasm, 'auto', 'tessera-bond-v4');
  const bondCodeId = bondUpload.codeId;
  console.log('  codeId:', bondCodeId);

  // 2. Instantiate bond
  console.log('[bond] Instantiating...');
  const bondInst = await client.instantiate(admin, bondCodeId, {}, 'bond', 'auto', { admin });
  const bond = bondInst.contractAddress;
  console.log('  bond:', bond);

  // 3. Instantiate tUSDC
  console.log('\n[tusdc] Instantiating from codeId', TUSDC_CODE, '...');
  const tusdcInst = await client.instantiate(admin, TUSDC_CODE, { owner: admin }, 'tusdc', 'auto', { admin });
  const tusdc = tusdcInst.contractAddress;
  console.log('  tusdc:', tusdc);

  // 4. Instantiate registry
  console.log('\n[registry] Instantiating from codeId', REGISTRY_CODE, '...');
  const regInst = await client.instantiate(admin, REGISTRY_CODE, { bond }, 'relayer-registry', 'auto', { admin });
  const relayer_registry = regInst.contractAddress;
  console.log('  registry:', relayer_registry);

  // 5. Instantiate verifier
  console.log('\n[verifier] Instantiating from codeId', VERIFIER_CODE, '...');
  const verInst = await client.instantiate(admin, VERIFIER_CODE,
    { bond, registry: relayer_registry }, 'verifier', 'auto', { admin });
  const verifier = verInst.contractAddress;
  console.log('  verifier:', verifier);

  // 6. Instantiate bridge-vault
  console.log('\n[bridge-vault] Instantiating from codeId', VAULT_CODE, '...');
  const vaultInst = await client.instantiate(admin, VAULT_CODE,
    { verifier, tusdc }, 'bridge-vault', 'auto', { admin });
  const bridge_vault = vaultInst.contractAddress;
  console.log('  bridge_vault:', bridge_vault);

  // 7. Instantiate bridge-mint
  console.log('\n[bridge-mint] Instantiating from codeId', MINT_CODE, '...');
  const mintInst = await client.instantiate(admin, MINT_CODE,
    { verifier, tusdc }, 'bridge-mint', 'auto', { admin });
  const bridge_mint = mintInst.contractAddress;
  console.log('  bridge_mint:', bridge_mint);

  // 8. Wire: bond.set_verifier
  console.log('\n[bond] set_verifier...');
  await client.execute(admin, bond, { set_verifier: { verifier } }, 'auto');
  console.log('  done');

  // 9. Wire: registry.set_verifier
  console.log('[registry] set_verifier...');
  await client.execute(admin, relayer_registry, { set_verifier: { verifier } }, 'auto');
  console.log('  done');

  // 10. Wire: tusdc.set_bridge_mint
  console.log('[tusdc] set_bridge_mint...');
  await client.execute(admin, tusdc, { set_bridge_mint: { bridge_mint } }, 'auto');
  console.log('  done');

  // 11. Update addresses.json
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  addrs.neutron = { tusdc, bond, relayer_registry, verifier, bridge_vault, bridge_mint };
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));

  console.log('\n=== v4 deploy complete. Final addresses ===');
  console.log(JSON.stringify(addrs.neutron, null, 2));
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
