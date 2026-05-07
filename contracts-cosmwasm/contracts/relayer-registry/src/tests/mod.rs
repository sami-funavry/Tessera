use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockApi};
use cosmwasm_std::{from_json, Addr};

use crate::contract::{execute, instantiate, query};
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};

fn a(name: &str) -> Addr {
    MockApi::default().addr_make(name)
}

// We cannot call real bond contract in unit tests — use mock querier returning true.
// Full integration (bond + registry together) is in verifier integration tests.

fn setup(deps: &mut cosmwasm_std::OwnedDeps<
    cosmwasm_std::MemoryStorage,
    cosmwasm_std::testing::MockApi,
    cosmwasm_std::testing::MockQuerier,
>) {
    let deployer = a("deployer");
    let info = mock_info(deployer.as_str(), &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg {
        bond: a("bond").to_string(),
    }).unwrap();
    let info = mock_info(deployer.as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::SetVerifier {
        verifier: a("verifier").to_string(),
    }).unwrap();
}

fn mock_bond_true(deps: &mut cosmwasm_std::OwnedDeps<
    cosmwasm_std::MemoryStorage,
    cosmwasm_std::testing::MockApi,
    cosmwasm_std::testing::MockQuerier,
>) {
    deps.querier.update_wasm(|_req| {
        use cosmwasm_std::{ContractResult, SystemResult, to_json_binary};
        SystemResult::Ok(ContractResult::Ok(to_json_binary(&true).unwrap()))
    });
}

#[test]
fn test_register_deregister_count() {
    let mut deps = mock_dependencies();
    mock_bond_true(&mut deps);
    setup(&mut deps);

    let info = mock_info(a("relayer_a").as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Register { pubkey: vec![0xaa] }).unwrap();
    let info = mock_info(a("relayer_b").as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Register { pubkey: vec![0xbb] }).unwrap();

    let count: u64 = from_json(query(deps.as_ref(), mock_env(), QueryMsg::ActiveCount {}).unwrap()).unwrap();
    assert_eq!(count, 2);

    let info = mock_info(a("relayer_a").as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Deregister {}).unwrap();
    let count: u64 = from_json(query(deps.as_ref(), mock_env(), QueryMsg::ActiveCount {}).unwrap()).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_zero_pubkey_reverts() {
    let mut deps = mock_dependencies();
    mock_bond_true(&mut deps);
    setup(&mut deps);
    let info = mock_info(a("relayer_a").as_str(), &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Register { pubkey: vec![] }).unwrap_err();
    assert!(matches!(err, ContractError::ZeroPubkey {}));
}

#[test]
fn test_record_slash_not_verifier() {
    let mut deps = mock_dependencies();
    setup(&mut deps);
    let info = mock_info(a("attacker").as_str(), &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::RecordSlash {
        relayer: a("relayer_a").to_string(),
    }).unwrap_err();
    assert!(matches!(err, ContractError::NotVerifier {}));
}

#[test]
fn test_rotate_key() {
    let mut deps = mock_dependencies();
    mock_bond_true(&mut deps);
    setup(&mut deps);
    let info = mock_info(a("relayer_a").as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Register { pubkey: vec![0xaa] }).unwrap();
    let info = mock_info(a("relayer_a").as_str(), &[]);
    execute(deps.as_mut(), mock_env(), info, ExecuteMsg::RotateKey { pubkey: vec![0xcc] }).unwrap();
}
