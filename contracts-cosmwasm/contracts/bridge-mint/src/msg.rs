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
    Burn {
        amount: Uint128,
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
