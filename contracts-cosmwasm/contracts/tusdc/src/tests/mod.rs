use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
use cosmwasm_std::Uint128;

use crate::contract::{execute, instantiate, query};
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::CLAIM_COOLDOWN;

fn setup(deps: &mut cosmwasm_std::OwnedDeps<cosmwasm_std::MemoryStorage, cosmwasm_std::testing::MockApi, cosmwasm_std::testing::MockQuerier>) {
    let owner = deps.api.addr_make("owner").to_string();
    let bridge_mint = deps.api.addr_make("bridge_mint").to_string();
    let info = mock_info(&owner, &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg { owner: owner.clone() }).unwrap();
    let info = mock_info(&owner, &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetBridgeMint { bridge_mint }).unwrap();
}

#[test]
fn test_claim_success() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let user1 = deps.api.addr_make("user1").to_string();
    let info = mock_info(&user1, &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Claim {}).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: user1 }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::new(1_000_000_000));
}

#[test]
fn test_claim_too_soon() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let env = mock_env();
    let user1 = deps.api.addr_make("user1").to_string();
    let info = mock_info(&user1, &[]);
    execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::Claim {}).unwrap();
    // Second claim in same block should fail
    let err = execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Claim {}).unwrap_err();
    assert!(matches!(err, ContractError::ClaimTooSoon { .. }));
}

#[test]
fn test_claim_allowed_after_cooldown() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let mut env = mock_env();
    let user1 = deps.api.addr_make("user1").to_string();
    let info = mock_info(&user1, &[]);
    execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::Claim {}).unwrap();
    env.block.time = env.block.time.plus_seconds(CLAIM_COOLDOWN + 1);
    execute(deps.as_mut(), env, info, ExecuteMsg::Claim {}).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: user1 }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::new(2_000_000_000)); // claimed twice
}

#[test]
fn test_bridge_mint_to_only_bridge_mint() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let attacker = deps.api.addr_make("attacker").to_string();
    let user1 = deps.api.addr_make("user1").to_string();
    let info = mock_info(&attacker, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::BridgeMintTo {
        recipient: user1,
        amount: Uint128::new(100),
    }).unwrap_err();
    assert!(matches!(err, ContractError::NotBridgeMint {}));
}

#[test]
fn test_bridge_mint_burn_round_trip() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let bridge_mint = deps.api.addr_make("bridge_mint").to_string();
    let user1 = deps.api.addr_make("user1").to_string();
    let info = mock_info(&bridge_mint, &[]);
    execute(deps.as_mut(), mock_env(), info.clone(), ExecuteMsg::BridgeMintTo {
        recipient: user1.clone(),
        amount: Uint128::new(500_000_000),
    }).unwrap();
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::BridgeBurnFrom {
        from: user1.clone(),
        amount: Uint128::new(500_000_000),
    }).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: user1 }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::zero());
}

#[test]
fn test_token_info_query() {
    let mut deps = mock_dependencies();
    setup(&mut deps);

    // Verify token_info returns CW20-compatible metadata (required by Keplr).
    let raw = query(deps.as_ref(), mock_env(), QueryMsg::TokenInfo {}).unwrap();
    let info: crate::msg::TokenInfoResponse = cosmwasm_std::from_json(raw).unwrap();
    assert_eq!(info.name, "Tessera USDC");
    assert_eq!(info.symbol, "tUSDC");
    assert_eq!(info.decimals, 6);
    assert_eq!(info.total_supply, Uint128::zero()); // no mints yet

    // After a claim, total_supply should reflect minted amount.
    let user1 = deps.api.addr_make("user1").to_string();
    let claim_info = mock_info(&user1, &[]);
    execute(deps.as_mut(), mock_env(), claim_info, ExecuteMsg::Claim {}).unwrap();
    let raw2 = query(deps.as_ref(), mock_env(), QueryMsg::TokenInfo {}).unwrap();
    let info2: crate::msg::TokenInfoResponse = cosmwasm_std::from_json(raw2).unwrap();
    assert_eq!(info2.total_supply, Uint128::new(1_000_000_000));
}
