// Server component — fetches initial bridge stats at render time.
// Client interactivity lives in the <HomepageClient> island below.
import HomepageClient from './HomepageClient';

export const metadata = {
  title: 'Bridge — Tessera',
  description:
    'Move tUSDC between Sepolia and Neutron in ~90 seconds, secured by bonded relayers and permissionless challengers.',
};

async function fetchInitialStats() {
  try {
    // Use relative URL in production (same origin); absolute for local builds.
    const base =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : '');
    const res = await fetch(`${base}/api/bridge-stats`, {
      next: { revalidate: 30 },
    });
    if (res.ok) return res.json();
  } catch {
    // Fall through to defaults.
  }
  return {
    estimatedTimeSec: 90,
    challengeWindowSec: 60,
    relayerFeeBps: 10,
    gasUsd: '~$0.42',
  };
}

export default async function HomePage() {
  const bridgeStats = await fetchInitialStats();
  return <HomepageClient bridgeStats={bridgeStats} />;
}
