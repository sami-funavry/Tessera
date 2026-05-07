use cosmwasm_std::{
    entry_point, from_json, to_json_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128, WasmMsg,
};
use tessera_types::BridgePayload;

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{TUSDC, VERIFIER};

// tUSDC execute message variants used by bridge-vault.
#[cosmwasm_schema::cw_serde]
enum TusdcExecute {
    Transfer { recipient: String, amount: Uint128 },
    BridgeBurnFrom { from: String, amount: Uint128 },
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    VERIFIER.save(deps.storage, &deps.api.addr_validate(&msg.verifier)?)?;
    TUSDC.save(deps.storage, &deps.api.addr_validate(&msg.tusdc)?)?;
    Ok(Response::new().add_attribute("action", "instantiate_bridge_vault"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::OnCrossChainMessage { payload, .. } => {
            execute_on_cross_chain_message(deps, info, payload)
        }
        ExecuteMsg::Lock { amount, nonce, destination_chain_id, destination_app } => {
            execute_lock(deps, env, info, amount, nonce, destination_chain_id, destination_app)
        }
    }
}

fn execute_on_cross_chain_message(
    deps: DepsMut,
    info: MessageInfo,
    payload: Binary,
) -> Result<Response, ContractError> {
    let verifier = VERIFIER.load(deps.storage)?;
    if info.sender != verifier {
        return Err(ContractError::NotVerifier {});
    }
    let bridge_payload: BridgePayload =
        from_json(&payload).map_err(|_| ContractError::InvalidPayload {})?;
    let tusdc = TUSDC.load(deps.storage)?;
    // Release locked tUSDC to recipient.
    let transfer_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: tusdc.to_string(),
        msg: to_json_binary(&TusdcExecute::Transfer {
            recipient: bridge_payload.recipient.clone(),
            amount: bridge_payload.amount,
        })?,
        funds: vec![],
    }
    .into();
    Ok(Response::new()
        .add_message(transfer_msg)
        .add_attribute("action", "release")
        .add_attribute("recipient", bridge_payload.recipient)
        .add_attribute("amount", bridge_payload.amount.to_string()))
}

fn execute_lock(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
    nonce: u64,
    destination_chain_id: String,
    destination_app: String,
) -> Result<Response, ContractError> {
    let tusdc = TUSDC.load(deps.storage)?;
    // Pull tUSDC from sender into vault.
    let pull_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: tusdc.to_string(),
        msg: to_json_binary(&TusdcExecute::Transfer {
            recipient: _env.contract.address.to_string(),
            amount,
        })?,
        funds: vec![],
    }
    .into();
    Ok(Response::new()
        .add_message(pull_msg)
        .add_attribute("action", "lock")
        .add_attribute("sender", info.sender.to_string())
        .add_attribute("amount", amount.to_string())
        .add_attribute("nonce", nonce.to_string())
        .add_attribute("destination_chain_id", destination_chain_id)
        .add_attribute("destination_app", destination_app))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Verifier {} => to_json_binary(&VERIFIER.load(deps.storage)?),
    }
}
