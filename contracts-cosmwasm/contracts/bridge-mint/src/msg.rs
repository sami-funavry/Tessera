use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Binary, Uint128};

#[cw_serde]
pub struct InstantiateMsg {
    pub verifier: String,
    pub tusdc: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Called by Verifier after a verified cross-chain message (IApp interface).
    OnCrossChainMessage {
        source_chain_id: String,
        source_app: String,
        action: [u8; 4],
        payload: Binary,
    },
    /// User initiates Neutron → Sepolia bridge by burning tUSDC here.
    /// `destination_recipient` is the user's address on the destination chain
    /// (e.g. a Sepolia 0x… string). The relayer reads it from the Burn event
    /// attributes, decodes it as a 20-byte EVM address, and packs it into the
    /// abi-encoded payload it sends to the Sepolia BridgeVault. Without this
    /// field there's no on-chain channel for the recipient — the destination
    /// app would revert with `invalid bridge payload` (P-10.10 fix).
    Burn {
        amount: Uint128,
        destination_chain_id: String,
        destination_app: String,
        destination_recipient: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(cosmwasm_std::Addr)]
    Verifier {},
}
