use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum TesseraError {
    #[error("unauthorized")]
    Unauthorized {},
    #[error("nonce replay: {nonce}")]
    NonceReplay { nonce: u64 },
}
