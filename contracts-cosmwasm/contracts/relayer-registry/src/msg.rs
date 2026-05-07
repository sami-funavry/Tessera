use cosmwasm_schema::{cw_serde, QueryResponses};

#[cw_serde]
pub struct InstantiateMsg {
    /// Bond contract address.
    pub bond: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// One-time setter — deployer only.
    SetVerifier { verifier: String },
    /// Register caller as an active relayer (requires sufficient bond).
    Register { pubkey: Vec<u8> },
    /// Voluntarily deregister — enters CoolingDown state.
    Deregister {},
    /// Update the relayer's public key.
    RotateKey { pubkey: Vec<u8> },
    /// Called by Verifier after a slash — may bench or deregister relayer.
    RecordSlash { relayer: String },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(u64)]
    ActiveCount {},
    #[returns(cosmwasm_std::Addr)]
    RelayerAt { index: u64 },
    #[returns(bool)]
    IsActive { addr: String },
}
