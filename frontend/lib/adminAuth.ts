/**
 * Server-side gate for /api/admin/* proxy routes.
 *
 * Background (P-10.11): the admin proxies hold the relayer's
 * `TESSERA_ADMIN_SECRET` server-side and forward it to the relayer on every
 * call. Without a browser-side gate, anyone on the public internet can hit
 * `/api/admin/trigger-burn` or `/api/admin/claim` and drain the relayer's
 * funds, because Next.js still attaches the secret on the way out. We confirmed
 * this empirically before adding the gate.
 *
 * The gate is a simple shared token:
 *   - server-only env var `TESSERA_ADMIN_TOKEN` (NOT prefixed `NEXT_PUBLIC_`)
 *   - client sends `X-Tessera-Admin-Token` header on every admin call
 *   - mismatch returns 401, matching invocations are forwarded as before
 *
 * The token is distributed out-of-band (URL parameter, password-manager link).
 * Rotate it via Railway service variables; no redeploy required.
 */

import { NextRequest, NextResponse } from 'next/server';

export const ADMIN_TOKEN_HEADER = 'x-tessera-admin-token';

/**
 * Returns null when the request is authorised, or a NextResponse with the
 * appropriate 401 status when not. Callers should `return` the response
 * directly when non-null.
 *
 * If `TESSERA_ADMIN_TOKEN` is unset on the server, the route fails closed
 * with 503 — better than silently allowing all traffic, which is what
 * pre-P-10.11 routes did.
 */
export function requireAdminToken(req: NextRequest): NextResponse | null {
  const expected = process.env.TESSERA_ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Admin token gate misconfigured: TESSERA_ADMIN_TOKEN unset on server. Refusing to forward admin call.',
      },
      { status: 503 },
    );
  }
  const provided = req.headers.get(ADMIN_TOKEN_HEADER) ?? '';
  if (!constantTimeEqual(provided, expected)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: missing or invalid admin token.' },
      { status: 401 },
    );
  }
  return null;
}

/**
 * Constant-time string compare to keep the gate immune to timing oracles.
 * The expected token is short (~32 chars) so this is a one-line implementation
 * — no external dependency required.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
