use cosmwasm_std::{
    coins, entry_point, to_json_binary, BankMsg, Binary, CosmosMsg, Deps, DepsMut, Env,
    MessageInfo, Response, StdResult, Uint128,
};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{
    BALANCE, BASIS_POINTS, DEREGISTRATION_THRESHOLD, DEPLOYER, INITIAL_BOND, LAST_ACTIVITY,
    OPERATING_THRESHOLD, VERIFIER, WITHDRAWAL_COOLDOWN,
};

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    _msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    DEPLOYER.save(deps.storage, &info.sender)?;
    Ok(Response::new().add_attribute("action", "instantiate_bond"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SetVerifier { verifier } => execute_set_verifier(deps, info, verifier),
        ExecuteMsg::Deposit { for_relayer } => execute_deposit(deps, env, info, for_relayer),
        ExecuteMsg::Slash { target, recipient, bps } => {
            execute_slash(deps, info, target, recipient, bps)
        }
        ExecuteMsg::Withdraw { amount } => execute_withdraw(deps, env, info, amount),
    }
}

fn execute_set_verifier(
    deps: DepsMut,
    info: MessageInfo,
    verifier: String,
) -> Result<Response, ContractError> {
    // may_load so that a missing deployer (already burned after first call) returns NotDeployer
    // rather than propagating StdError::NotFound.
    let deployer = DEPLOYER.may_load(deps.storage)?.ok_or(ContractError::NotDeployer {})?;
    if info.sender != deployer {
        return Err(ContractError::NotDeployer {});
    }
    if VERIFIER.may_load(deps.storage)?.is_some() {
        return Err(ContractError::VerifierAlreadySet {});
    }
    let addr = deps.api.addr_validate(&verifier)?;
    VERIFIER.save(deps.storage, &addr)?;
    // Zero out deployer so it can never be called again.
    DEPLOYER.remove(deps.storage);
    Ok(Response::new().add_attribute("action", "set_verifier"))
}

fn execute_deposit(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    for_relayer: String,
) -> Result<Response, ContractError> {
    let amount = info
        .funds
        .iter()
        .find(|c| c.denom == "untrn")
        .map(|c| c.amount)
        .ok_or(ContractError::NativeFundsRequired {})?;

    let relayer = deps.api.addr_validate(&for_relayer)?;
    let bal = BALANCE.may_load(deps.storage, &relayer)?.unwrap_or_default();
    BALANCE.save(deps.storage, &relayer, &(bal + amount))?;
    LAST_ACTIVITY.save(deps.storage, &relayer, &env.block.time.seconds())?;

    Ok(Response::new()
        .add_attribute("action", "deposit")
        .add_attribute("for_relayer", relayer.to_string())
        .add_attribute("amount", amount.to_string()))
}

fn execute_slash(
    deps: DepsMut,
    info: MessageInfo,
    target: String,
    recipient: String,
    bps: u64,
) -> Result<Response, ContractError> {
    let verifier = VERIFIER.load(deps.storage)?;
    if info.sender != verifier {
        return Err(ContractError::NotVerifier {});
    }
    let target_addr = deps.api.addr_validate(&target)?;
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    let bal = BALANCE.may_load(deps.storage, &target_addr)?.unwrap_or_default();
    let slash_amount = Uint128::new((bal.u128() * bps as u128) / BASIS_POINTS);

    BALANCE.save(deps.storage, &target_addr, &(bal - slash_amount))?;

    let msgs: Vec<CosmosMsg> = if !slash_amount.is_zero() {
        vec![CosmosMsg::Bank(BankMsg::Send {
            to_address: recipient_addr.to_string(),
            amount: coins(slash_amount.u128(), "untrn"),
        })]
    } else {
        vec![]
    };

    Ok(Response::new()
        .add_messages(msgs)
        .add_attribute("action", "slash")
        .add_attribute("target", target_addr.to_string())
        .add_attribute("recipient", recipient_addr.to_string())
        .add_attribute("amount", slash_amount.to_string()))
}

fn execute_withdraw(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let last = LAST_ACTIVITY
        .may_load(deps.storage, &info.sender)?
        .unwrap_or(0);
    if env.block.time.seconds() < last + WITHDRAWAL_COOLDOWN {
        return Err(ContractError::WithdrawalCooldown {});
    }
    let bal = BALANCE.may_load(deps.storage, &info.sender)?.unwrap_or_default();
    if bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    BALANCE.save(deps.storage, &info.sender, &(bal - amount))?;
    Ok(Response::new()
        .add_message(BankMsg::Send {
            to_address: info.sender.to_string(),
            amount: coins(amount.u128(), "untrn"),
        })
        .add_attribute("action", "withdraw")
        .add_attribute("amount", amount.to_string()))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Balance { addr } => {
            let a = deps.api.addr_validate(&addr)?;
            let bal = BALANCE.may_load(deps.storage, &a)?.unwrap_or_default();
            to_json_binary(&bal)
        }
        QueryMsg::IsAboveInitial { addr } => {
            let a = deps.api.addr_validate(&addr)?;
            let bal = BALANCE.may_load(deps.storage, &a)?.unwrap_or_default();
            to_json_binary(&(bal >= INITIAL_BOND))
        }
        QueryMsg::IsAboveOperating { addr } => {
            let a = deps.api.addr_validate(&addr)?;
            let bal = BALANCE.may_load(deps.storage, &a)?.unwrap_or_default();
            to_json_binary(&(bal >= OPERATING_THRESHOLD))
        }
        QueryMsg::InitialBond {} => to_json_binary(&INITIAL_BOND),
        QueryMsg::OperatingThreshold {} => to_json_binary(&OPERATING_THRESHOLD),
        QueryMsg::DeregistrationThreshold {} => to_json_binary(&DEREGISTRATION_THRESHOLD),
    }
}
