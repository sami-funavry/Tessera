/// Integration tests for all four Tessera demo scenarios (R-30 to R-33).
///
/// S-1: Honest delivery  — relayer A submits valid proof; executes; user receives tokens.
/// S-2: Lying relayer    — relayer A submits wrong fingerprint; B challenges; A slashed 50%.
/// S-3: Silent relayer   — A silent past 30s; B submits after handover; A slashed 50%.
/// S-4: Frivolous challenge — B files baseless challenge; B slashed 25%; message executes.
use cosmwasm_std::{coins, testing::MockApi, to_json_binary, Addr, Uint128};
use cw_multi_test::{App, AppBuilder, ContractWrapper, Executor};
use sha2::{Digest, Sha256};
use tessera_types::{BridgePayload, MessageEnvelope};
// hex is a direct dep of the verifier crate — available in tests too.

fn a(name: &str) -> Addr {
    MockApi::default().addr_make(name)
}

use crate::msg::{ExecuteMsg as VerifierExecute, InstantiateMsg as VerifierInstantiateMsg};

// ── helpers to extract submission_id from tx response ────────────────────────

fn extract_attr(res: &cw_multi_test::AppResponse, key: &str) -> String {
    res.events
        .iter()
        .flat_map(|e| e.attributes.iter())
        .find(|a| a.key == key)
        .map(|a| a.value.clone())
        .unwrap_or_else(|| panic!("attribute '{key}' not found in response"))
}

// ── test helpers ──────────────────────────────────────────────────────────────

struct Setup {
    app: App,
    tusdc: Addr,
    bond: Addr,
    registry: Addr,
    bridge_mint: Addr,
    verifier: Addr,
    relayer_a: Addr,
    relayer_b: Addr,
    user: Addr,
}

fn build_setup() -> Setup {
    let relayer_a = a("relayer_a");
    let relayer_b = a("relayer_b");
    let user = a("user");
    let admin = a("admin");

    let mut app = AppBuilder::new().build(|router, _api, storage| {
        router
            .bank
            .init_balance(storage, &relayer_a, coins(10_000_000_000, "untrn"))
            .unwrap();
        router
            .bank
            .init_balance(storage, &relayer_b, coins(10_000_000_000, "untrn"))
            .unwrap();
    });

    // Store contract codes.
    let tusdc_code = app.store_code(Box::new(ContractWrapper::new(
        tusdc::contract::execute,
        tusdc::contract::instantiate,
        tusdc::contract::query,
    )));
    let bond_code = app.store_code(Box::new(ContractWrapper::new(
        bond::contract::execute,
        bond::contract::instantiate,
        bond::contract::query,
    )));
    let registry_code = app.store_code(Box::new(ContractWrapper::new(
        relayer_registry::contract::execute,
        relayer_registry::contract::instantiate,
        relayer_registry::contract::query,
    )));
    let bridge_mint_code = app.store_code(Box::new(ContractWrapper::new(
        bridge_mint::contract::execute,
        bridge_mint::contract::instantiate,
        bridge_mint::contract::query,
    )));
    let verifier_code = app.store_code(Box::new(ContractWrapper::new(
        crate::contract::execute,
        crate::contract::instantiate,
        crate::contract::query,
    )));

    // Instantiate.
    let tusdc = app
        .instantiate_contract(
            tusdc_code,
            admin.clone(),
            &tusdc::msg::InstantiateMsg { owner: admin.to_string() },
            &[],
            "tUSDC",
            None,
        )
        .unwrap();

    let bond = app
        .instantiate_contract(
            bond_code,
            admin.clone(),
            &bond::msg::InstantiateMsg {},
            &[],
            "Bond",
            None,
        )
        .unwrap();

    let registry = app
        .instantiate_contract(
            registry_code,
            admin.clone(),
            &relayer_registry::msg::InstantiateMsg { bond: bond.to_string() },
            &[],
            "Registry",
            None,
        )
        .unwrap();

    let verifier = app
        .instantiate_contract(
            verifier_code,
            admin.clone(),
            &VerifierInstantiateMsg {
                bond: bond.to_string(),
                registry: registry.to_string(),
            },
            &[],
            "Verifier",
            None,
        )
        .unwrap();

    let bridge_mint = app
        .instantiate_contract(
            bridge_mint_code,
            admin.clone(),
            &bridge_mint::msg::InstantiateMsg {
                verifier: verifier.to_string(),
                tusdc: tusdc.to_string(),
            },
            &[],
            "BridgeMint",
            None,
        )
        .unwrap();

    // Wire: set_verifier in bond and registry.
    app.execute_contract(
        admin.clone(),
        bond.clone(),
        &bond::msg::ExecuteMsg::SetVerifier { verifier: verifier.to_string() },
        &[],
    )
    .unwrap();
    app.execute_contract(
        admin.clone(),
        registry.clone(),
        &relayer_registry::msg::ExecuteMsg::SetVerifier { verifier: verifier.to_string() },
        &[],
    )
    .unwrap();

    // Set bridge_mint in tusdc.
    app.execute_contract(
        admin.clone(),
        tusdc.clone(),
        &tusdc::msg::ExecuteMsg::SetBridgeMint { bridge_mint: bridge_mint.to_string() },
        &[],
    )
    .unwrap();

    // Deposit bond for both relayers (100 NTRN = 100_000_000 uNTRN).
    let deposit = coins(100_000_000, "untrn");
    app.execute_contract(
        relayer_a.clone(),
        bond.clone(),
        &bond::msg::ExecuteMsg::Deposit { for_relayer: relayer_a.to_string() },
        &deposit,
    )
    .unwrap();
    app.execute_contract(
        relayer_b.clone(),
        bond.clone(),
        &bond::msg::ExecuteMsg::Deposit { for_relayer: relayer_b.to_string() },
        &deposit,
    )
    .unwrap();

    // Register both relayers.
    app.execute_contract(
        relayer_a.clone(),
        registry.clone(),
        &relayer_registry::msg::ExecuteMsg::Register { pubkey: vec![0xaa, 0xbb] },
        &[],
    )
    .unwrap();
    app.execute_contract(
        relayer_b.clone(),
        registry.clone(),
        &relayer_registry::msg::ExecuteMsg::Register { pubkey: vec![0xcc, 0xdd] },
        &[],
    )
    .unwrap();

    Setup { app, tusdc, bond, registry, bridge_mint, verifier, relayer_a, relayer_b, user }
}

