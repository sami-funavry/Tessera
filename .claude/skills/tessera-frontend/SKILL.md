---
name: tessera-frontend
description: Conventions for Tessera's Next.js frontend. Covers design tokens (stone palette with copper accent, Instrument Serif display, system mono for hashes), shared components (CopyableHash, StatusBadge, SectionLabel), wagmi/viem and CosmJS+Keplr wallet integration, Supabase realtime subscriptions, responsive breakpoints, and the v2 mockup as the visual source of truth. Load for any prompt that creates or edits files under frontend/.
---

# Tessera Frontend Skill

Apply this skill when writing or modifying Next.js code under `frontend/`. The locked UI behavior is in `SPEC.md` Part 3. The visual source of truth is `info/mockup/tessera-mockup-v2.jsx` (gitignored — local reference only). This skill covers *how* to implement the production version well.

## Invariants (do not violate)

1. **The v2 mockup is the visual source of truth.** When implementation and mockup disagree visually, the mockup wins. When SPEC.md and mockup disagree on behavior, SPEC.md wins. When both disagree, ask the user.

2. **Six top-level routes only.** `/` (Bridge homepage), `/demo`, `/dashboard`, `/benchmark`, `/docs`, plus the internal-only `/submissions/[id]`. Do not add new top-level routes without updating SPEC.md.

3. **Wallet-only auth.** No usernames, no passwords, no OAuth, no session cookies. MetaMask for Sepolia, Keplr for Neutron. Both must be connected for cross-chain actions.

4. **Real-time data, not snapshots.** All numeric and status displays subscribe to live data sources (Supabase realtime or chain RPC polling). No "loaded once on mount" for anything that changes during the user's session.

5. **Every hash uses CopyableHash.** Transaction hashes, contract addresses, fingerprints, root hashes — all displayed via the shared `CopyableHash` component with copy + explorer link affordances. No raw hash strings in JSX.

6. **No invented data in production code.** The mockup uses placeholder data; the production frontend reads from chain or Supabase. Do not commit production code with hardcoded mock data fallbacks unless explicitly marked as fixture for testing.

## Match complexity to scope

- No premature abstraction. If a component is used once, inline it. Extract to `components/` only when reused or genuinely complex.
- No state management library. React's `useState` and `useReducer` plus wagmi/CosmJS hooks plus Supabase client are sufficient for a 6-page app. Adding Redux/Zustand/Jotai is out of scope unless a specific page needs it (none currently do).
- No CSS-in-JS library beyond Tailwind. shadcn/ui components are pre-styled with Tailwind; that's the styling system.
- No data-fetching library beyond Supabase client and wagmi/viem. No SWR, no React Query unless a specific need arises.

## Designed for extensibility

The frontend's chain awareness must be data-driven, not hardcoded. When new chains are added (Polygon, Osmosis, etc.), only configuration files change — no JSX, no component logic.

- Chain definitions live in `lib/chains.ts` as a typed array. Components iterate; they do not hardcode `"sepolia"` or `"neutron"` in JSX. Exception: chain-specific UI assets (the gradient colors per chain in selectors) are part of the chain config record, not separate code paths.
- Token definitions live in `lib/tokens.ts` keyed by chain ID. Adding a new bridgeable token is a config edit.
- The route structure does not branch on chain. The bridge widget reads from chain config and renders the same component for any pair.

## Default conventions (deviate with documented reason)

### Project layout

```
frontend/
├── package.json
├── next.config.js
├── tailwind.config.ts
├── app/
│   ├── layout.tsx                   # root layout, fonts, providers
│   ├── page.tsx                     # / (homepage with bridge)
│   ├── demo/page.tsx
│   ├── dashboard/page.tsx
│   ├── submissions/[id]/page.tsx
│   ├── benchmark/page.tsx
│   ├── docs/page.tsx
│   └── api/                         # Next API routes for any backend needs
├── components/
│   ├── shared/                      # CopyableHash, StatusBadge, SectionLabel, etc.
│   ├── bridge/                      # bridge widget and live tx section
│   ├── demo/                        # demo control panel pieces
│   ├── dashboard/                   # tables, metric cards
│   ├── docs/                        # sidebar nav, MDX renderers
│   └── ui/                          # shadcn/ui generated components
├── lib/
│   ├── chains.ts                    # chain config (data-driven, see above)
│   ├── tokens.ts                    # token config
│   ├── wallet.ts                    # wagmi + CosmJS setup
│   ├── supabase.ts                  # client + realtime helpers
│   └── format.ts                    # hash truncation, address bech32, etc.
├── content/docs/                    # MDX files for docs page
└── public/
```

