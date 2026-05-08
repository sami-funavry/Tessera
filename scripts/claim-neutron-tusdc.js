#!/usr/bin/env node
// Claim 1000 tUSDC on Neutron for the deployer/user wallet.
// Usage: node scripts/claim-neutron-tusdc.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { coin } = require('./deploy/node_modules/@cosmjs/amino');

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  const tusdc = process.env.NEUTRON_TUSDC;
  if (!rpc || !privHex || !tusdc) throw new Error('Missing env vars');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: claimer }] = await wallet.getAccounts();
  console.log('Claiming for:', claimer);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: { amount: { toString: () => '0.025' }, denom: 'untrn' },
  });

  const result = await client.execute(
    claimer,
    tusdc,
    { claim: {} },
    { amount: [coin('5000', 'untrn')], gas: '300000' },
  );
  console.log('Claim tx:', result.transactionHash);

  // Check resulting balance
  const bal = await client.queryContractSmart(tusdc, { balance: { addr: claimer } });
  console.log('tUSDC balance after claim:', bal, '(raw units)');
}

main().catch(err => { console.error(err); process.exit(1); });