fn make_envelope(nonce: u64, dest_app: &Addr) -> MessageEnvelope {
    MessageEnvelope {
        source_chain_id: "11155111".to_string(),     // Sepolia
        source_app: "vault_on_sepolia".to_string(),
        destination_chain_id: "pion-1".to_string(),  // Neutron
        destination_app: dest_app.to_string(),
        action: [0u8; 4],
        payload: to_json_binary(&BridgePayload {
            // Must be valid bech32 — bridge-mint passes this straight to tusdc.addr_validate.
            recipient: a("user").to_string(),
            amount: Uint128::new(500_000_000), // 500 tUSDC (6 decimals)
            nonce,
        })
        .unwrap(),
        nonce,
    }
}

/// Build a depth-0 TesseraProof in SHA-256 / Neutron format (flags = 1).
///
/// Returns (proof_bytes, hex_fingerprint) where:
///   proof_bytes is the canonical TesseraProof wire encoding
///   hex_fingerprint is the expected fingerprint string to pass to SubmitMessage
///
/// The msg_id_str must match `tessera_types::message_id(&envelope)`.
fn make_tessera_proof(msg_id_str: &str) -> (Vec<u8>, String) {
    // msgId = sha256(msg_id_str)
    let msg_id_bytes: [u8; 32] = Sha256::digest(msg_id_str.as_bytes()).into();
    let leaf_key = [0u8; 32];
    let leaf_value = [0u8; 32];
    let depth: u32 = 0;

    // Wire format: "TSSP" || flags(1 BE u32) || msgId || leafKey || leafValue || depth
    let mut proof = Vec::with_capacity(108);
    proof.extend_from_slice(b"TSSP");
    proof.extend_from_slice(&1u32.to_be_bytes()); // flags = 1 (SHA-256)
    proof.extend_from_slice(&msg_id_bytes);
    proof.extend_from_slice(&leaf_key);
    proof.extend_from_slice(&leaf_value);
    proof.extend_from_slice(&depth.to_be_bytes());

    // Root = sha256(0x00 || msgId || leafKey || leafValue) for depth 0
    let mut hasher = Sha256::new();
    hasher.update([0x00u8]);
    hasher.update(msg_id_bytes);
    hasher.update(leaf_key);
    hasher.update(leaf_value);
    let root = hasher.finalize();

    (proof, hex::encode(root))
}

