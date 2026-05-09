use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Uint128;

#[cw_serde]
pub struct InstantiateMsg {
    pub owner: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Owner-only: authorise bridge-mint contract to call BridgeMintTo / BridgeBurnFrom.
    SetBridgeMint { bridge_mint: String },
    /// Anyone can claim 1 000 tUSDC once per 24 h.
    Claim {},
    /// Called by bridge-mint after a verified cross-chain message.
    BridgeMintTo { recipient: String, amount: Uint128 },
    /// Called by bridge-mint when user initiates a Neutron → Sepolia burn.
    BridgeBurnFrom { from: String, amount: Uint128 },
    /// Standard transfer.
    Transfer { recipient: String, amount: Uint128 },
}

/// CW20-compatible token metadata response — required by Keplr "Add Token" flow
/// and the CosmJS CW20 client.
#[cw_serde]
pub struct TokenInfoResponse {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(Uint128)]
    Balance { addr: String },
    #[returns(Uint128)]
    TotalSupply {},
    /// CW20-compatible token metadata — required by Keplr "Add Token" flow.
    #[returns(TokenInfoResponse)]
    TokenInfo {},
}

/// MigrateMsg lets the contract admin rotate the authorised bridge-mint
/// address without redeploying tusdc (which would strand all existing
/// balances). Used after redeploying bridge-mint with a schema change
/// (P-10.10 added `destination_recipient` to the Burn execute message).
#[cw_serde]
pub struct MigrateMsg {
    pub bridge_mint: String,
}
