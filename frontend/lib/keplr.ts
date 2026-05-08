'use client';

import { SigningCosmWasmClient, type SigningCosmWasmClientOptions } from '@cosmjs/cosmwasm-stargate';

export const NEUTRON_RPC = process.env.NEXT_PUBLIC_NEUTRON_RPC_URL ?? 'https://rpc-falcron.pion-1.ntrn.tech';
export const NEUTRON_CHAIN_ID = process.env.NEXT_PUBLIC_NEUTRON_CHAIN_ID ?? 'pion-1';

export const NEUTRON_CHAIN_INFO = {
  chainId: NEUTRON_CHAIN_ID,
  chainName: 'Neutron Testnet',
  rpc: NEUTRON_RPC,
  rest: 'https://rest-falcron.pion-1.ntrn.tech',
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: 'neutron',
    bech32PrefixAccPub: 'neutronpub',
    bech32PrefixValAddr: 'neutronvaloper',
    bech32PrefixValPub: 'neutronvaloperpub',
    bech32PrefixConsAddr: 'neutronvalcons',
    bech32PrefixConsPub: 'neutronvalconspub',
  },
  currencies: [{ coinDenom: 'NTRN', coinMinimalDenom: 'untrn', coinDecimals: 6 }],
  feeCurrencies: [
    {
      coinDenom: 'NTRN',
      coinMinimalDenom: 'untrn',
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: 0.025, high: 0.05 },
    },
  ],
  stakeCurrency: { coinDenom: 'NTRN', coinMinimalDenom: 'untrn', coinDecimals: 6 },
};

export async function connectKeplr(): Promise<{ address: string; client: SigningCosmWasmClient } | null> {
  if (typeof window === 'undefined') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keplr = (window as any).keplr;
  if (!keplr) return null;

  try {
    await keplr.experimentalSuggestChain(NEUTRON_CHAIN_INFO);
    await keplr.enable(NEUTRON_CHAIN_ID);

    const offlineSigner = keplr.getOfflineSigner(NEUTRON_CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    const address = accounts[0]?.address ?? null;
    if (!address) return null;

    const opts: SigningCosmWasmClientOptions = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gasPrice: { denom: 'untrn', amount: { toString: () => '0.025' } } as any,
    };
    const client = await SigningCosmWasmClient.connectWithSigner(
      NEUTRON_RPC,
      offlineSigner,
      opts
    );

    return { address, client };
  } catch {
    return null;
  }
}

export async function getKeplrAddress(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keplr = (window as any).keplr;
  if (!keplr) return null;
  try {
    await keplr.enable(NEUTRON_CHAIN_ID);
    const key = await keplr.getKey(NEUTRON_CHAIN_ID);
    return key.bech32Address;
  } catch {
    return null;
  }
}
