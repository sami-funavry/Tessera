#!/usr/bin/env node
// Register and bond Relayer A and B on Neutron (pion-1) using CosmJS.
// Usage: node scripts/register-neutron-relayers.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { GasPrice } = require('./deploy/node_modules/@cosmjs/stargate');
const { coin } = require('./deploy/node_modules/@cosmjs/amino');
const { fromHex } = require('./deploy/node_modules/@cosmjs/encoding');

const REGISTRY = process.env.NEUTRON_REGISTRY;
const BOND_ADDR = process.env.NEUTRON_BOND;
const BOND_AMOUNT = '80000'; // 0.08 NTRN — above 80k initial threshold (v4 contracts)

async function registerRelayer(label, privHex, rpc) {
  const privBytes = fromHex(privHex.replace(/^0x/, ''));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address, pubkey }] = await wallet.getAccounts();
  console.log(`\n[${label}] address: ${address}`);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString('0.025untrn'),
  });

  const balance = await client.getBalance(address, 'untrn');
  console.log(`[${label}] balance: ${balance.amount} untrn`);

  // Check if already registered — if so, skip balance requirements.
  let alreadyActive = false;
  try {
    alreadyActive = await client.queryContractSmart(REGISTRY, { is_active: { addr: address } });
  } catch {}

  // Check on-chain bond balance — if already meets threshold, skip wallet balance check.
  let onChainBond = '0';
  try {
    const bq = await client.queryContractSmart(BOND_ADDR, { balance: { addr: address } });
    onChainBond = typeof bq === 'string' ? bq : JSON.stringify(bq);
  } catch {}
  const needsDeposit = parseInt(onChainBond, 10) < parseInt(BOND_AMOUNT, 10);
  if (!alreadyActive && needsDeposit && parseInt(balance.amount, 10) < 82000) {
    throw new Error(`[${label}] insufficient balance (${balance.amount} untrn) — needs at least 82000`);
  }
  console.log(`[${label}] on-chain bond: ${onChainBond} untrn | already_active: ${alreadyActive}`);

  // Deposit bond first (registry requires INITIAL_BOND before allowing register).
  if (!alreadyActive && needsDeposit) {
    console.log(`[${label}] Depositing bond (${BOND_AMOUNT} untrn) to bond contract (${BOND_ADDR})...`);
    const bondResult = await client.execute(
      address, BOND_ADDR,
      { deposit: { for_relayer: address } },
      'auto', '', [coin(BOND_AMOUNT, 'untrn')],
    );
    console.log(`[${label}] Bond deposited: txHash=${bondResult.transactionHash}`);
  } else {
    console.log(`[${label}] Bond already sufficient — skipping deposit`);
  }

  // Register: pubkey is the raw 33-byte compressed secp256k1 key from CosmJS account.
  const pubkeyArray = Array.from(pubkey);
  console.log(`[${label}] Registering on Neutron registry (${REGISTRY})...`);
  try {
    const regResult = await client.execute(
      address, REGISTRY,
      { register: { pubkey: pubkeyArray } },
      'auto',
    );
    console.log(`[${label}] Registered: txHash=${regResult.transactionHash}`);
  } catch (err) {
    if (err.message && (err.message.includes('already registered') || alreadyActive)) {
      console.log(`[${label}] Already registered — skipping`);
    } else {
      throw err;
    }
  }

  const bondBalance = await client.queryContractSmart(BOND_ADDR, { balance: { addr: address } });
  console.log(`[${label}] On-chain bond balance: ${JSON.stringify(bondBalance)}`);
}

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  if (!rpc) throw new Error('NEUTRON_RPC_URL not set');
  if (!REGISTRY) throw new Error('NEUTRON_REGISTRY not set');
  if (!BOND_ADDR) throw new Error('NEUTRON_BOND not set');

  const relayerAKey = process.env.RELAYER_A_PRIVATE_KEY;
  const relayerBKey = process.env.RELAYER_B_PRIVATE_KEY;
  if (!relayerAKey || !relayerBKey) throw new Error('RELAYER_A_PRIVATE_KEY or RELAYER_B_PRIVATE_KEY not set');

  await registerRelayer('Relayer A', relayerAKey, rpc);
  await registerRelayer('Relayer B', relayerBKey, rpc);

  console.log('\n=== Neutron registration complete ===');
}

main().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
