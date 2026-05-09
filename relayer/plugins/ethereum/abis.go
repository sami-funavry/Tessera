package ethereum

// Minimal ABI JSON strings for the contracts the relayer interacts with on Sepolia.
// Defined inline to avoid a code-generation step; only the functions/events actually
// called by the relayer are included.

const verifierABIJSON = `[
  {
    "type":"function","name":"submitMessage",
    "inputs":[
      {"name":"envelope","type":"tuple","components":[
        {"name":"sourceChainId","type":"bytes32"},
        {"name":"sourceApp","type":"bytes"},
        {"name":"destinationChainId","type":"bytes32"},
        {"name":"destinationApp","type":"bytes"},
        {"name":"action","type":"bytes4"},
        {"name":"payload","type":"bytes"},
        {"name":"nonce","type":"uint64"}
      ]},
      {"name":"fingerprint","type":"bytes32"},
      {"name":"eventTimestamp","type":"uint256"}
    ],
    "outputs":[{"name":"submissionId","type":"bytes32"}],
    "stateMutability":"nonpayable"
  },
  {
    "type":"function","name":"challenge",
    "inputs":[
      {"name":"submissionId","type":"bytes32"},
      {"name":"correctFingerprint","type":"bytes32"},
      {"name":"evidenceProof","type":"bytes"}
    ],
    "outputs":[],"stateMutability":"nonpayable"
  },
  {
    "type":"function","name":"executeMessage",
    "inputs":[
      {"name":"submissionId","type":"bytes32"},
      {"name":"proof","type":"bytes"}
    ],
    "outputs":[],"stateMutability":"nonpayable"
  },
  {
    "type":"function","name":"claimAbsenceSlash",
    "inputs":[{"name":"submissionId","type":"bytes32"}],
    "outputs":[],"stateMutability":"nonpayable"
  },
  {
    "type":"event","name":"MessageSubmitted","anonymous":false,
    "inputs":[
      {"name":"submissionId","type":"bytes32","indexed":true},
      {"name":"msgId","type":"bytes32","indexed":true},
      {"name":"submitter","type":"address","indexed":true},
      {"name":"fingerprint","type":"bytes32","indexed":false},
      {"name":"eventTimestamp","type":"uint256","indexed":false}
    ]
  }
]`

const registryABIJSON = `[
  {
    "type":"function","name":"register",
    "inputs":[{"name":"pubkey","type":"bytes"}],
    "outputs":[],"stateMutability":"nonpayable"
  },
  {
    "type":"function","name":"isActive",
    "inputs":[{"name":"relayer","type":"address"}],
    "outputs":[{"name":"","type":"bool"}],
    "stateMutability":"view"
  }
]`

const bondABIJSON = `[
  {
    "type":"function","name":"deposit",
    "inputs":[],"outputs":[],"stateMutability":"payable"
  },
  {
    "type":"function","name":"balanceOf",
    "inputs":[{"name":"relayer","type":"address"}],
    "outputs":[{"name":"","type":"uint256"}],
    "stateMutability":"view"
  }
]`

const bridgeVaultABIJSON = `[
  {
    "type":"event","name":"Locked","anonymous":false,
    "inputs":[
      {"name":"user","type":"address","indexed":true},
      {"name":"amount","type":"uint256","indexed":false},
      {"name":"nonce","type":"uint64","indexed":false},
      {"name":"destinationChainId","type":"bytes32","indexed":false},
      {"name":"destinationApp","type":"bytes","indexed":false}
    ]
  },
  {
    "type":"function","name":"lock",
    "inputs":[
      {"name":"amount","type":"uint256"},
      {"name":"nonce","type":"uint64"},
      {"name":"destinationChainId","type":"bytes32"},
      {"name":"destinationApp","type":"bytes"}
    ],
    "outputs":[],"stateMutability":"nonpayable"
  }
]`

// Minimal ERC20 ABI used by the demo trigger-lock admin endpoint.
const erc20ABIJSON = `[
  {
    "type":"function","name":"approve",
    "inputs":[
      {"name":"spender","type":"address"},
      {"name":"amount","type":"uint256"}
    ],
    "outputs":[{"name":"","type":"bool"}],
    "stateMutability":"nonpayable"
  },
  {
    "type":"function","name":"allowance",
    "inputs":[
      {"name":"owner","type":"address"},
      {"name":"spender","type":"address"}
    ],
    "outputs":[{"name":"","type":"uint256"}],
    "stateMutability":"view"
  },
  {
    "type":"function","name":"balanceOf",
    "inputs":[{"name":"account","type":"address"}],
    "outputs":[{"name":"","type":"uint256"}],
    "stateMutability":"view"
  }
]`

const bridgeMintABIJSON = `[
  {
    "type":"event","name":"Burned","anonymous":false,
    "inputs":[
      {"name":"from","type":"address","indexed":true},
      {"name":"amount","type":"uint256","indexed":false},
      {"name":"destinationChainId","type":"bytes32","indexed":false},
      {"name":"destinationApp","type":"bytes","indexed":false}
    ]
  }
]`
