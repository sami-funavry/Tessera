use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
use cosmwasm_std::{coins, Uint128};

use crate::contract::{execute, instantiate, query};
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::WITHDRAWAL_COOLDOWN;

fn setup(deps: &mut cosmwasm_std::OwnedDeps<cosmwasm_std::MemoryStorage, cosmwasm_std::testing::MockApi, cosmwasm_std::testing::MockQuerier>) {
    let deployer = deps.api.addr_make("deployer").to_string();
    let verifier = deps.api.addr_make("verifier").to_string();
    let info = mock_info(&deployer, &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg {}).unwrap();
    let info = mock_info(&deployer, &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetVerifier { verifier }).unwrap();
}

#[test]
fn test_deposit_and_balance() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let info = mock_info(&relayer_a, &coins(100_000_000, "untrn"));
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deposit { for_relayer: relayer_a.clone() }).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: relayer_a }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::new(100_000_000));
}

#[test]
fn test_deposit_no_funds_reverts() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let info = mock_info(&relayer_a, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deposit { for_relayer: relayer_a }).unwrap_err();
    assert!(matches!(err, ContractError::NativeFundsRequired {}));
}

#[test]
fn test_slash_by_verifier() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let verifier = deps.api.addr_make("verifier").to_string();
    let challenger = deps.api.addr_make("challenger").to_string();
    // deposit
    let info = mock_info(&relayer_a, &coins(100_000_000, "untrn"));
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deposit { for_relayer: relayer_a.clone() }).unwrap();
    // slash 50%
    let info = mock_info(&verifier, &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Slash {
        target: relayer_a.clone(),
        recipient: challenger,
        bps: 5_000,
    }).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: relayer_a }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::new(50_000_000));
}

#[test]
fn test_slash_not_verifier_reverts() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let attacker = deps.api.addr_make("attacker").to_string();
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let info = mock_info(&attacker, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Slash {
        target: relayer_a.clone(),
        recipient: attacker.clone(),
        bps: 10_000,
    }).unwrap_err();
    assert!(matches!(err, ContractError::NotVerifier {}));
}

#[test]
fn test_withdraw_cooldown() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let info = mock_info(&relayer_a, &coins(100_000_000, "untrn"));
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deposit { for_relayer: relayer_a.clone() }).unwrap();
    // Try to withdraw immediately — should fail
    let info = mock_info(&relayer_a, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Withdraw { amount: Uint128::new(10_000_000) }).unwrap_err();
    assert!(matches!(err, ContractError::WithdrawalCooldown {}));
}

#[test]
fn test_withdraw_after_cooldown() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let relayer_a = deps.api.addr_make("relayer_a").to_string();
    let info = mock_info(&relayer_a, &coins(100_000_000, "untrn"));
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deposit { for_relayer: relayer_a.clone() }).unwrap();
    let mut env = mock_env();
    env.block.time = env.block.time.plus_seconds(WITHDRAWAL_COOLDOWN + 1);
    let info = mock_info(&relayer_a, &[]);
    execute(deps.as_mut(), env, info, ExecuteMsg::Withdraw { amount: Uint128::new(10_000_000) }).unwrap();
    let res: Uint128 = cosmwasm_std::from_json(
        query(deps.as_ref(), mock_env(), QueryMsg::Balance { addr: relayer_a }).unwrap()
    ).unwrap();
    assert_eq!(res, Uint128::new(90_000_000));
}

#[test]
fn test_set_verifier_only_deployer() {
    let mut deps = mock_dependencies();
    let deployer = deps.api.addr_make("deployer").to_string();
    let attacker = deps.api.addr_make("attacker").to_string();
    let v = deps.api.addr_make("v").to_string();
    let info = mock_info(&deployer, &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg {}).unwrap();
    let info = mock_info(&attacker, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetVerifier { verifier: v }).unwrap_err();
    assert!(matches!(err, ContractError::NotDeployer {}));
}

#[test]
fn test_set_verifier_once_only() {
    let mut deps = mock_dependencies();
    let deployer = deps.api.addr_make("deployer").to_string();
    let v = deps.api.addr_make("v").to_string();
    let v2 = deps.api.addr_make("v2").to_string();
    let info = mock_info(&deployer, &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg {}).unwrap();
    let info = mock_info(&deployer, &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetVerifier { verifier: v }).unwrap();
    // Deployer is now gone; any further call will fail with NotDeployer (deployer removed)
    let info = mock_info(&deployer, &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetVerifier { verifier: v2 }).unwrap_err();
    assert!(matches!(err, ContractError::NotDeployer {}));
}
