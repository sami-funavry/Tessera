export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

// Valid scenario types per the Tessera demo spec.
const VALID_TYPES = new Set(['honest', 'lying', 'silent', 'spam'] as const);
type ScenarioType = 'honest' | 'lying' | 'silent' | 'spam';

// Maps scenario type to the relayer admin endpoint + body.
// Admin URL comes from the server-side env var (not NEXT_PUBLIC) so it is
// never exposed to the browser bundle.
function buildAdminRequest(type: ScenarioType): {
  path: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
} {
  const baseUrl = process.env.RELAYER_ADMIN_URL ?? 'http://localhost:8080';

  switch (type) {
    case 'lying':
      // Relayer A submits a wrong fingerprint; challenger catches it within the
      // 60-second window; 50% slash.
      return {
        path: `${baseUrl}/admin/inject-fault?type=wrong_fingerprint&duration=1`,
        method: 'POST',
      };

    case 'silent':
      // Relayer A goes offline for the next nonce; handover period fires;
      // submitter gets 50% absence slash.
      return {
        path: `${baseUrl}/admin/go-silent?nonces=1`,
        method: 'POST',
      };

    case 'spam':
      // Challenger files a baseless dispute against the next valid submission;
      // challenge is rejected; 25% challenger deposit forfeited.
      return {
        path: `${baseUrl}/admin/force-frivolous?nonces=1`,
        method: 'POST',
      };

    case 'honest':
      // No-op — kicks the relayer into normal operation mode (clears any
      // previously injected fault state).
      return {
        path: `${baseUrl}/admin/status`,
        method: 'POST',
      };
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
): Promise<NextResponse> {
  const { type } = await params;
  return handleScenario(type);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
): Promise<NextResponse> {
  const { type } = await params;
  return handleScenario(type);
}

async function handleScenario(type: string): Promise<NextResponse> {
  // Validate the type parameter.
  if (!VALID_TYPES.has(type as ScenarioType)) {
    return NextResponse.json(
      {
        success: false,
        message: `Invalid scenario type "${type}". Must be one of: ${[...VALID_TYPES].join(', ')}.`,
      },
      { status: 400 }
    );
  }

  const { path, method } = buildAdminRequest(type as ScenarioType);

  try {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      // 5-second timeout — the relayer admin API is expected to respond quickly.
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      return NextResponse.json(
        { success: false, message: `Relayer admin returned ${response.status}: ${text}` },
        { status: 502 }
      );
    }

    const body = await response.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      message: scenarioMessage(type as ScenarioType),
      ...body,
    });
  } catch (err: unknown) {
    // Relayer is offline — return 200 with an informative message so the
    // frontend can still show a graceful state.
    const isTimeout =
      err instanceof DOMException && err.name === 'TimeoutError';
    const isNetworkError =
      err instanceof TypeError && err.message.includes('fetch');

    if (isTimeout || isNetworkError) {
      return NextResponse.json({
        success: false,
        message:
          'Relayer admin service is offline. Start the relayer to trigger demo scenarios.',
        offline: true,
      });
    }

    // Unexpected error.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}

function scenarioMessage(type: ScenarioType): string {
  switch (type) {
    case 'honest':  return 'Honest delivery — normal relayer operation active.';
    case 'lying':   return 'Fault injected — next submission will carry a wrong fingerprint.';
    case 'silent':  return 'Silence injected — relayer will skip the next nonce.';
    case 'spam':    return 'Frivolous challenge scheduled against the next valid submission.';
  }
}
