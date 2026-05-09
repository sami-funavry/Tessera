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

  let upstream: Response;
  try {
    upstream = await fetch(target.path, {
      method: target.method,
      headers: adminSecret ? { 'X-Admin-Secret': adminSecret } : {},
      // The admin handlers respond instantly (they only flip flags). The
      // actual on-chain work happens asynchronously inside the relayer.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to reach relayer admin: ${errMsg}`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      {
        success: false,
        message: `Relayer admin returned ${upstream.status}: ${text}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    message: describeScenario(scenarioType),
    relayerAdminUrl: adminUrl,
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
