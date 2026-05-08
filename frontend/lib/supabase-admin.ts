// Server-only — never import from client components or pages.
// Uses the service-role key which bypasses RLS and allows inserts from API routes.
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error('Missing Supabase admin env vars');
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  });
}
