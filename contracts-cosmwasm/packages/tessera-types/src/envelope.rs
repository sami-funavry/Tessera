use cosmwasm_schema::cw_serde;

/// Canonical cross-chain message envelope (R-67).
#[cw_serde]
pub struct MessageEnvelope {
    pub source_chain_id:      String,
    pub source_app:           String,
    pub destination_chain_id: String,
    pub destination_app:      String,
    pub action:               [u8; 4],
    pub payload:              Vec<u8>,
    pub nonce:                u64,
}
