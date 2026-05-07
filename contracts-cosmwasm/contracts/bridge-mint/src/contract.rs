use cosmwasm_std::{
    entry_point, from_json, to_json_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, WasmMsg,
};
use tessera_types::BridgePayload;

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{TUSDC, VERIFIER};

// tUSDC execute message (must match tusdc contract's ExecuteMsg JSON).
#[cosmwasm_schema::cw_serde]
enum TusdcExecute {
    BridgeMintTo { recipient: String, amount: cosmwasm_std::Uint128 },
    BridgeBurnFrom { from: String, amount: cosmwasm_std::Uint128 },
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    let verifier = deps.api.addr_validate(&msg.verifier)?;
    let tusdc = deps.api.addr_validate(&msg.tusdc)?;
    VERIFIER.save(deps.storage, &verifier)?;
    TUSDC.save(deps.storage, &tusdc)?;
    Ok(Response::new().add_attribute("action", "instantiate_bridge_mint"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::OnCrossChainMessage { source_chain_id: _, source_app: _, action: _, payload } => {
            execute_on_cross_chain_message(deps, info, payload)
        }
        ExecuteMsg::Burn { amount, destination_chain_id, destination_app } => {
            execute_burn(deps, info, amount, destination_chain_id, destination_app)
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
    let mint_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: tusdc.to_string(),
        msg: to_json_binary(&TusdcExecute::BridgeMintTo {
            recipient: bridge_payload.recipient,
            amount: bridge_payload.amount,
        })?,
        funds: vec![],
    }
    .into();
    Ok(Response::new()
        .add_message(mint_msg)
        .add_attribute("action", "on_cross_chain_message")
        .add_attribute("amount", bridge_payload.amount.to_string()))
}

fn execute_burn(
    deps: DepsMut,
    info: MessageInfo,
    amount: cosmwasm_std::Uint128,
    destination_chain_id: String,
    destination_app: String,
) -> Result<Response, ContractError> {
    let tusdc = TUSDC.load(deps.storage)?;
    let burn_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: tusdc.to_string(),
        msg: to_json_binary(&TusdcExecute::BridgeBurnFrom {
            from: info.sender.to_string(),
            amount,
        })?,
        funds: vec![],
    }
    .into();
    Ok(Response::new()
        .add_message(burn_msg)
        .add_attribute("action", "burn")
        .add_attribute("amount", amount.to_string())
        .add_attribute("destination_chain_id", destination_chain_id)
        .add_attribute("destination_app", destination_app))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Verifier {} => to_json_binary(&VERIFIER.load(deps.storage)?),
    }
}
