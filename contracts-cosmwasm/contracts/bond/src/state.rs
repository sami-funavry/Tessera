use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};

pub const VERIFIER: Item<Addr> = Item::new("verifier");
pub const DEPLOYER: Item<Addr> = Item::new("deployer");
/// Internal accounting balance per relayer (native untrn).
pub const BALANCE: Map<&Addr, Uint128> = Map::new("balance");
/// Last deposit/slash timestamp per relayer — used for withdrawal cooldown.
pub const LAST_ACTIVITY: Map<&Addr, u64> = Map::new("last_activity");

// Thresholds in uNTRN (1 NTRN = 1_000_000 uNTRN).
pub const INITIAL_BOND: Uint128 = Uint128::new(100_000_000);
pub const OPERATING_THRESHOLD: Uint128 = Uint128::new(50_000_000);
pub const DEREGISTRATION_THRESHOLD: Uint128 = Uint128::new(25_000_000);
pub const WITHDRAWAL_COOLDOWN: u64 = 3_600; // 1 h
pub const BASIS_POINTS: u128 = 10_000;
