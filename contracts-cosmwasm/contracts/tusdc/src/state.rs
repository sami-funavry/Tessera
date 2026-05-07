use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};

pub const OWNER: Item<Addr> = Item::new("owner");
pub const BRIDGE_MINT: Item<Addr> = Item::new("bridge_mint");
pub const BALANCES: Map<&Addr, Uint128> = Map::new("balances");
pub const TOTAL_SUPPLY: Item<Uint128> = Item::new("total_supply");
/// Maps address → last claim Unix timestamp (seconds).
pub const LAST_CLAIM: Map<&Addr, u64> = Map::new("last_claim");

pub const CLAIM_AMOUNT: Uint128 = Uint128::new(1_000_000_000); // 1 000 tUSDC (6 decimals)
pub const CLAIM_COOLDOWN: u64 = 86_400; // 24 h in seconds
