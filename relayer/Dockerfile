# Multi-stage build for the Tessera Go relayer.
# Final image is minimal Alpine + the static binary; no Go toolchain at runtime.

FROM golang:1.23-alpine AS builder

WORKDIR /build

# Install git (some Go modules pull from VCS at build time).
RUN apk add --no-cache git ca-certificates

# Cache module downloads.
COPY go.mod go.sum ./
RUN go mod download

# Build.
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /tessera \
    ./cmd/tessera

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S tessera && adduser -S tessera -G tessera

COPY --from=builder /tessera /usr/local/bin/tessera

USER tessera

# Admin HTTP server listens on :8080 by default; override with PORT or --admin.
EXPOSE 8080

# Default to running the relayer daemon with the admin server enabled.
# Railway's PORT env var is honored via the --admin flag at runtime
# (see entrypoint.sh wrapper if PORT must take precedence).
ENTRYPOINT ["/usr/local/bin/tessera"]
CMD ["relayer", "--admin", ":8080"]
