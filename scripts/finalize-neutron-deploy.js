#!/usr/bin/env node
// Final step: instantiate new tusdc+vault+mint from existing code IDs (no upload needed).
// Bond, registry, and verifier are already deployed and wired.
// Usage: node scripts/finalize-neutron-deploy.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const fs = require('fs');
const path = require('path');

const ADDR_FILE = path.join(__dirname, 'addresses.json');

// Already-deployed and wired (bond.set_verifier + registry.set_verifier done)
const BOND     = 'neutron1j7upzfutkhvu7hj2h98wmvh5ctwgl7ne8f24kn6yhxk3c5xswm8q0fvcp8';
const REGISTRY = 'neutron1wrnutqq8djsjtw6s2h4ufe7scxm69nvwcy3npe03p4r073phr5ms0kxllr';
const VERIFIER = 'neutron10l27ahkmlz9y375a3q2um4mhxrrty59qzg6gmf44zm7q7hv99x0swj20fz';

// Code IDs already on-chain
const TUSDC_CODE       = 13994;
const VAULT_CODE       = 14006;
const BRIDGE_MINT_CODE = 14007;

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

  // 1. Instantiate tUSDC
  console.log('\n[tusdc] Instantiating from codeId', TUSDC_CODE, '...');
  const tUsdcInst = await client.instantiate(admin, TUSDC_CODE, { owner: admin }, 'tusdc', 'auto', { admin });
  const tusdc = tUsdcInst.contractAddress;
  console.log('  tusdc:', tusdc);

  // 2. Instantiate bridge-vault
  console.log('\n[bridge-vault] Instantiating from codeId', VAULT_CODE, '...');
  const vaultInst = await client.instantiate(admin, VAULT_CODE,
    { verifier: VERIFIER, tusdc }, 'bridge-vault', 'auto', { admin });
  const bridge_vault = vaultInst.contractAddress;
  console.log('  bridge_vault:', bridge_vault);

  // 3. Instantiate bridge-mint
  console.log('\n[bridge-mint] Instantiating from codeId', BRIDGE_MINT_CODE, '...');
  const mintInst = await client.instantiate(admin, BRIDGE_MINT_CODE,
    { verifier: VERIFIER, tusdc }, 'bridge-mint', 'auto', { admin });
  const bridge_mint = mintInst.contractAddress;
  console.log('  bridge_mint:', bridge_mint);

  // 4. Wire tusdc.set_bridge_mint
  console.log('\n[tusdc] set_bridge_mint...');
  await client.execute(admin, tusdc, { set_bridge_mint: { bridge_mint } }, 'auto');
  console.log('  done');

  // 5. Update addresses.json
  const addrs = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf8'));
  addrs.neutron = { tusdc, bond: BOND, relayer_registry: REGISTRY, verifier: VERIFIER, bridge_vault, bridge_mint };
  fs.writeFileSync(ADDR_FILE, JSON.stringify(addrs, null, 2));

  console.log('\n=== All wired. Final addresses ===');
  console.log(JSON.stringify(addrs.neutron, null, 2));
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
