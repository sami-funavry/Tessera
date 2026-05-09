use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
    Uint128,
};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg, TokenInfoResponse};
use crate::state::{
    BALANCES, BRIDGE_MINT, CLAIM_AMOUNT, CLAIM_COOLDOWN, LAST_CLAIM, OWNER, TOTAL_SUPPLY,
};

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    TOTAL_SUPPLY.save(deps.storage, &Uint128::zero())?;
    Ok(Response::new().add_attribute("action", "instantiate_tusdc"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SetBridgeMint { bridge_mint } => {
            execute_set_bridge_mint(deps, info, bridge_mint)
        }
        ExecuteMsg::Claim {} => execute_claim(deps, env, info),
        ExecuteMsg::BridgeMintTo { recipient, amount } => {
            execute_bridge_mint_to(deps, info, recipient, amount)
        }
        ExecuteMsg::BridgeBurnFrom { from, amount } => {
            execute_bridge_burn_from(deps, info, from, amount)
        }
        ExecuteMsg::Transfer { recipient, amount } => {
            execute_transfer(deps, info, recipient, amount)
        }
    }
}

fn execute_set_bridge_mint(
    deps: DepsMut,
    info: MessageInfo,
    bridge_mint: String,
) -> Result<Response, ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::NotOwner {});
    }
    if BRIDGE_MINT.may_load(deps.storage)?.is_some() {
        return Err(ContractError::BridgeMintAlreadySet {});
    }
    let addr = deps.api.addr_validate(&bridge_mint)?;
    BRIDGE_MINT.save(deps.storage, &addr)?;
    Ok(Response::new().add_attribute("action", "set_bridge_mint"))
}

fn execute_claim(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let now = env.block.time.seconds();
    let last = LAST_CLAIM.may_load(deps.storage, &info.sender)?.unwrap_or(0);
    if last != 0 {
        let next = last + CLAIM_COOLDOWN;
        if now < next {
            return Err(ContractError::ClaimTooSoon { next_ts: next });
        }
    }
    LAST_CLAIM.save(deps.storage, &info.sender, &now)?;
    _mint(deps, &info.sender, CLAIM_AMOUNT)?;
    Ok(Response::new()
        .add_attribute("action", "claim")
        .add_attribute("recipient", info.sender.to_string())
        .add_attribute("amount", CLAIM_AMOUNT.to_string()))
}

fn execute_bridge_mint_to(
    deps: DepsMut,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let bridge_mint = BRIDGE_MINT.load(deps.storage)?;
    if info.sender != bridge_mint {
        return Err(ContractError::NotBridgeMint {});
    }
    let to = deps.api.addr_validate(&recipient)?;
    _mint(deps, &to, amount)?;
    Ok(Response::new()
        .add_attribute("action", "bridge_mint_to")
        .add_attribute("recipient", to.to_string())
        .add_attribute("amount", amount.to_string()))
}

fn execute_bridge_burn_from(
    deps: DepsMut,
    info: MessageInfo,
    from: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let bridge_mint = BRIDGE_MINT.load(deps.storage)?;
    if info.sender != bridge_mint {
        return Err(ContractError::NotBridgeMint {});
    }
    let from_addr = deps.api.addr_validate(&from)?;
    _burn(deps, &from_addr, amount)?;
    Ok(Response::new()
        .add_attribute("action", "bridge_burn_from")
        .add_attribute("from", from_addr.to_string())
        .add_attribute("amount", amount.to_string()))
}

fn execute_transfer(
    deps: DepsMut,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let to = deps.api.addr_validate(&recipient)?;
    let bal = BALANCES
        .may_load(deps.storage, &info.sender)?
        .unwrap_or_default();
    if bal < amount {
        return Err(ContractError::InsufficientFunds { need: amount, have: bal });
    }
    BALANCES.save(deps.storage, &info.sender, &(bal - amount))?;
    let to_bal = BALANCES.may_load(deps.storage, &to)?.unwrap_or_default();
    BALANCES.save(deps.storage, &to, &(to_bal + amount))?;
    Ok(Response::new().add_attribute("action", "transfer"))
}

fn _mint(deps: DepsMut, to: &cosmwasm_std::Addr, amount: Uint128) -> StdResult<()> {
    let bal = BALANCES.may_load(deps.storage, to)?.unwrap_or_default();
    BALANCES.save(deps.storage, to, &(bal + amount))?;
    let supply = TOTAL_SUPPLY.load(deps.storage)?;
    TOTAL_SUPPLY.save(deps.storage, &(supply + amount))?;
    Ok(())
}

fn _burn(deps: DepsMut, from: &cosmwasm_std::Addr, amount: Uint128) -> Result<(), ContractError> {
    let bal = BALANCES.may_load(deps.storage, from)?.unwrap_or_default();
    if bal < amount {
        return Err(ContractError::InsufficientFunds { need: amount, have: bal });
    }
    BALANCES.save(deps.storage, from, &(bal - amount))?;
    let supply = TOTAL_SUPPLY.load(deps.storage)?;
    TOTAL_SUPPLY.save(deps.storage, &(supply - amount))?;
    Ok(())
}

/// Admin-only state-preserving upgrade. Used to rotate the authorised
/// `BRIDGE_MINT` to a new bridge-mint contract address without redeploying
/// tusdc (which would strand all existing token balances). The contract's
/// admin (set at instantiate) is enforced by wasmd at the message layer —
/// only the admin can submit a `MsgMigrateContract`, so we don't re-check
/// `info.sender` here.
///
/// All other state (BALANCES, TOTAL_SUPPLY, OWNER, CLAIM_*) is preserved
/// untouched.
#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, msg: MigrateMsg) -> Result<Response, ContractError> {
    let new_bridge_mint = deps.api.addr_validate(&msg.bridge_mint)?;
    BRIDGE_MINT.save(deps.storage, &new_bridge_mint)?;
    Ok(Response::new()
        .add_attribute("action", "migrate_tusdc")
        .add_attribute("new_bridge_mint", new_bridge_mint))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Balance { addr } => {
            let a = deps.api.addr_validate(&addr)?;
            let bal = BALANCES.may_load(deps.storage, &a)?.unwrap_or_default();
            to_json_binary(&bal)
        }
        QueryMsg::TotalSupply {} => {
            let supply = TOTAL_SUPPLY.load(deps.storage)?;
            to_json_binary(&supply)
        }
        QueryMsg::TokenInfo {} => {
            let supply = TOTAL_SUPPLY.load(deps.storage)?;
            to_json_binary(&TokenInfoResponse {
                name: "Tessera USDC".to_string(),
                symbol: "tUSDC".to_string(),
                decimals: 6,
                total_supply: supply,
            })
        }
    }
}
