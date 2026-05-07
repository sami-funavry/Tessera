use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("not active relayer")]
    NotActiveRelayer {},
    #[error("message already executed")]
    MessageAlreadyExecuted {},
    #[error("challenge window still open")]
    ChallengeWindowOpen {},
    #[error("challenge window closed")]
    ChallengeWindowClosed {},
    #[error("submission not pending")]
    NotPending {},
    #[error("invalid proof")]
    InvalidProof {},
    #[error("handover period not elapsed")]
    HandoverNotElapsed {},
    #[error("submitter was original assignee")]
    SubmitterWasOriginalAssignee {},
    #[error("absence slash already claimed")]
    AbsenceAlreadyClaimed {},
    #[error("registry empty")]
    RegistryEmpty {},
}
