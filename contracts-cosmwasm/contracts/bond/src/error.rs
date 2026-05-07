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
    #[error("no native untrn funds sent")]
    NativeFundsRequired {},
    #[error("insufficient bond balance")]
    InsufficientFunds {},
    #[error("withdrawal cooldown not elapsed")]
    WithdrawalCooldown {},
    #[error("transfer failed")]
    TransferFailed {},
}