// ── S-1: Honest delivery (R-30) ───────────────────────────────────────────────

#[test]
fn test_s1_honest_delivery() {
    let Setup { mut app, tusdc, bond, registry: _, bridge_mint, verifier, relayer_a, relayer_b: _, user } =
        build_setup();

    let env = make_envelope(0, &bridge_mint);
    // nonce=0: msg_id = "msg:11155111:vault_on_sepolia:0"
    let (proof_bytes, fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    let event_ts = app.block_info().time.seconds();

    // nonce=0, 2 relayers: index = 0 % 2 = 0 → relayer_a is assigned.
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: fp,
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");

    // Advance past challenge window (60 s).
    app.update_block(|b| b.time = b.time.plus_seconds(61));

    // Execute — dispatches to bridge_mint → tusdc.
    app.execute_contract(
        a("anyone"),
        verifier.clone(),
        &VerifierExecute::ExecuteMessage {
            submission_id: sub_id,
            proof: proof_bytes.into(),
        },
        &[],
    )
    .unwrap();

    // User receives 500 tUSDC.
    let balance: Uint128 = app
        .wrap()
        .query_wasm_smart(tusdc, &tusdc::msg::QueryMsg::Balance { addr: a("user").to_string() })
        .unwrap();
    assert_eq!(balance, Uint128::new(500_000_000), "user should receive 500 tUSDC");

    // relayer_a bond intact.
    let bond_bal: Uint128 = app
        .wrap()
        .query_wasm_smart(bond, &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    assert_eq!(bond_bal, Uint128::new(100_000_000), "relayer_a bond should be intact");
}

// ── S-2: Lying relayer (R-31) ─────────────────────────────────────────────────

#[test]
fn test_s2_lying_relayer() {
    let Setup { mut app, tusdc: _, bond, registry: _, bridge_mint, verifier, relayer_a, relayer_b, user: _ } =
        build_setup();

    let env = make_envelope(0, &bridge_mint);
    // Correct proof and fingerprint for this message.
    let (correct_proof, correct_fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    // lie_fp is any hex string that differs from correct_fp.
    let lie_fp = "0".repeat(64);
    let event_ts = app.block_info().time.seconds();

    // relayer_a submits with wrong fingerprint.
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: lie_fp,
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");

    let a_bal_before: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    let b_native_before = app.wrap().query_balance(relayer_b.clone(), "untrn").unwrap().amount;

    // relayer_b challenges with the correct fingerprint and a valid proof.
    app.execute_contract(
        relayer_b.clone(),
        verifier.clone(),
        &VerifierExecute::Challenge {
            submission_id: sub_id,
            correct_fingerprint: correct_fp,
            evidence_proof: correct_proof.into(),
        },
        &[],
    )
    .unwrap();

    // relayer_a slashed 50%.
    let a_bal_after: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    let expected_slash = a_bal_before * Uint128::new(5_000) / Uint128::new(10_000);
    assert_eq!(a_bal_after, a_bal_before - expected_slash, "relayer_a should lose 50%");

    // relayer_b receives slash reward as native untrn.
    let b_native_after = app.wrap().query_balance(relayer_b.clone(), "untrn").unwrap().amount;
    assert_eq!(b_native_after, b_native_before + expected_slash, "relayer_b should gain 50%");
}

// ── S-3: Silent relayer (R-32) ────────────────────────────────────────────────

#[test]
fn test_s3_silent_relayer() {
    let Setup { mut app, tusdc, bond, registry: _, bridge_mint, verifier, relayer_a, relayer_b, user } =
        build_setup();

    // nonce=0 → original assignee = relayer_a (index 0 % 2 = 0).
    let env = make_envelope(0, &bridge_mint);
    let (proof_bytes, fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    let event_ts = app.block_info().time.seconds();

    // Advance past handover period (30 s) — relayer_a was silent.
    app.update_block(|b| b.time = b.time.plus_seconds(31));

    // relayer_b submits as successor.
    let res = app
        .execute_contract(
            relayer_b.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: fp,
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");

    // Advance past challenge window.
    app.update_block(|b| b.time = b.time.plus_seconds(61));

    // Execute — user receives tokens.
    app.execute_contract(
        a("anyone"),
        verifier.clone(),
        &VerifierExecute::ExecuteMessage {
            submission_id: sub_id.clone(),
            proof: proof_bytes.into(),
        },
        &[],
    )
    .unwrap();

    let balance: Uint128 = app
        .wrap()
        .query_wasm_smart(tusdc, &tusdc::msg::QueryMsg::Balance { addr: a("user").to_string() })
        .unwrap();
    assert_eq!(balance, Uint128::new(500_000_000), "user should receive 500 tUSDC");

    let a_bal_before: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    let b_native_before = app.wrap().query_balance(relayer_b.clone(), "untrn").unwrap().amount;

    // Claim absence slash — relayer_a slashed 50%, relayer_b receives.
    app.execute_contract(
        relayer_b.clone(),
        verifier.clone(),
        &VerifierExecute::ClaimAbsenceSlash { submission_id: sub_id },
        &[],
    )
    .unwrap();

    let a_bal_after: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    let expected_slash = a_bal_before * Uint128::new(5_000) / Uint128::new(10_000);
    assert_eq!(a_bal_after, a_bal_before - expected_slash, "relayer_a slashed 50% for absence");

    let b_native_after = app.wrap().query_balance(relayer_b.clone(), "untrn").unwrap().amount;
    assert_eq!(b_native_after, b_native_before + expected_slash, "relayer_b receives slash reward");
}

// ── S-4: Frivolous challenge (R-33) ──────────────────────────────────────────

#[test]
fn test_s4_frivolous_challenge() {
    let Setup { mut app, tusdc, bond, registry: _, bridge_mint, verifier, relayer_a, relayer_b, user } =
        build_setup();

    let env = make_envelope(0, &bridge_mint);
    let (proof_bytes, true_fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    let event_ts = app.block_info().time.seconds();

    // relayer_a submits honestly.
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: true_fp.clone(),
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");

    let a_bal_before: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    let b_bal_before: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_b.to_string() })
        .unwrap();

    // relayer_b files a frivolous challenge with empty evidence (empty = invalid proof stub).
    app.execute_contract(
        relayer_b.clone(),
        verifier.clone(),
        &VerifierExecute::Challenge {
            submission_id: sub_id.clone(),
            correct_fingerprint: "wrong_fingerprint".to_string(),
            evidence_proof: b"".to_vec().into(), // empty → invalid
        },
        &[],
    )
    .unwrap();

    // relayer_b slashed 25%, relayer_a bond unchanged (reward goes to relayer_a wallet).
    let b_bal_after: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_b.to_string() })
        .unwrap();
    let expected_slash = b_bal_before * Uint128::new(2_500) / Uint128::new(10_000);
    assert_eq!(b_bal_after, b_bal_before - expected_slash, "relayer_b slashed 25%");

    let a_bal_after: Uint128 = app
        .wrap()
        .query_wasm_smart(bond.clone(), &bond::msg::QueryMsg::Balance { addr: relayer_a.to_string() })
        .unwrap();
    assert_eq!(a_bal_after, a_bal_before, "relayer_a bond unchanged after frivolous challenge");

    // Advance past challenge window — message can still execute.
    app.update_block(|b| b.time = b.time.plus_seconds(61));

    app.execute_contract(
        a("anyone"),
        verifier.clone(),
        &VerifierExecute::ExecuteMessage {
            submission_id: sub_id,
            proof: proof_bytes.into(),
        },
        &[],
    )
    .unwrap();

    let balance: Uint128 = app
        .wrap()
        .query_wasm_smart(tusdc, &tusdc::msg::QueryMsg::Balance { addr: a("user").to_string() })
        .unwrap();
    assert_eq!(balance, Uint128::new(500_000_000), "user receives tokens after frivolous challenge");
}

// ── Edge cases ────────────────────────────────────────────────────────────────

#[test]
fn test_execute_before_challenge_window_reverts() {
    let Setup { mut app, bridge_mint, verifier, relayer_a, .. } = build_setup();
    let env = make_envelope(0, &bridge_mint);
    let event_ts = app.block_info().time.seconds();
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: "fp".to_string(),
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");
    let err = app
        .execute_contract(
            a("anyone"),
            verifier,
            &VerifierExecute::ExecuteMessage {
                submission_id: sub_id,
                proof: b"proof".to_vec().into(),
            },
            &[],
        )
        .unwrap_err();
    // ChallengeWindowOpen error — just verify the call fails
    let _ = err; // error returned as expected
}

#[test]
fn test_challenge_after_window_reverts() {
    let Setup { mut app, bridge_mint, verifier, relayer_a, relayer_b, .. } = build_setup();
    let env = make_envelope(0, &bridge_mint);
    let event_ts = app.block_info().time.seconds();
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: "fp".to_string(),
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");
    app.update_block(|b| b.time = b.time.plus_seconds(61));
    let err = app
        .execute_contract(
            relayer_b.clone(),
            verifier,
            &VerifierExecute::Challenge {
                submission_id: sub_id,
                correct_fingerprint: "fp2".to_string(),
                evidence_proof: b"proof".to_vec().into(),
            },
            &[],
        )
        .unwrap_err();
    let _ = err; // ChallengeWindowClosed error — just verify the call fails
}

#[test]
fn test_double_execute_reverts() {
    let Setup { mut app, bridge_mint, verifier, relayer_a, .. } = build_setup();
    let env = make_envelope(0, &bridge_mint);
    let (proof_bytes, fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    let event_ts = app.block_info().time.seconds();
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: fp,
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");
    app.update_block(|b| b.time = b.time.plus_seconds(61));
    app.execute_contract(
        a("anyone"),
        verifier.clone(),
        &VerifierExecute::ExecuteMessage {
            submission_id: sub_id.clone(),
            proof: proof_bytes.into(),
        },
        &[],
    )
    .unwrap();
    // Second execute must fail.
    let err = app
        .execute_contract(
            a("anyone"),
            verifier,
            &VerifierExecute::ExecuteMessage {
                submission_id: sub_id,
                proof: b"proof".to_vec().into(),
            },
            &[],
        )
        .unwrap_err();
    let _ = err; // NotPending error — just verify the call fails
}

#[test]
fn test_absence_slash_no_handover_reverts() {
    let Setup { mut app, bridge_mint, verifier, relayer_a, .. } = build_setup();
    let env = make_envelope(0, &bridge_mint);
    let (proof_bytes, fp) = make_tessera_proof("msg:11155111:vault_on_sepolia:0");
    let event_ts = app.block_info().time.seconds();
    // relayer_a submits immediately (within handover period).
    let res = app
        .execute_contract(
            relayer_a.clone(),
            verifier.clone(),
            &VerifierExecute::SubmitMessage {
                envelope: env,
                fingerprint: fp,
                event_timestamp: event_ts,
            },
            &[],
        )
        .unwrap();
    let sub_id = extract_attr(&res, "submission_id");
    app.update_block(|b| b.time = b.time.plus_seconds(61));
    app.execute_contract(
        a("anyone"),
        verifier.clone(),
        &VerifierExecute::ExecuteMessage {
            submission_id: sub_id.clone(),
            proof: proof_bytes.into(),
        },
        &[],
    )
    .unwrap();
    // claimAbsenceSlash should fail because submitted within handover period.
    let err = app
        .execute_contract(
            a("anyone"),
            verifier,
            &VerifierExecute::ClaimAbsenceSlash { submission_id: sub_id },
            &[],
        )
        .unwrap_err();
    let _ = err; // HandoverNotElapsed error — just verify the call fails
}
