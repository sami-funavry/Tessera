use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Binary;
use tessera_types::MessageEnvelope;

#[cw_serde]
pub struct InstantiateMsg {
    pub bond: String,
    pub registry: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Relayer submits a message claim. Stores the submission for challenge.
    SubmitMessage {
        envelope: MessageEnvelope,
        fingerprint: String,
        event_timestamp: u64,
    },
    /// Challenger disputes a pending submission within the challenge window.
    Challenge {
        submission_id: String,
        correct_fingerprint: String,
        evidence_proof: Binary,
    },
    /// Anyone executes a submission after the challenge window expires.
    ExecuteMessage {
        submission_id: String,
        proof: Binary,
    },
    /// Anyone claims the absence slash after a handover-period submission executes.
    ClaimAbsenceSlash {
        submission_id: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(SubmissionResponse)]
    GetSubmission { submission_id: String },
    #[returns(bool)]
    IsExecuted { message_id: String },
}

#[cw_serde]
pub struct SubmissionResponse {
    pub submission_id: String,
    pub message_id: String,
    pub submitter: String,
    pub fingerprint: String,
    pub event_timestamp: u64,
    pub submitted_at: u64,
    pub status: String,
}
