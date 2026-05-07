use cosmwasm_std::{
    entry_point, to_json_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, Response,
    StdResult, WasmMsg,
};
use tessera_types::{message_id, submission_id, IAppExecuteMsg, MessageEnvelope};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg, SubmissionResponse};
use crate::state::{
    ABSENCE_SLASH_CLAIMED, BOND, CHALLENGE_WINDOW, EXECUTED_MESSAGES,
    HANDOVER_PERIOD, REGISTRY, SUBMISSIONS, Submission, SubmissionStatus,
};

// Bond execute variants used by Verifier.
#[cosmwasm_schema::cw_serde]
enum BondExecute {
    Slash { target: String, recipient: String, bps: u64 },
}

// Registry query variants used by Verifier.
#[cosmwasm_schema::cw_serde]
enum RegistryQuery {
    ActiveCount {},
    RelayerAt { index: u64 },
    IsActive { addr: String },
}

fn registry_active_count(deps: Deps, registry: &cosmwasm_std::Addr) -> StdResult<u64> {
    deps.querier.query_wasm_smart(registry, &RegistryQuery::ActiveCount {})
}

fn registry_relayer_at(deps: Deps, registry: &cosmwasm_std::Addr, index: u64) -> StdResult<cosmwasm_std::Addr> {
    deps.querier.query_wasm_smart(registry, &RegistryQuery::RelayerAt { index })
}

fn registry_is_active(deps: Deps, registry: &cosmwasm_std::Addr, addr: &str) -> StdResult<bool> {
    deps.querier
        .query_wasm_smart(registry, &RegistryQuery::IsActive { addr: addr.to_string() })
}

/// Stub: any non-empty proof is considered valid (real IAVL verification in P-4).
fn _verify_proof(_fingerprint: &str, _msg_id: &str, proof: &Binary) -> bool {
    !proof.is_empty()
}

fn slash_msg(bond: &cosmwasm_std::Addr, target: &str, recipient: &str, bps: u64) -> StdResult<CosmosMsg> {
    Ok(WasmMsg::Execute {
        contract_addr: bond.to_string(),
        msg: to_json_binary(&BondExecute::Slash {
            target: target.to_string(),
            recipient: recipient.to_string(),
            bps,
        })?,
        funds: vec![],
    }
    .into())
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    BOND.save(deps.storage, &deps.api.addr_validate(&msg.bond)?)?;
    REGISTRY.save(deps.storage, &deps.api.addr_validate(&msg.registry)?)?;
    Ok(Response::new().add_attribute("action", "instantiate_verifier"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SubmitMessage { envelope, fingerprint, event_timestamp } => {
            execute_submit_message(deps, env, info, envelope, fingerprint, event_timestamp)
        }
        ExecuteMsg::Challenge { submission_id: sub_id, correct_fingerprint, evidence_proof } => {
            execute_challenge(deps, env, info, sub_id, correct_fingerprint, evidence_proof)
        }
        ExecuteMsg::ExecuteMessage { submission_id: sub_id, proof } => {
            execute_message(deps, env, sub_id, proof)
        }
        ExecuteMsg::ClaimAbsenceSlash { submission_id: sub_id } => {
            execute_claim_absence_slash(deps, info, sub_id)
        }
    }
}

fn execute_submit_message(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    envelope: MessageEnvelope,
    fingerprint: String,
    event_timestamp: u64,
) -> Result<Response, ContractError> {
    let registry = REGISTRY.load(deps.storage)?;
    if !registry_is_active(deps.as_ref(), &registry, info.sender.as_str())? {
        return Err(ContractError::NotActiveRelayer {});
    }
    let msg_id = message_id(&envelope);
    if EXECUTED_MESSAGES.may_load(deps.storage, &msg_id)?.unwrap_or(false) {
        return Err(ContractError::MessageAlreadyExecuted {});
    }
    let now = env.block.time.nanos();
    let sub_id = submission_id(&msg_id, info.sender.as_str(), now);
    let submission = Submission {
        message_id: msg_id.clone(),
        envelope,
        fingerprint: fingerprint.clone(),
        submitter: info.sender.clone(),
        event_timestamp,
        submitted_at: env.block.time.seconds(),
        status: SubmissionStatus::Pending,
    };
    SUBMISSIONS.save(deps.storage, &sub_id, &submission)?;
    Ok(Response::new()
        .add_attribute("action", "submit_message")
        .add_attribute("submission_id", sub_id)
        .add_attribute("message_id", msg_id)
        .add_attribute("submitter", info.sender.to_string()))
}

fn execute_challenge(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sub_id: String,
    correct_fingerprint: String,
    evidence_proof: Binary,
) -> Result<Response, ContractError> {
    let mut sub = SUBMISSIONS.load(deps.storage, &sub_id)?;
    if sub.status != SubmissionStatus::Pending {
        return Err(ContractError::NotPending {});
    }
    let now = env.block.time.seconds();
    if now > sub.submitted_at + CHALLENGE_WINDOW {
        return Err(ContractError::ChallengeWindowClosed {});
    }
    let bond = BOND.load(deps.storage)?;
    let evidence_valid = _verify_proof(&correct_fingerprint, &sub.message_id, &evidence_proof);
    let msgs = if evidence_valid && sub.fingerprint != correct_fingerprint {
        // Challenger wins: submitter slashed 50%, reward to challenger.
        sub.status = SubmissionStatus::Slashed;
        vec![slash_msg(&bond, sub.submitter.as_str(), info.sender.as_str(), 5_000)?]
    } else {
        // Frivolous challenge: challenger slashed 25%, reward to submitter.
        sub.status = SubmissionStatus::Pending; // submission survives
        vec![slash_msg(&bond, info.sender.as_str(), sub.submitter.as_str(), 2_500)?]
    };
    SUBMISSIONS.save(deps.storage, &sub_id, &sub)?;
    Ok(Response::new()
        .add_messages(msgs)
        .add_attribute("action", "challenge")
        .add_attribute("submission_id", sub_id))
}

fn execute_message(
    deps: DepsMut,
    env: Env,
    sub_id: String,
    proof: Binary,
) -> Result<Response, ContractError> {
    let mut sub = SUBMISSIONS.load(deps.storage, &sub_id)?;
    if sub.status != SubmissionStatus::Pending {
        return Err(ContractError::NotPending {});
    }
    if env.block.time.seconds() <= sub.submitted_at + CHALLENGE_WINDOW {
        return Err(ContractError::ChallengeWindowOpen {});
    }
    if EXECUTED_MESSAGES.may_load(deps.storage, &sub.message_id)?.unwrap_or(false) {
        return Err(ContractError::MessageAlreadyExecuted {});
    }
    if !_verify_proof(&sub.fingerprint, &sub.message_id, &proof) {
        return Err(ContractError::InvalidProof {});
    }
    sub.status = SubmissionStatus::Executed;
    SUBMISSIONS.save(deps.storage, &sub_id, &sub)?;
    EXECUTED_MESSAGES.save(deps.storage, &sub.message_id, &true)?;

    // Dispatch to destination app.
    let dest_app = sub.envelope.destination_app.clone();
    let dispatch_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: dest_app.clone(),
        msg: to_json_binary(&IAppExecuteMsg::OnCrossChainMessage {
            source_chain_id: sub.envelope.source_chain_id.clone(),
            source_app: sub.envelope.source_app.clone(),
            action: sub.envelope.action,
            payload: sub.envelope.payload.clone(),
        })?,
        funds: vec![],
    }
    .into();
    Ok(Response::new()
        .add_message(dispatch_msg)
        .add_attribute("action", "execute_message")
        .add_attribute("submission_id", sub_id)
        .add_attribute("destination_app", dest_app))
}

