/**
 * POST | GET /api/scenarios/[type]
 *
 * Proxies demo scenario triggers (honest / lying / silent / spam) to the
 * deployed Go relayer's admin endpoint, attaching the TESSERA_ADMIN_SECRET
 * server-side so the secret never reaches the browser.
 *
 * The relayer's admin handlers (relayer/internal/relayer/admin.go) do the
 * actual fault injection, on-chain submission, slashing, and Supabase
 * writes. The dashboard auto-refreshes via Supabase realtime once the
 * relayer's processing pipeline completes.
 *
 * This route used to run a server-side simulator (relay-helper.ts) — that
 * was P-9.5 hackathon scaffolding and was deleted in the P-10 cutover.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const VALID_TYPES = new Set(['honest', 'lying', 'silent', 'spam'] as const);
type ScenarioType = 'honest' | 'lying' | 'silent' | 'spam';

interface ProxyTarget {
  path: string;
  method: 'POST';
}

function buildAdminTarget(type: ScenarioType, baseUrl: string): ProxyTarget {
  switch (type) {
    case 'lying':
      return {
        path: `${baseUrl}/admin/inject-fault?type=wrong_fingerprint&duration=1`,
        method: 'POST',
      };
    case 'silent':
      return { path: `${baseUrl}/admin/go-silent?nonces=1`, method: 'POST' };
    case 'spam':
      return { path: `${baseUrl}/admin/force-frivolous?nonces=1`, method: 'POST' };
    case 'honest':
      return { path: `${baseUrl}/admin/status`, method: 'POST' };
  }
}

function describeScenario(type: ScenarioType): string {
  switch (type) {
    case 'honest':
      return 'Honest delivery — relayer fetches proof, submits to destination Verifier, tokens minted.';
    case 'lying':
      return 'Lying relayer — wrong fingerprint primed; challenger detects and 50% bond slashed.';
    case 'silent':
      return 'Silent relayer — assigned submitter skips; handover triggers; absence slash applied.';
    case 'spam':
      return 'Frivolous challenge — challenger files baseless dispute; 25% bond forfeited.';
  }
}

async function handleScenario(type: string): Promise<NextResponse> {
  if (!VALID_TYPES.has(type as ScenarioType)) {
    return NextResponse.json(
      {
        success: false,
        message: `Unknown scenario "${type}". Must be: ${[...VALID_TYPES].join(', ')}.`,
      },
      { status: 400 },
    );
  }
  const scenarioType = type as ScenarioType;

  const adminUrl = process.env.RELAYER_ADMIN_URL;
  if (!adminUrl) {
    return NextResponse.json(
      {
        success: false,
        message:
          'RELAYER_ADMIN_URL not configured. Deploy a relayer service and set the env var.',
      },
      { status: 503 },
    );
  }

  const adminSecret = process.env.TESSERA_ADMIN_SECRET ?? '';

  const target = buildAdminTarget(scenarioType, adminUrl);

  // Step 1 — configure the scenario's fault flag on the relayer.
  // (For 'honest', this is a no-op /admin/status ping.)
  try {
    const upstream = await fetch(target.path, {
      method: target.method,
      headers: adminSecret ? { 'X-Admin-Secret': adminSecret } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        { success: false, message: `Fault config returned ${upstream.status}: ${text}` },
        { status: 502 },
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, message: `Failed to reach relayer admin (fault step): ${errMsg}` },
      { status: 502 },
    );
  }

  // Step 2 — execute a real Sepolia tUSDC lock from the relayer's wallet.
  // The relayer's SubscribeEvents handler will pick it up and process per
  // the active fault flag (or honestly if none is set).
  let lockResult: {
    ok?: boolean;
    tx_hash?: string;
    nonce?: number;
    amount_tokens?: number;
    recipient?: string;
    etherscan_url?: string;
  } | null = null;

  try {
    const recipientParam = process.env.NEUTRON_WALLET_ADDRESS
      ? `&recipient=${encodeURIComponent(process.env.NEUTRON_WALLET_ADDRESS)}`
      : '';
    const lockUrl = `${adminUrl}/admin/trigger-lock?amount=10${recipientParam}`;
    const lockUpstream = await fetch(lockUrl, {
      method: 'POST',
      headers: adminSecret ? { 'X-Admin-Secret': adminSecret } : {},
      // Lock involves a real on-chain tx; allow up to 90s for approve + lock.
      signal: AbortSignal.timeout(90_000),
    });
    if (!lockUpstream.ok) {
      const text = await lockUpstream.text().catch(() => '');
      return NextResponse.json(
        { success: false, message: `Trigger-lock returned ${lockUpstream.status}: ${text}` },
        { status: 502 },
      );
    }
    lockResult = await lockUpstream.json().catch(() => null);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, message: `Failed to trigger lock: ${errMsg}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    message: describeScenario(scenarioType),
    relayerAdminUrl: adminUrl,
    lock: lockResult,
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const { type } = await params;
  return handleScenario(type);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const { type } = await params;
  return handleScenario(type);
}
