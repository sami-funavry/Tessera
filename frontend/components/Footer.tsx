import Link from 'next/link';

// The footer is a pure server component — no interactivity needed.

function FooterLogoMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="8" height="8" rx="1.5" fill="#fb923c" />
      <rect x="10" y="0" width="8" height="8" rx="1.5" fill="#fb923c" fillOpacity="0.4" />
      <rect x="0" y="10" width="8" height="8" rx="1.5" fill="#fb923c" fillOpacity="0.4" />
      <rect x="10" y="10" width="8" height="8" rx="1.5" fill="#fb923c" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-stone-800 mt-20 px-4 py-8">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-4">
        {/* Left: logo + version */}
        <div className="flex items-center gap-2.5">
          <FooterLogoMark />
          <span className="font-display text-base text-stone-300 leading-none">
            Tessera
          </span>
          <span className="font-mono text-[10px] text-stone-600 tracking-wider uppercase">
            v0.1.0 · testnet
          </span>
        </div>

        {/* Right: footer nav */}
        <nav
          aria-label="Footer navigation"
          className="flex items-center gap-5 flex-wrap"
        >
          <Link
            href="/docs"
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Docs
          </Link>
          <a
            href="https://github.com/sami-funavry/Tessera"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            GitHub
          </a>
          <Link
            href="/benchmark"
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Benchmark
          </Link>
          <Link
            href="/demo"
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Demo
          </Link>
        </nav>
      </div>
    </footer>
  );
}
