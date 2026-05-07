use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Uint128;

#[cw_serde]
pub struct InstantiateMsg {}

#[cw_serde]
pub enum ExecuteMsg {
    /// One-time setter — callable only by the deployer.
    SetVerifier { verifier: String },
    /// Deposit native untrn as bond for a relayer.
    Deposit { for_relayer: String },
    /// Slash target's bond, sending the amount to recipient. Only Verifier.
    Slash { target: String, recipient: String, bps: u64 },
    /// Voluntarily withdraw bond after cooldown.
    Withdraw { amount: Uint128 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(Uint128)]
    Balance { addr: String },
    #[returns(bool)]
    IsAboveInitial { addr: String },
    #[returns(bool)]
    IsAboveOperating { addr: String },
    #[returns(Uint128)]
    InitialBond {},
    #[returns(Uint128)]
    OperatingThreshold {},
    #[returns(Uint128)]
    DeregistrationThreshold {},
}
