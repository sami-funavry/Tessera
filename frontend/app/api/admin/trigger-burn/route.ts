/**
 * POST /api/admin/trigger-burn
 *
 * Proxy to the deployed relayer's /admin/trigger-burn endpoint with the
 * server-side TESSERA_ADMIN_SECRET. Burns tUSDC on Neutron from the relayer's
 * own wallet, kicking off the Neutron→Sepolia bridge pipeline (relayer's
 * SubscribeEvents picks up the wasm.action='burn' tx, fetches an IAVL proof,
 * transforms to Patricia, submits to the Sepolia Verifier).
 *
 * Body: { amount?: number, recipient?: string, destApp?: string, relayer?: 'a' | 'b' }
 *
 *   - amount     : tUSDC tokens to burn (default 10)
 *   - recipient  : 0x… Sepolia EVM address to release tokens to. Optional —
 *                  the relayer falls back to its own Sepolia address for
 *                  self-bridging demo runs. Production callers (the bridge
 *                  widget) should pass the connected-wallet address.
 *   - destApp    : 0x… Sepolia BridgeVault contract address (defaults on
 *                  the relayer side; only override for non-demo deploys).
 *   - relayer    : 'a' | 'b' (default 'a').
 *
 * P-10.10: previously this body had a single `recipient` field that was
 * forwarded to the relayer as the destApp — the user's actual destination
 * address was never carried through, and BridgeVault.release reverted with
 * `invalid bridge payload` because the payload had a zero recipient.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

interface Body {
  amount?: number;
  recipient?: string;
  destApp?: string;
  relayer?: 'a' | 'b';
}

function isBody(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const x = b as Body;
  if (x.amount !== undefined && typeof x.amount !== 'number') return false;
  if (x.recipient !== undefined && typeof x.recipient !== 'string') return false;
  if (x.destApp !== undefined && typeof x.destApp !== 'string') return false;
  if (x.relayer !== undefined && x.relayer !== 'a' && x.relayer !== 'b') return false;
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — defaults will apply.
    body = {};
  }
  if (!isBody(body)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Body shape: { amount?: number, recipient?: string, destApp?: string, relayer?: a|b }',
      },
      { status: 400 },
    );
  }

  const { amount, recipient, destApp, relayer } = body;
  const which = relayer ?? 'a';
  const adminUrl =
    which === 'a' ? process.env.RELAYER_ADMIN_URL : process.env.RELAYER_B_ADMIN_URL;
  const secret = process.env.TESSERA_ADMIN_SECRET;

  if (!adminUrl) {
    return NextResponse.json(
      {
        success: false,
        error: `Relayer ${which.toUpperCase()} admin URL not configured (${
          which === 'a' ? 'RELAYER_ADMIN_URL' : 'RELAYER_B_ADMIN_URL'
        })`,
      },
      { status: 503 },
    );
  }

  const params = new URLSearchParams();
  params.set('amount', String(amount ?? 10));
  if (recipient) params.set('recipient', recipient);
  if (destApp) params.set('dest_app', destApp);

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/admin/trigger-burn?${params.toString()}`, {
      method: 'POST',
      headers: secret ? { 'X-Admin-Secret': secret } : {},
      // Burn involves a real on-chain Neutron tx; allow up to 90s for inclusion.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Reach relayer admin failed: ${errMsg}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      { success: false, error: `Relayer admin returned ${upstream.status}: ${text}` },
      { status: 502 },
    );
  }

  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json({ success: true, ...data });
}