fn execute_claim_absence_slash(
    deps: DepsMut,
    info: MessageInfo,
    sub_id: String,
) -> Result<Response, ContractError> {
    let sub = SUBMISSIONS.load(deps.storage, &sub_id)?;
    if sub.status != SubmissionStatus::Executed {
        return Err(ContractError::NotPending {});
    }
    if sub.submitted_at < sub.event_timestamp + HANDOVER_PERIOD {
        return Err(ContractError::HandoverNotElapsed {});
    }
    if ABSENCE_SLASH_CLAIMED.may_load(deps.storage, &sub_id)?.unwrap_or(false) {
        return Err(ContractError::AbsenceAlreadyClaimed {});
    }
    let registry = REGISTRY.load(deps.storage)?;
    let count = registry_active_count(deps.as_ref(), &registry)?;
    if count == 0 {
        return Err(ContractError::RegistryEmpty {});
    }
    let original_index = sub.envelope.nonce % count;
    let original_assignee = registry_relayer_at(deps.as_ref(), &registry, original_index)?;
    if original_assignee == sub.submitter {
        return Err(ContractError::SubmitterWasOriginalAssignee {});
    }
    ABSENCE_SLASH_CLAIMED.save(deps.storage, &sub_id, &true)?;
    let bond = BOND.load(deps.storage)?;
    let slash = slash_msg(&bond, original_assignee.as_str(), info.sender.as_str(), 5_000)?;
    Ok(Response::new()
        .add_message(slash)
        .add_attribute("action", "claim_absence_slash")
        .add_attribute("slashed", original_assignee.to_string())
        .add_attribute("recipient", info.sender.to_string()))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetSubmission { submission_id: sub_id } => {
            let sub = SUBMISSIONS.load(deps.storage, &sub_id)?;
            let resp = SubmissionResponse {
                submission_id: sub_id,
                message_id: sub.message_id,
                submitter: sub.submitter.to_string(),
                fingerprint: sub.fingerprint,
                event_timestamp: sub.event_timestamp,
                submitted_at: sub.submitted_at,
                status: format!("{:?}", sub.status),
            };
            to_json_binary(&resp)
        }
        QueryMsg::IsExecuted { message_id: msg_id } => {
            let executed = EXECUTED_MESSAGES.may_load(deps.storage, &msg_id)?.unwrap_or(false);
            to_json_binary(&executed)
        }
    }
}
