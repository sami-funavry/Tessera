# Multi-stage build for the Tessera Next.js frontend.
# Uses Next.js standalone output for a small final image (~150 MB).

# ─── 1. Install deps ──────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# pnpm via corepack (no global install).
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── 2. Build ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js bakes NEXT_PUBLIC_* env vars into the client bundle at build time.
# Docker BuildKit requires each one declared as ARG and re-exported as ENV
# before `pnpm build` for Railway-injected build args to be visible.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SEPOLIA_RPC_URL
ARG NEXT_PUBLIC_SEPOLIA_CHAIN_ID
ARG NEXT_PUBLIC_NEUTRON_RPC_URL
ARG NEXT_PUBLIC_NEUTRON_REST_URL
ARG NEXT_PUBLIC_NEUTRON_CHAIN_ID
ARG NEXT_PUBLIC_RELAYER_ADMIN_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SEPOLIA_RPC_URL=$NEXT_PUBLIC_SEPOLIA_RPC_URL \
    NEXT_PUBLIC_SEPOLIA_CHAIN_ID=$NEXT_PUBLIC_SEPOLIA_CHAIN_ID \
    NEXT_PUBLIC_NEUTRON_RPC_URL=$NEXT_PUBLIC_NEUTRON_RPC_URL \
    NEXT_PUBLIC_NEUTRON_REST_URL=$NEXT_PUBLIC_NEUTRON_REST_URL \
    NEXT_PUBLIC_NEUTRON_CHAIN_ID=$NEXT_PUBLIC_NEUTRON_CHAIN_ID \
    NEXT_PUBLIC_RELAYER_ADMIN_URL=$NEXT_PUBLIC_RELAYER_ADMIN_URL

RUN pnpm build

# ─── 3. Runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Listen on every interface (Railway requires 0.0.0.0).
ENV HOSTNAME=0.0.0.0
# PORT is provided by Railway; default to 3000 for local docker run.
ENV PORT=3000

# Standalone output bundles only the modules actually imported.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# Standalone output emits server.js at the package root.
CMD ["node", "server.js"]
