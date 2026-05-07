use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

#[cw_serde]
#[derive(Default)]
pub enum RelayerStatus {
    #[default]
    Unknown,
    Active,
    Benched,
    CoolingDown,
    Deregistered,
}

#[cw_serde]
pub struct RelayerInfo {
    pub pubkey: Vec<u8>,
    pub status: RelayerStatus,
    pub slash_count: u32,
    pub deregistered_at: u64,
}

pub const VERIFIER: Item<Addr> = Item::new("verifier");
pub const DEPLOYER: Item<Addr> = Item::new("deployer");
pub const BOND: Item<Addr> = Item::new("bond");
/// Ordered list of active relayer addresses.
pub const ACTIVE_LIST: Item<Vec<Addr>> = Item::new("active_list");
pub const RELAYERS: Map<&Addr, RelayerInfo> = Map::new("relayers");

pub const REREGISTRATION_COOLDOWN: u64 = 3_600; // 1 h on testnet
