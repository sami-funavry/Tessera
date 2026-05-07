.PHONY: build test lint smoke setup

setup:
	@echo "Installing frontend deps..."
	cd frontend && pnpm install
	@echo "Tidying Go module..."
	cd relayer && go mod tidy

build:
	@echo "── contracts-evm ──"
	cd contracts-evm && forge build
	@echo "── contracts-cosmwasm ──"
	cd contracts-cosmwasm && cargo build --workspace
	@echo "── relayer ──"
	cd relayer && go build ./...
	@echo "── frontend ──"
	cd frontend && pnpm build

test:
	@echo "── contracts-evm ──"
	cd contracts-evm && forge test -vvv
	@echo "── contracts-cosmwasm ──"
	cd contracts-cosmwasm && cargo test --workspace
	@echo "── relayer ──"
	cd relayer && go test -race -count=1 ./...
	@echo "── frontend ──"
	cd frontend && pnpm tsc --noEmit

lint:
	cd contracts-evm && forge fmt --check
	cd contracts-cosmwasm && cargo clippy --all-targets -- -D warnings
	cd relayer && go vet ./...

smoke:
	bash scripts/smoke-test.sh
