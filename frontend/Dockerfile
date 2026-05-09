# Multi-stage build for the Tessera Next.js frontend.
# Uses Next.js standalone output for a small final image (~150 MB).

# ─── 1. Install deps ──────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# pnpm via corepack (no global install).
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── 2. Build ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js build expects NEXT_PUBLIC_* envs at build time (they're inlined into
# the client bundle). Railway injects build-time env vars; nothing extra to do.
RUN pnpm build

# ─── 3. Runtime ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

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
