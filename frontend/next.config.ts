import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Standalone bundles only the modules actually imported into a server.js
  // entrypoint at .next/standalone/server.js — used by the Railway Dockerfile.
  output: 'standalone',
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Allow images from any hostname for testnet explorers
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'sepolia.etherscan.io' },
      { protocol: 'https', hostname: 'neutron.celat.one' },
    ],
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
