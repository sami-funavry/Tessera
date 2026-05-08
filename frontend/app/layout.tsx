import type { Metadata, Viewport } from 'next';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Tessera — Trust-minimized cross-chain',
    template: '%s | Tessera',
  },
  description:
    'Move assets between Ethereum and Cosmos chains in ~90 seconds, secured by bonded relayers and permissionless challengers — no trusted committee.',
  keywords: ['bridge', 'cross-chain', 'Ethereum', 'Cosmos', 'Neutron', 'Sepolia', 'DeFi'],
  authors: [{ name: 'Tessera' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Tessera',
    title: 'Tessera — Trust-minimized cross-chain',
    description: 'Move assets between Ethereum and Cosmos without a trusted committee.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c0a09',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-[#0c0a09] text-stone-100 antialiased">
        <Providers>
          <Nav />
          <main className="flex-1 relative z-10">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
