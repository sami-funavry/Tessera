#!/usr/bin/env node
// Complete the partial Neutron deployment using Relayer B funds to refill deployer.
// Resumes where redeploy-all-neutron.js left off (bond+registry+verifier already deployed).
// Usage: node scripts/complete-neutron-deploy.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const { coin } = require('./deploy/node_modules/@cosmjs/amino');
const { fromHex } = require('./deploy/node_modules/@cosmjs/encoding');
const fs = require('fs');
const path = require('path');

const WASM = p => path.join(__dirname, '../contracts-cosmwasm/target/wasm32-unknown-unknown/release', p);
const ADDR_FILE = path.join(__dirname, 'addresses.json');

// Addresses from the partial redeploy-all-neutron.js run
const NEW_BOND     = 'neutron1j7upzfutkhvu7hj2h98wmvh5ctwgl7ne8f24kn6yhxk3c5xswm8q0fvcp8';
const NEW_REGISTRY = 'neutron1wrnutqq8djsjtw6s2h4ufe7scxm69nvwcy3npe03p4r073phr5ms0kxllr';
const NEW_VERIFIER = 'neutron10l27ahkmlz9y375a3q2um4mhxrrty59qzg6gmf44zm7q7hv99x0swj20fz';

async function makeClient(privHex, rpc) {
  const privBytes = fromHex(privHex.replace(/^0x/, ''));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address }] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });
  return { client, address };
}

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const deployerKey  = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  const relayerBKey  = process.env.RELAYER_B_PRIVATE_KEY;
  if (!rpc || !deployerKey || !relayerBKey) throw new Error('Missing env vars');

  // Step 1: Relayer B sends 500k untrn to deployer
  console.log('\n[step 1] Relayer B → deployer 500000 untrn...');
  const { client: bClient, address: bAddr } = await makeClient(relayerBKey, rpc);
  const { client: deployerClient, address: deployerAddr } = await makeClient(deployerKey, rpc);
  console.log('  Relayer B:', bAddr);
  console.log('  Deployer:', deployerAddr);

  const sendResult = await bClient.sendTokens(
    bAddr, deployerAddr, [coin('500000', 'untrn')],
    { amount: [coin('5000', 'untrn')], gas: '200000' },
  );
  console.log('  Sent:', sendResult.transactionHash);

  // Step 2: Wire bond.set_verifier
  console.log('\n[step 2] bond.set_verifier...');
  await deployerClient.execute(deployerAddr, NEW_BOND,
    { set_verifier: { verifier: NEW_VERIFIER } }, 'auto');
  console.log('  done');

  // Step 3: Wire registry.set_verifier
  console.log('[step 3] registry.set_verifier...');
  await deployerClient.execute(deployerAddr, NEW_REGISTRY,
    { set_verifier: { verifier: NEW_VERIFIER } }, 'auto');
  console.log('  done');

  // Step 4: Deploy bridge-vault
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const tusdc = addrs.neutron.tusdc;

  console.log('\n[step 4] Deploy bridge-vault...');
  const vaultUpload = await deployerClient.upload(deployerAddr,
    fs.readFileSync(WASM('bridge_vault.wasm')), 'auto', 'tessera-vault-v3');
  console.log(`  codeId=${vaultUpload.codeId}`);
  const vaultInst = await deployerClient.instantiate(deployerAddr, vaultUpload.codeId,
    { verifier: NEW_VERIFIER, tusdc }, 'bridge-vault', 'auto', { admin: deployerAddr });
  const bridge_vault = vaultInst.contractAddress;
  console.log('  bridge_vault:', bridge_vault);

  // Step 5: Deploy bridge-mint
  console.log('\n[step 5] Deploy bridge-mint...');
  const mintUpload = await deployerClient.upload(deployerAddr,
    fs.readFileSync(WASM('bridge_mint.wasm')), 'auto', 'tessera-mint-v3');
  console.log(`  codeId=${mintUpload.codeId}`);
  const mintInst = await deployerClient.instantiate(deployerAddr, mintUpload.codeId,
    { verifier: NEW_VERIFIER, tusdc }, 'bridge-mint', 'auto', { admin: deployerAddr });
  const bridge_mint = mintInst.contractAddress;
  console.log('  bridge_mint:', bridge_mint);

  // Step 6: tusdc.set_bridge_mint
  console.log('\n[step 6] tusdc.set_bridge_mint...');
  await deployerClient.execute(deployerAddr, tusdc,
    { set_bridge_mint: { bridge_mint } }, 'auto');
  console.log('  done');

  // Step 7: Update addresses.json + .env
  addrs.neutron = {
    tusdc,
    bond: NEW_BOND,
    relayer_registry: NEW_REGISTRY,
    verifier: NEW_VERIFIER,
    bridge_vault,
    bridge_mint,
  };
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));
  console.log('\n=== addresses.json updated ===');
  console.log(JSON.stringify(addrs.neutron, null, 2));
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
