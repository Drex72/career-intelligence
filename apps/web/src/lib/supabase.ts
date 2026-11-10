'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let instance: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (instance) return instance;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase authentication is not configured');
  instance = createClient(url, key, {auth: {persistSession: true,autoRefreshToken: true,detectSessionInUrl: true}});
  return instance;
}
