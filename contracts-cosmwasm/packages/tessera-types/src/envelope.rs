use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Binary, Uint128};

/// Canonical cross-chain message envelope (R-67).
#[cw_serde]
pub struct MessageEnvelope {
    pub source_chain_id: String,
    pub source_app: String,
    pub destination_chain_id: String,
    pub destination_app: String,
    pub action: [u8; 4],
    pub payload: Binary,
    pub nonce: u64,
}

/// Standard IApp dispatch message — any destinationApp must handle this variant.
#[cw_serde]
pub enum IAppExecuteMsg {
    OnCrossChainMessage {
        source_chain_id: String,
        source_app: String,
        action: [u8; 4],
        payload: Binary,
    },
}

/// Payload for tUSDC bridge transfers, JSON-encoded inside MessageEnvelope.payload.
#[cw_serde]
pub struct BridgePayload {
    pub recipient: String,
    pub amount: Uint128,
    pub nonce: u64,
}

/// Stable, deterministic message ID from envelope fields (mirrors Solidity keccak).
pub fn message_id(env: &MessageEnvelope) -> String {
    format!("msg:{}:{}:{}", env.source_chain_id, env.source_app, env.nonce)
}

/// Submission ID: unique per (message, submitter, block-time). String key for state maps.
pub fn submission_id(msg_id: &str, submitter: &str, block_time_nanos: u64) -> String {
    format!("sub:{}:{}:{}", msg_id, submitter, block_time_nanos)
}
