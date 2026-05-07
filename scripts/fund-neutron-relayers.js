#!/usr/bin/env node
// Fund relayer A and B Neutron addresses from the deployer wallet.
// Usage: node scripts/fund-neutron-relayers.js
'use strict';

require('./deploy/node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DirectSecp256k1Wallet } = require('./deploy/node_modules/@cosmjs/proto-signing');
const { SigningCosmWasmClient } = require('./deploy/node_modules/@cosmjs/cosmwasm-stargate');
const { coin } = require('./deploy/node_modules/@cosmjs/amino');

async function main() {
  const rpc = process.env.NEUTRON_RPC_URL;
  const privHex = process.env.NEUTRON_DEPLOYER_PRIVATE_KEY;
  if (!rpc || !privHex) throw new Error('NEUTRON_RPC_URL or NEUTRON_DEPLOYER_PRIVATE_KEY not set');

  const privBytes = Uint8Array.from(Buffer.from(privHex.replace(/^0x/, ''), 'hex'));
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: deployer }] = await wallet.getAccounts();
  console.log('Deployer:', deployer);

  const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, {
    gasPrice: { amount: { toString: () => '0.025' }, denom: 'untrn' },
  });

  const targets = [
    { label: 'Relayer A', addr: 'neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9' },
    { label: 'Relayer B', addr: 'neutron16cpjlg5x70ahp8wvvmrnjslzw3kqzvatmqp933' },
  ];

  for (const { label, addr } of targets) {
    console.log(`Sending 700000 untrn to ${label} (${addr})...`);
    const result = await client.sendTokens(
      deployer,
      addr,
      [coin('700000', 'untrn')],
      { amount: [coin('5000', 'untrn')], gas: '200000' },
    );
    console.log(`${label} funded: txHash=${result.transactionHash}`);
  }
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