### Design tokens

Defined once in `tailwind.config.ts` extension and `app/globals.css`. Never inline.

**Colors (Tailwind classes; do not deviate without reason):**
- Background: `bg-stone-950`
- Surfaces: `bg-stone-900/60`
- Subtle borders: `border-stone-800`
- Primary text: `text-stone-100`
- Muted text: `text-stone-400`
- Very muted: `text-stone-500`
- Accent: `text-orange-400` / `bg-orange-400` (sparingly — brand only)
- Functional: `emerald-400` (success), `amber-400` (warning), `red-400` (error)

**Typography:**
- Display headlines: Instrument Serif via `@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif')` in `globals.css`, exposed as `font-display` Tailwind utility.
- UI body: system sans (`font-sans` Tailwind default).
- Hashes, addresses, hex, code: system mono (`font-mono` default).

**Motion:**
- Default transitions: 150ms ease.
- Page/section fade-up: 400ms.
- Path animations (curvy roadmap fill): 800ms cubic-bezier(0.4, 0, 0.2, 1).
- Pulse rings: 2s infinite.

### Naming

- Component files: `PascalCase.tsx` (`CopyableHash.tsx`, `BridgeWidget.tsx`).
- Utility files: `kebab-case.ts` (`format-hash.ts`, `wallet-connect.ts`). Pick one style per directory; Next.js convention is mixed.
- Hooks: `useThing.ts`, exported as `useThing`.
- Components default-export the main component, named-export sub-components if reused.
- TypeScript types: `PascalCase`. Interfaces vs types: prefer `type` for unions and primitives, `interface` only when extending.

### State and data

- Server components by default (Next.js App Router). Mark `'use client'` only when interactivity (hooks, browser APIs) is required.
- Per-page data loading via React Server Components where possible; fall back to client-side fetch when wallet state is required.
- Supabase realtime subscriptions in client components only. Clean up subscriptions on unmount.
- wagmi hooks (`useAccount`, `useReadContract`, `useWriteContract`) for Sepolia. CosmJS via custom hooks (`useNeutronClient`, `useKeplrAddress`) for Neutron.

### Wallet integration

- MetaMask via wagmi + viem. Configured in `lib/wallet.ts` with Sepolia chain definition.
- Keplr via `@keplr-wallet/cosmos` and `@cosmjs/cosmwasm-stargate`. Neutron testnet (pion-1) chain config registered with Keplr on first connection.
- Both wallets connect/disconnect via the shared `WalletButton` component (`components/shared/WalletButton.tsx`).
- Disconnect cancels in-flight UI state per `R-108`.

### Supabase

- Client in `lib/supabase.ts`. Realtime subscriptions wrapped in custom hooks (`useMessages`, `useRelayerStats`, etc.) so components don't manage subscription lifecycle directly.
- Service-role key NEVER in client code. Anon key only. Row-level security on Supabase configured to allow read access to public dashboard tables.

### Forms and inputs

- Uncontrolled inputs preferred for simple cases. React Hook Form for any form with validation needs (e.g., recipient address validation).
- Address validation: chain-specific. Sepolia: `0x` + 40 hex chars (use viem's `isAddress`). Neutron: `neutron1...` bech32 (use CosmJS's address validators).

### Error and loading states

- Every async UI surface has explicit loading and error states. No infinite spinners on errors.
- Loading: skeleton placeholders matching the eventual layout (avoid layout shift).
- Errors: structured error component showing what failed, why, and what the user can do. Not raw error messages.

### Accessibility

- Semantic HTML by default (`<button>`, not `<div onClick>`).
- Focus styles preserved. Tailwind's default focus rings are acceptable.
- Color is not the only signal. Status badges use icon + text + color, not color alone.
- Keyboard navigation works for all interactive elements.

