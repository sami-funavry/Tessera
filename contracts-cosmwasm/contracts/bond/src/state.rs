use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};

pub const VERIFIER: Item<Addr> = Item::new("verifier");
pub const DEPLOYER: Item<Addr> = Item::new("deployer");
/// Internal accounting balance per relayer (native untrn).
pub const BALANCE: Map<&Addr, Uint128> = Map::new("balance");
/// Last deposit/slash timestamp per relayer — used for withdrawal cooldown.
pub const LAST_ACTIVITY: Map<&Addr, u64> = Map::new("last_activity");

// Thresholds in uNTRN (1 NTRN = 1_000_000 uNTRN).
// Testnet values — calibrated to daily faucet yield (~2 NTRN/day Neutron).
// Production: INITIAL=100_000_000, OPERATING=50_000_000, DEREGISTRATION=25_000_000.
pub const INITIAL_BOND: Uint128 = Uint128::new(80_000);         // 0.08 NTRN (testnet faucet limit; production: 1_000_000)
pub const OPERATING_THRESHOLD: Uint128 = Uint128::new(40_000);   // 0.04 NTRN
pub const DEREGISTRATION_THRESHOLD: Uint128 = Uint128::new(20_000); // 0.02 NTRN
pub const WITHDRAWAL_COOLDOWN: u64 = 3_600; // 1 h
pub const BASIS_POINTS: u128 = 10_000;
