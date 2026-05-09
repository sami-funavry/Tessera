#!/usr/bin/env node
// Redeploy only the bridge-mint contract on Neutron, then re-authorize it on
// the deployed tUSDC contract via set_bridge_mint. Updates scripts/addresses.json
// in place. Used after P-10.10 added the destination_recipient field on Burn.
//
// Usage: node scripts/redeploy-bridge-mint-neutron.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

// `artifacts/` is produced by `docker run cosmwasm/optimizer:0.16.0 ./contracts/<name>`
// and is the on-chain-compatible wasm. The raw `target/.../release/` build emits
// bulk-memory ops that Neutron's wasmd rejects.
const WASM_DIR = path.join(__dirname, '../contracts-cosmwasm/artifacts');
const ADDR_FILE = path.join(__dirname, 'addresses.json');

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!rpc || !privHex) throw new Error('Missing NEUTRON_RPC_URL or NEUTRON_DEPLOYER_PRIVATE_KEY in .env');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();
  console.log('Deployer:', admin);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const neutron = addrs.neutron;
  if (!neutron.verifier || !neutron.tusdc) {
    throw new Error('addresses.json missing verifier or tusdc on neutron — bailing');
  }

  // Step 1 — upload new bridge_mint.wasm.
  console.log('\n[bridge-mint] Uploading new bridge_mint.wasm...');
  const wasm = fs.readFileSync(path.join(WASM_DIR, 'bridge_mint.wasm'));
  const upload = await client.upload(admin, wasm, 'auto', 'tessera bridge-mint v2 (P-10.10 destination_recipient)');
  console.log(`  codeId: ${upload.codeId}  txHash: ${upload.transactionHash}`);

  // Step 2 — instantiate.
  console.log('[bridge-mint] Instantiating...');
  const inst = await client.instantiate(
    admin,
    upload.codeId,
    { verifier: neutron.verifier, tusdc: neutron.tusdc },
    'tessera-bridge-mint',
    'auto',
    { admin },
  );
  const newMint = inst.contractAddress;
  console.log(`  contractAddress: ${newMint}  txHash: ${inst.transactionHash}`);

  // Step 3 — re-authorize on tUSDC. Without this the new bridge-mint cannot
  // call BridgeMintTo / BridgeBurnFrom on the tusdc contract, so the
  // cross-chain dispatch would revert at the on_cross_chain_message step.
  console.log('[tusdc] Authorising new bridge-mint via set_bridge_mint...');
  const authTx = await client.execute(
    admin,
    neutron.tusdc,
    { set_bridge_mint: { bridge_mint: newMint } },
    'auto',
  );
  console.log(`  txHash: ${authTx.transactionHash}`);

  // Step 4 — persist new address.
  const oldMint = neutron.bridge_mint;
  neutron.bridge_mint = newMint;
  addrs.neutron = neutron;
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2) + '\n');
  console.log('\naddresses.json updated:');
  console.log(`  neutron.bridge_mint:  ${oldMint}`);
  console.log(`                     →  ${newMint}`);
  console.log(`\nCelatone: https://neutron.celat.one/pion-1/contracts/${newMint}`);
}

main().catch((err) => {
  console.error('redeploy-bridge-mint-neutron failed:', err);
  process.exit(1);
});
