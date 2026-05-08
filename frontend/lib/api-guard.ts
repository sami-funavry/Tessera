/**
 * Server-side guards for API routes that perform real on-chain writes from
 * the server's relayer wallet. Phase-10 audit (SEC-01 / SEC-02 / SEC-13)
 * found these endpoints unauthenticated and trivially drainable. This module
 * is the single chokepoint for the protections every such route needs.
 *
 * Three layers:
 *
 *   1. **Origin allowlist** — same-origin browser flows are accepted; cross-
 *      origin browser requests are rejected. Trusted server-to-server callers
 *      (CI, scripts) bypass via `X-Tessera-Admin-Secret`.
 *
 *   2. **Per-IP rate limit** — in-process LRU; survives the lifetime of a
 *      single Next.js server. Sufficient for one-instance hackathon hosting;
 *      production should swap for Upstash / Redis. This is documented in
 *      `docs/audit-findings.md` under PROD-08 / SEC-01.
 *
 *   3. **Shared-secret bypass** — if `TESSERA_API_SECRET` is set in env, a
 *      caller presenting it via `X-Tessera-Admin-Secret` skips both checks.
 *      Lets the operator script the demo or curl from a trusted box.
 *
 * The functions return a `NextResponse` to short-circuit the route on failure,
 * or `null` if the request passed.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

// ─── Origin allowlist ─────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function envAllowedOrigins(): string[] {
  const raw = process.env.TESSERA_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function allowedOrigins(): string[] {
  return [...DEFAULT_ALLOWED_ORIGINS, ...envAllowedOrigins()];
}

function originIsAllowed(origin: string | null): boolean {
  if (!origin) return false;
  // Exact prefix match — Origin header has scheme+host+port, no path.
  return allowedOrigins().some((allowed) => origin === allowed);
}

// ─── Per-IP token-bucket rate limit ──────────────────────────────────────────

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

function takeToken(ip: string, capacity: number, refillPerSec: number): boolean {
  const now = Date.now();
  const existing = buckets.get(ip);
  if (!existing) {
    buckets.set(ip, { tokens: capacity - 1, lastRefillMs: now });
    return true;
  }
  const elapsedSec = (now - existing.lastRefillMs) / 1000;
  const refill = elapsedSec * refillPerSec;
  existing.tokens = Math.min(capacity, existing.tokens + refill);
  existing.lastRefillMs = now;
  if (existing.tokens >= 1) {
    existing.tokens -= 1;
    return true;
  }
  return false;
}

function clientIp(req: NextRequest): string {
  // Prefer X-Forwarded-For first hop (Vercel / most proxies). Fall back to
  // X-Real-IP (some self-hosted setups), then req.ip if exposed by the
  // adapter, then a fixed bucket so unknown peers still rate-limit together.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xreal = req.headers.get('x-real-ip');
  if (xreal) return xreal.trim();
  return 'unknown';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GuardOptions {
  /** Token bucket capacity (max burst). */
  capacity?: number;
  /** Tokens regenerated per second. */
  refillPerSec?: number;
  /** Pretty name surfaced in error responses + server logs. */
  routeName: string;
}

/**
 * Run all guards on a request. Returns a `NextResponse` on failure (which the
 * caller must return), or `null` on success.
 *
 * Same-origin browser POSTs from the configured frontend pass.
 * Cross-origin browser POSTs are rejected.
 * Server-to-server callers with `X-Tessera-Admin-Secret` matching the env
 * value bypass both origin and rate-limit checks.
 */
export function guardApiRoute(
  req: NextRequest,
  opts: GuardOptions,
): NextResponse | null {
  const { capacity = 5, refillPerSec = 1 / 60, routeName } = opts;

  // 1) Admin-secret bypass.
  const adminSecret = process.env.TESSERA_API_SECRET?.trim();
  if (adminSecret && req.headers.get('x-tessera-admin-secret') === adminSecret) {
    return null;
  }

  // 2) Origin / Referer allowlist.
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const refererOrigin = referer ? new URL(referer).origin : null;
  const candidate = origin ?? refererOrigin;
  if (!originIsAllowed(candidate)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        detail:
          'Cross-origin or origin-less requests are not permitted on this endpoint. ' +
          'Server-to-server callers should set X-Tessera-Admin-Secret.',
      },
      { status: 403 },
    );
  }

  // 3) Per-IP rate limit.
  const ip = clientIp(req);
  if (!takeToken(`${routeName}:${ip}`, capacity, refillPerSec)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many requests',
        detail: `Rate limit exceeded for ${routeName}. Wait a minute and retry.`,
      },
      { status: 429 },
    );
  }

  return null;
}
