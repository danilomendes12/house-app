import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/** Supabase client for client components. Only ever sees the anon key. */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
