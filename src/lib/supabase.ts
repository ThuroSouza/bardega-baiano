import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && publishableKey);

// Nunca inicializar o cliente com chave secret ou service_role no navegador.
export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase não configurado.");
  return supabase;
}