### Responsive breakpoints

- Mobile-first. Default styles target 375px width.
- Tailwind breakpoints: `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px).
- Test all six pages at 375px, 768px, 1280px before considering done.
- Tables overflow horizontally with `overflow-x-auto + min-w` rather than wrapping.
- Sidebar (docs page) collapses to dropdown below 1024px.

### Animation rules

- Prefer CSS transitions over JS animations. Use Framer Motion only where genuinely needed (path animations, complex orchestration).
- Reduce motion respected: `@media (prefers-reduced-motion: reduce)` disables non-essential animation.
- Animations enhance, never block. The UI is fully usable without them.

## Shared components

These are referenced from multiple pages. Implement once, reuse.

### CopyableHash (`UI-copyable-hash`)

Inline component for any displayed hash, address, or root.

```tsx
<CopyableHash
  value="0xabc12def4567..."
  displayLength={10}
  explorer="sepolia"  // 'sepolia' | 'neutron' | undefined
/>
```

Renders truncated hash, copy icon (changes to checkmark for 1.5s on click), and external link icon to the appropriate block explorer when `explorer` is provided. Click on copy/link icons stops propagation so parent row clicks don't fire.

### StatusBadge (`UI-status-badge`)

Pill component for relayer states. Color-coded with status dot:
- `busy` (submitting): amber-tinted, pulsing.
- `idle` (watching): emerald-tinted.
- `benched`: amber-tinted.
- `deregistered`: red-tinted.
- `cooling`: stone-tinted.

Accepts a relayer object; reads `activityType` and `activity` from it.

### SectionLabel (`UI-section-label`)

Section header pattern: uppercase mono label + horizontal line. Used throughout for section breaks.

## Real-time data plumbing

| Surface | Data source | Update mechanism |
|---------|-------------|------------------|
| Bridge widget fees | API route `/api/quote` aggregating chain gas | Poll every 10s |
| System status strip | Supabase aggregations | Realtime subscription on `messages`, `bonds` |
| Live tx section | Specific message in `messages` table | Realtime on row |
| Demo Control Panel relayer cards | `bonds` and recent activity | Realtime |
| Live event log | `events` table | Realtime, append on insert |
| Submission Detail | One-time load on mount | None (submission is finalized) |

Use Supabase channels efficiently — one subscription per page, not per component.

## Pitfalls

- **Hydration errors.** Next.js App Router + wallet libraries can mismatch between server and client render. Use `'use client'` boundaries carefully. Wallet state should never affect server-rendered HTML.

- **Keplr CosmWasm chain registration.** Neutron testnet (pion-1) is not in Keplr's default chain list. The wallet connect flow must call `keplr.experimentalSuggestChain(...)` with the chain config on first connection. Document this in the connect flow.

- **Supabase RLS.** Default row-level security blocks anonymous reads. Configure policies in the Supabase project to allow public read access on dashboard tables. Service-role key bypasses RLS but must NEVER be in client code.

- **Real-time subscription leaks.** Every `useEffect` that subscribes must return a cleanup function that unsubscribes. Memory leaks compound over the demo session.

- **Decimal handling on token amounts.** Sepolia tUSDC is 18 decimals; Neutron tUSDC is 6 decimals (matching each chain's USDC convention). Display logic divides by the right power of 10. Never display raw integer amounts.

- **Mobile MetaMask.** Mobile MetaMask uses an in-app browser, not deep links to a desktop wallet. Test the connect flow on mobile devices specifically.

## Testing

- Component tests with React Testing Library for shared components (CopyableHash, StatusBadge).
- Page-level interactive tests with Playwright (the MCP). Cover: connect wallet → claim tokens → bridge → see lifecycle → see balance update.
- Visual regression: capture screenshots at the three breakpoints for each page; diff against committed reference images.

## When something doesn't fit a default

If a default here doesn't fit a specific situation, deviate with documented reason. Default → deviation must be justified in a code comment, commit message, or PROMPT_LOG.md note.

## When in doubt

- Read SPEC.md Part 3 (UI specification) for the exact visual and interaction details.
- Reference `info/mockup/tessera-mockup-v2.jsx` for visual truth.
- Ask the user before guessing.