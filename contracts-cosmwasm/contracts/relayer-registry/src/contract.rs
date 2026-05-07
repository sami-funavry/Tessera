use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult,
};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{
    ACTIVE_LIST, BOND, DEPLOYER, RELAYERS, REREGISTRATION_COOLDOWN, VERIFIER,
    RelayerInfo, RelayerStatus,
};

// Bond query msg must match the bond contract's QueryMsg serialisation.
#[cosmwasm_schema::cw_serde]
enum BondQuery {
    IsAboveInitial { addr: String },
    IsAboveOperating { addr: String },
}

fn is_above_initial(deps: Deps, bond: &Addr, addr: &Addr) -> StdResult<bool> {
    deps.querier.query_wasm_smart(bond, &BondQuery::IsAboveInitial { addr: addr.to_string() })
}

fn is_above_operating(deps: Deps, bond: &Addr, addr: &Addr) -> StdResult<bool> {
    deps.querier.query_wasm_smart(bond, &BondQuery::IsAboveOperating { addr: addr.to_string() })
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    let bond = deps.api.addr_validate(&msg.bond)?;
    BOND.save(deps.storage, &bond)?;
    DEPLOYER.save(deps.storage, &info.sender)?;
    ACTIVE_LIST.save(deps.storage, &vec![])?;
    Ok(Response::new().add_attribute("action", "instantiate_registry"))
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
        ExecuteMsg::Register { pubkey } => execute_register(deps, env, info, pubkey),
        ExecuteMsg::Deregister {} => execute_deregister(deps, env, info),
        ExecuteMsg::RotateKey { pubkey } => execute_rotate_key(deps, info, pubkey),
        ExecuteMsg::RecordSlash { relayer } => execute_record_slash(deps, info, relayer),
    }
}

fn execute_set_verifier(
    deps: DepsMut,
    info: MessageInfo,
    verifier: String,
) -> Result<Response, ContractError> {
    let deployer = DEPLOYER.load(deps.storage)?;
    if info.sender != deployer {
        return Err(ContractError::NotDeployer {});
    }
    if VERIFIER.may_load(deps.storage)?.is_some() {
        return Err(ContractError::VerifierAlreadySet {});
    }
    let addr = deps.api.addr_validate(&verifier)?;
    VERIFIER.save(deps.storage, &addr)?;
    DEPLOYER.remove(deps.storage);
    Ok(Response::new().add_attribute("action", "set_verifier"))
}

fn execute_register(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    pubkey: Vec<u8>,
) -> Result<Response, ContractError> {
    if pubkey.is_empty() {
        return Err(ContractError::ZeroPubkey {});
    }
    let bond = BOND.load(deps.storage)?;
    if !is_above_initial(deps.as_ref(), &bond, &info.sender)? {
        return Err(ContractError::InsufficientBond {});
    }
    // Check existing info.
    if let Some(existing) = RELAYERS.may_load(deps.storage, &info.sender)? {
        match existing.status {
            RelayerStatus::Active => return Err(ContractError::AlreadyRegistered {}),
            RelayerStatus::CoolingDown | RelayerStatus::Deregistered => {
                let elapsed = env.block.time.seconds().saturating_sub(existing.deregistered_at);
                if elapsed < REREGISTRATION_COOLDOWN {
                    return Err(ContractError::RegistrationCooldown {});
                }
            }
            _ => {}
        }
    }
    RELAYERS.save(deps.storage, &info.sender, &RelayerInfo {
        pubkey: pubkey.clone(),
        status: RelayerStatus::Active,
        slash_count: 0,
        deregistered_at: 0,
    })?;
    let mut list = ACTIVE_LIST.load(deps.storage)?;
    list.push(info.sender.clone());
    ACTIVE_LIST.save(deps.storage, &list)?;
    Ok(Response::new()
        .add_attribute("action", "register")
        .add_attribute("relayer", info.sender.to_string()))
}

fn execute_deregister(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let mut relayer = RELAYERS.load(deps.storage, &info.sender).map_err(|_| ContractError::NotRegistered {})?;
    if !matches!(relayer.status, RelayerStatus::Active) {
        return Err(ContractError::NotRegistered {});
    }
    relayer.status = RelayerStatus::CoolingDown;
    relayer.deregistered_at = env.block.time.seconds();
    RELAYERS.save(deps.storage, &info.sender, &relayer)?;
    _remove_from_active(deps, &info.sender)?;
    Ok(Response::new().add_attribute("action", "deregister"))
}

fn execute_rotate_key(
    deps: DepsMut,
    info: MessageInfo,
    pubkey: Vec<u8>,
) -> Result<Response, ContractError> {
    if pubkey.is_empty() {
        return Err(ContractError::ZeroPubkey {});
    }
    let mut relayer = RELAYERS.load(deps.storage, &info.sender).map_err(|_| ContractError::NotActive {})?;
    if !matches!(relayer.status, RelayerStatus::Active) {
        return Err(ContractError::NotActive {});
    }
    relayer.pubkey = pubkey;
    RELAYERS.save(deps.storage, &info.sender, &relayer)?;
    Ok(Response::new().add_attribute("action", "rotate_key"))
}

fn execute_record_slash(
    deps: DepsMut,
    info: MessageInfo,
    relayer: String,
) -> Result<Response, ContractError> {
    let verifier = VERIFIER.load(deps.storage)?;
    if info.sender != verifier {
        return Err(ContractError::NotVerifier {});
    }
    let relayer_addr = deps.api.addr_validate(&relayer)?;
    let bond = BOND.load(deps.storage)?;
    let mut info_r = RELAYERS.load(deps.storage, &relayer_addr).map_err(|_| ContractError::NotRegistered {})?;
    info_r.slash_count += 1;

    // Check bond threshold and transition state.
    if !is_above_operating(deps.as_ref(), &bond, &relayer_addr)? {
        info_r.status = RelayerStatus::Benched;
        _remove_from_active_addr(deps.storage, &relayer_addr);
    }
    RELAYERS.save(deps.storage, &relayer_addr, &info_r)?;
    Ok(Response::new().add_attribute("action", "record_slash"))
}

fn _remove_from_active(deps: DepsMut, addr: &Addr) -> Result<(), ContractError> {
    _remove_from_active_addr(deps.storage, addr);
    Ok(())
}

fn _remove_from_active_addr(storage: &mut dyn cosmwasm_std::Storage, addr: &Addr) {
    if let Ok(mut list) = ACTIVE_LIST.load(storage) {
        if let Some(pos) = list.iter().position(|a| a == addr) {
            list.swap_remove(pos);
            let _ = ACTIVE_LIST.save(storage, &list);
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::ActiveCount {} => {
            let list = ACTIVE_LIST.load(deps.storage)?;
            to_json_binary(&(list.len() as u64))
        }
        QueryMsg::RelayerAt { index } => {
            let list = ACTIVE_LIST.load(deps.storage)?;
            let idx = index as usize;
            if idx >= list.len() {
                return Err(cosmwasm_std::StdError::generic_err("index out of range"));
            }
            to_json_binary(&list[idx])
        }
        QueryMsg::IsActive { addr } => {
            let a = deps.api.addr_validate(&addr)?;
            let active = RELAYERS.may_load(deps.storage, &a)?
                .map(|r| matches!(r.status, RelayerStatus::Active))
                .unwrap_or(false);
            to_json_binary(&active)
        }
    }
}
