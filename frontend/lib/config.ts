export const ADDRESSES = {
  sepolia: {
    tusdc: '0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0',
    bond: '0x8c7dc28559B75AF8c3d59B62C87309E65cb37912',
    relayerRegistry: '0x43677d5Da5701E061Eefa65e36A4fF6D4BFC1109',
    verifier: '0x2EfAB8cC7ed7C11cfC23C215731aaFA2A602F72a',
    bridgeVault: '0x2C3544434185DD65F058494816bB816e5314a29E',
    bridgeMint: '0x61cab20856b16003b6a3FB213F86355515AD43cd',
  },
  neutron: {
    tusdc: 'neutron1fw6unz7a9j4zf9gnvhup5qe6dlftytdc0y0rwyn3lyxdazz22rtsck0vld',
    bond: 'neutron1nnz9j6c3d25wnwj4h3jqkvazgawcmgjjk5unysvf6e0j90gavvsseunvg8',
    relayerRegistry: 'neutron1jq5kku3r0sxdkcxvkx7ke4dlcwq4my0m2gncrx4zf7g37hxtwj7qfrya5k',
    verifier: 'neutron1sda4ucdq06de7h7lxg66n6sq29ft9hk76a5mpjwehk3a8wfga0eqf002f0',
    bridgeVault: 'neutron12z7xqgwgp6vsk5s96z4n6vjupqjg3zmvv5v068vvy3n69gshvhaq8j7dam',
    bridgeMint: 'neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7',
  },
} as const;

export const RELAYER_ADDRESSES = {
  A: {
    sepolia: '0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37',
    neutron: 'neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9',
  },
  B: {
    sepolia: '0xdFac507Cee79D909af53EC89b981DD9C431264C2',
    neutron: 'neutron16cpjlg5x70ahp8wvvmrnjslzw3kqzvatmqp933',
  },
} as const;

export const CHAIN_CONFIG = {
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org',
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  neutron: {
    chainId: 'pion-1',
    name: 'Neutron',
    rpcUrl: process.env.NEXT_PUBLIC_NEUTRON_RPC_URL ?? 'https://neutron-testnet-rpc.polkachu.com',
    explorer: 'https://neutron.celat.one/pion-1',
    nativeCurrency: { name: 'NTRN', symbol: 'NTRN', decimals: 6 },
  },
} as const;

export const BRIDGE_PARAMS = {
  challengeWindowSec: 60,
  handoverPeriodSec: 30,
  estimatedTimeSec: 90,
  relayerFeeBps: 10,
} as const;

// Server-side only — never expose to client bundle
export const RELAYER_ADMIN_URL =
  process.env.RELAYER_ADMIN_URL ?? 'http://localhost:8080';

// Bond thresholds in wei / uNTRN
export const BOND_THRESHOLDS = {
  sepolia: {
    initial: BigInt('20000000000000000'),    // 0.02 ETH
    operating: BigInt('10000000000000000'),  // 0.01 ETH
    deregistration: BigInt('5000000000000000'), // 0.005 ETH
  },
  neutron: {
    initial: BigInt('80000'),   // 80k uNTRN
    operating: BigInt('40000'), // 40k uNTRN
    deregistration: BigInt('20000'), // 20k uNTRN
  },
} as const;
