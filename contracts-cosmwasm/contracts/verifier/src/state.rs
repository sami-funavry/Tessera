use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use tessera_types::MessageEnvelope;

#[cw_serde]
#[derive(Default)]
pub enum SubmissionStatus {
    #[default]
    Pending,
    Executed,
    Slashed,
    Challenged,
}

#[cw_serde]
pub struct Submission {
    pub message_id: String,
    pub envelope: MessageEnvelope,
    pub fingerprint: String,
    pub submitter: Addr,
    pub event_timestamp: u64,
    pub submitted_at: u64,
    pub status: SubmissionStatus,
}

pub const BOND: Item<Addr> = Item::new("bond");
pub const REGISTRY: Item<Addr> = Item::new("registry");
pub const SUBMISSIONS: Map<&str, Submission> = Map::new("submissions");
/// True once a messageId has been successfully executed — prevents replay.
pub const EXECUTED_MESSAGES: Map<&str, bool> = Map::new("executed_messages");
/// True after claimAbsenceSlash has been called for a submissionId.
pub const ABSENCE_SLASH_CLAIMED: Map<&str, bool> = Map::new("absence_claimed");

pub const CHALLENGE_WINDOW: u64 = 60;  // seconds
pub const HANDOVER_PERIOD: u64 = 30;   // seconds
pub const BASIS_POINTS: u128 = 10_000;
