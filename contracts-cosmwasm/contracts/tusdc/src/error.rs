use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("not owner")]
    NotOwner {},
    #[error("not bridge mint")]
    NotBridgeMint {},
    #[error("bridge mint already set")]
    BridgeMintAlreadySet {},
    #[error("claim too soon; next claim at {next_ts}")]
    ClaimTooSoon { next_ts: u64 },
    #[error("insufficient funds: need {need}, have {have}")]
    InsufficientFunds { need: Uint128, have: Uint128 },
}

use cosmwasm_std::Uint128;
