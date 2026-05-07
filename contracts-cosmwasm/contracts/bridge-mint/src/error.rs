use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("not verifier")]
    NotVerifier {},
    #[error("invalid bridge payload")]
    InvalidPayload {},
}
