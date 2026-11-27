'use client';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client;
export function supabase() {
  if (!client) {
    if (!url || !key) throw new Error('Supabase environment variables are missing');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

// Every device gets an anonymous Supabase session; codes and the admin password
// then attach roles to it on the server.
let sessionPromise;
export function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const sb = supabase();
      const { data } = await sb.auth.getSession();
      if (data.session) return data.session;
      const { data: signed, error } = await sb.auth.signInAnonymously();
      if (error) {
        sessionPromise = null;
        throw new Error(
          error.message.includes('Anonymous')
            ? 'Anonymous sign-ins are turned off in Supabase (Authentication → Sign In / Providers).'
            : error.message
        );
      }
      return signed.session;
    })();
  }
  return sessionPromise;
}

// Call an RPC and throw a readable error
export async function rpc(fn, args = {}) {
  await ensureSession();
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function select(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
