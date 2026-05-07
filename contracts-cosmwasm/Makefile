.PHONY: build test lint wasm-check schema

build:
	cargo build --workspace

test:
	cargo test --workspace

lint:
	cargo clippy --all-targets -- -D warnings

wasm-check:
	cargo check --target wasm32-unknown-unknown --workspace

wasm-build:
	cargo build --release --target wasm32-unknown-unknown --workspace
