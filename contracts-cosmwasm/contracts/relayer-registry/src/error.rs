use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("not deployer")]
    NotDeployer {},
    #[error("verifier already set")]
    VerifierAlreadySet {},
    #[error("not verifier")]
    NotVerifier {},
    #[error("insufficient bond")]
    InsufficientBond {},
    #[error("zero pubkey")]
    ZeroPubkey {},
    #[error("already registered")]
    AlreadyRegistered {},
    #[error("not registered")]
    NotRegistered {},
    #[error("not active")]
    NotActive {},
    #[error("registration cooldown not elapsed")]
    RegistrationCooldown {},
    #[error("index out of range")]
    IndexOutOfRange {},
}
