'use client';

import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { ADDRESSES } from '@/lib/config';

// StdFee shape from @cosmjs/amino. Inlined so we don't have to add another
// cosmjs sub-package to package.json — both major versions in our tree (0.38
// and 0.39) accept this exact structural shape.
export interface NeutronStdFee {
  amount: { denom: string; amount: string }[];
  gas: string;
}

export const NEUTRON_RPC = process.env.NEXT_PUBLIC_NEUTRON_RPC_URL ?? 'https://neutron-testnet-rpc.polkachu.com';
export const NEUTRON_CHAIN_ID = process.env.NEXT_PUBLIC_NEUTRON_CHAIN_ID ?? 'pion-1';

export const NEUTRON_CHAIN_INFO = {
  chainId: NEUTRON_CHAIN_ID,
  chainName: 'Neutron Testnet',
  rpc: NEUTRON_RPC,
  rest: process.env.NEXT_PUBLIC_NEUTRON_REST_URL ?? 'https://neutron-testnet-api.polkachu.com',
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

    // Register the tUSDC CW20 with Keplr so its native sidebar shows the
    // balance. Idempotent — silently no-ops if already added. We swallow any
    // rejection because the user may decline the popup; balance still works
    // via our own polling hook.
    try {
      await keplr.suggestToken(NEUTRON_CHAIN_ID, ADDRESSES.neutron.tusdc);
    } catch {
      /* user declined or token already registered */
    }

    const offlineSigner = keplr.getOfflineSigner(NEUTRON_CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    const address = accounts[0]?.address ?? null;
    if (!address) return null;

    // We deliberately do NOT pass `gasPrice` here. The dependency tree carries
    // two copies of `@cosmjs/stargate` (0.38 transitively via cosmwasm-stargate
    // and 0.39 as a direct dep), so the `GasPrice` class identity differs and
    // CosmJS's internal `instanceof` check fails at signing time with
    // "Gas price must be a GasPrice instance when using static pricing".
    // We sidestep the mismatch entirely by always passing an explicit
    // `StdFee` to `client.execute()` (see `neutronFee` below). This is also
    // more deterministic than `auto` on a public testnet.
    const client = await SigningCosmWasmClient.connectWithSigner(
      NEUTRON_RPC,
      offlineSigner,
    );

    return { address, client };
  } catch {
    return null;
  }
}

/**
 * Build an explicit `StdFee` for Neutron pion-1. Always pass this to
 * `client.execute()` — never `'auto'` — to avoid the dual-cosmjs GasPrice
 * structural mismatch documented in `connectKeplr`.
 *
 * Gas-price floor on Neutron pion-1 is 0.025 untrn/gas (see chain registry).
 * 250k gas covers a CW20 transfer with comfortable headroom; bump for heavier
 * messages.
 */
export function neutronFee(gas = 250_000): NeutronStdFee {
  const gasPrice = 0.025;
  const amount = Math.ceil(gas * gasPrice).toString();
  return {
    amount: [{ denom: 'untrn', amount }],
    gas: gas.toString(),
  };
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
