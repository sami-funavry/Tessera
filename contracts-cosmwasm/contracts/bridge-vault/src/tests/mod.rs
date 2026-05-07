use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockApi};
use cosmwasm_std::{to_json_binary, Addr, Uint128};
use tessera_types::BridgePayload;

use crate::contract::{execute, instantiate};
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg};

fn a(name: &str) -> Addr {
    MockApi::default().addr_make(name)
}

#[test]
fn test_on_cross_chain_message_not_verifier() {
    let mut deps = mock_dependencies();
    let info = mock_info(a("admin").as_str(), &[]);
    instantiate(deps.as_mut(), mock_env(), info, InstantiateMsg {
        verifier: a("verifier").to_string(),
        tusdc: a("tusdc").to_string(),
    }).unwrap();
    let payload = to_json_binary(&BridgePayload {
        recipient: a("user1").to_string(),
        amount: Uint128::new(500_000_000),
        nonce: 0,
    }).unwrap();
    let info = mock_info(a("attacker").as_str(), &[]);
    let err = execute(deps.as_mut(), mock_env(), info, ExecuteMsg::OnCrossChainMessage {
        source_chain_id: "neutron".to_string(),
        source_app: "bridge_mint".to_string(),
        action: [0u8; 4],
        payload,
    }).unwrap_err();
    assert!(matches!(err, ContractError::NotVerifier {}));
}
