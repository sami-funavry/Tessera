.PHONY: build test lint tidy run-relayer run-indexer smoke

BIN := tessera

build:
	go build -o bin/$(BIN) ./cmd/tessera

test:
	go test -race -count=1 ./...

lint:
	go vet ./...

tidy:
	go mod tidy

run-relayer: build
	./bin/$(BIN) relayer

run-indexer: build
	./bin/$(BIN) indexer

smoke: build
	./bin/$(BIN) --help
