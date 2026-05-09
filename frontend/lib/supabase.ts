import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// Module-level constants. Build-time prerender on Railway runs without runtime
// env vars set yet (env vars are injected at runtime, not build), so we fall
// back to harmless placeholders during the build pass and only the resulting
// HTML+JS bundle reads the real values at request time on the client.
//
// At runtime, on the server, the actual env vars are set on the Railway
// service and the createClient call below picks them up — no behavior change
// in production.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabase = createClient<Database>(url, anon, {
  realtime: { params: { eventsPerSecond: 10 } },
});
