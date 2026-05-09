/**
 * POST /api/admin/claim
 *
 * Proxy to the deployed relayer's /admin/claim-tusdc endpoint with the
 * server-side TESSERA_ADMIN_SECRET. Claims tUSDC into the relayer's own
 * wallet on the requested chain.
 *
 * Body: { chain: 'sepolia' | 'neutron', relayer: 'a' | 'b' }
 *
 * For relayer 'b', RELAYER_B_ADMIN_URL must be configured. If not, the
 * route returns 503 with a clear error.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/adminAuth';

interface Body {
  chain: 'sepolia' | 'neutron';
  relayer: 'a' | 'b';
}

function isBody(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const x = b as Partial<Body>;
  return (
    (x.chain === 'sepolia' || x.chain === 'neutron') &&
    (x.relayer === 'a' || x.relayer === 'b')
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireAdminToken(req);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isBody(body)) {
    return NextResponse.json(
      { success: false, error: 'Body shape: { chain: sepolia|neutron, relayer: a|b }' },
      { status: 400 },
    );
  }

  const { chain, relayer } = body;
  const adminUrl =
    relayer === 'a'
      ? process.env.RELAYER_ADMIN_URL
      : process.env.RELAYER_B_ADMIN_URL;
  const secret = process.env.TESSERA_ADMIN_SECRET;

  if (!adminUrl) {
    return NextResponse.json(
      {
        success: false,
        error: `Relayer ${relayer.toUpperCase()} admin URL not configured (${
          relayer === 'a' ? 'RELAYER_ADMIN_URL' : 'RELAYER_B_ADMIN_URL'
        })`,
      },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/admin/claim-tusdc?chain=${chain}`, {
      method: 'POST',
      headers: secret ? { 'X-Admin-Secret': secret } : {},
      signal: AbortSignal.timeout(60_000),
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
