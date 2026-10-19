import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface AuthEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export function createAuthClient(environment: AuthEnvironment): SupabaseClient | null {
  const url = environment.VITE_SUPABASE_URL?.trim();
  const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !key) return null;
  if (!url || !key) throw new Error("Supabase URL과 공개 키를 함께 설정해 주세요.");
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Supabase URL을 확인해 주세요.");
  if (key.startsWith("sb_secret_")) throw new Error("Supabase publishable key를 사용해 주세요.");
  return createClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

// One client also keeps OAuth code exchange and token refresh single across StrictMode mounts.
let client: SupabaseClient | null | undefined;
export function getAuthClient(): SupabaseClient | null {
  if (client === undefined) client = createAuthClient(import.meta.env);
  return client;
}

export function authRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export function clearAuthRedirect(): void {
  const url = new URL(window.location.href);
  for (const name of ["code", "sb_flow_id", "error", "error_code", "error_description"]) url.searchParams.delete(name);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has("error")) url.hash = "";
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}
