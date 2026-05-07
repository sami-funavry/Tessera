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
    /// Decodes payload as BridgePayload and releases tUSDC to recipient.
    OnCrossChainMessage {
        source_chain_id: String,
        source_app: String,
        action: [u8; 4],
        payload: Binary,
    },
    /// User locks tUSDC here to initiate Neutron → Sepolia bridge.
    /// tUSDC must be transferred to vault before calling (or use CW20 Send hook).
    Lock {
        amount: Uint128,
        nonce: u64,
        destination_chain_id: String,
        destination_app: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(cosmwasm_std::Addr)]
    Verifier {},
}
