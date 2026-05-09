#!/usr/bin/env node
// Migrate the deployed Neutron tUSDC contract to the new code that supports
// MigrateMsg, then atomically rotate BRIDGE_MINT to the freshly-deployed
// bridge-mint v2 (which carries `destination_recipient` on Burn).
//
// State (BALANCES, TOTAL_SUPPLY, OWNER, claim cooldowns) is preserved by the
// migration — only BRIDGE_MINT is overwritten.
//
// Reads new bridge-mint address from scripts/addresses.json.
// Usage: node scripts/migrate-tusdc-neutron.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '../contracts-cosmwasm/artifacts');
const ADDR_FILE = path.join(__dirname, 'addresses.json');

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!rpc || !privHex) throw new Error('Missing NEUTRON_RPC_URL or NEUTRON_DEPLOYER_PRIVATE_KEY in .env');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: admin }] = await wallet.getAccounts();
  console.log('Admin:', admin);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  const tusdc = addrs.neutron.tusdc;
  const newBridgeMint = addrs.neutron.bridge_mint;
  if (!tusdc || !newBridgeMint) throw new Error('addresses.json missing tusdc or bridge_mint on neutron');

  console.log(`tusdc:           ${tusdc}`);
  console.log(`new bridge_mint: ${newBridgeMint}`);

  // Step 1 — upload new tusdc code.
  console.log('\n[tusdc] Uploading new tusdc.wasm with migrate entrypoint...');
  const wasm = fs.readFileSync(path.join(WASM_DIR, 'tusdc.wasm'));
  const upload = await client.upload(admin, wasm, 'auto', 'tessera tusdc v2 (P-10.10 migrate to rotate bridge_mint)');
  console.log(`  codeId: ${upload.codeId}  txHash: ${upload.transactionHash}`);

  // Step 2 — migrate the deployed tusdc contract to the new code, passing the
  // new bridge-mint address in the migrate message body. This:
  //   (a) replaces the contract bytecode at `tusdc` with the newly uploaded code,
  //   (b) calls `migrate(MigrateMsg { bridge_mint })` which overwrites BRIDGE_MINT,
  //   (c) preserves every other storage slot (BALANCES, TOTAL_SUPPLY, etc.).
  console.log('[tusdc] Migrating contract...');
  const migrate = await client.migrate(
    admin,
    tusdc,
    upload.codeId,
    { bridge_mint: newBridgeMint },
    'auto',
    'rotate bridge_mint to v2',
  );
  console.log(`  txHash: ${migrate.transactionHash}`);

  console.log(`\nMigration complete. Verify on Celatone:`);
  console.log(`  https://neutron.celat.one/pion-1/contracts/${tusdc}`);
}

main().catch((err) => {
  console.error('migrate-tusdc-neutron failed:', err);
  process.exit(1);
});
