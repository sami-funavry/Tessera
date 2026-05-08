#!/usr/bin/env node
// Claim tUSDC on new v2 contract for all relevant wallets:
//   1. User wallet (NEUTRON_WALLET_ADDRESS)
//   2. Relayer A (RELAYER_A_NEUTRON_ADDRESS)
//   3. Relayer B (RELAYER_B_NEUTRON_ADDRESS)
// Usage: node scripts/fund-all-neutron-v2.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');

const TUSDC = 'neutron1fw6unz7a9j4zf9gnvhup5qe6dlftytdc0y0rwyn3lyxdazz22rtsck0vld';
const RPC   = process.env.NEUTRON_RPC_URL;

async function claimFor(privHex, label) {
  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet    = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address }] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });
  try {
    const res = await client.execute(address, TUSDC, { claim: {} }, 'auto');
    const bal = await client.queryContractSmart(TUSDC, { balance: { addr: address } });
    console.log(`[${label}] ${address} → claimed OK (tx: ${res.transactionHash.slice(0, 12)}...) balance: ${bal}`);
  } catch (err) {
    if (err.message?.includes('ClaimTooSoon') || err.message?.includes('claim too soon')) {
      const bal = await client.queryContractSmart(TUSDC, { balance: { addr: address } });
      console.log(`[${label}] ${address} → already claimed (balance: ${bal})`);
    } else {
      console.error(`[${label}] FAILED:`, err.message || err);
    }
  }
}

async function main() {
  if (!RPC) throw new Error('Missing NEUTRON_RPC_URL');
  console.log('tUSDC contract:', TUSDC);
  console.log('---');

  const deployer  = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  const relayerA  = process.env.RELAYER_A_PRIVATE_KEY;
  const relayerB  = process.env.RELAYER_B_PRIVATE_KEY;

  if (!deployer) throw new Error('Missing NEUTRON_DEPLOYER_PRIVATE_KEY');
  if (!relayerA) throw new Error('Missing RELAYER_A_PRIVATE_KEY');
  if (!relayerB) throw new Error('Missing RELAYER_B_PRIVATE_KEY');

  // Fund in sequence to avoid nonce conflicts
  await claimFor(deployer, 'user-wallet');
  await claimFor(relayerA, 'relayer-A  ');
  await claimFor(relayerB, 'relayer-B  ');

  console.log('\n[done] All wallets funded on tUSDC v2');
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
