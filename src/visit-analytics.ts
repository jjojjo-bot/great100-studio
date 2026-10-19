import type { Session, SupabaseClient } from "@supabase/supabase-js";

const koreaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

// Only a request cache: the database validates the JWT and chooses all stored values.
function sessionKey(session: Session): string {
  try {
    const payload = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.session_id === "string") return `${session.user.id}:${payload.session_id}`;
  } catch { /* Non-JWT test sessions or future token formats still report visits. */ }
  return `${session.user.id}:${session.access_token}`;
}

interface VisitCache { recorded: Set<string>; pending: Map<string, Promise<boolean>> }
const caches = new WeakMap<SupabaseClient, VisitCache>();

export function startVisitTracking(client: SupabaseClient, session: Session): () => void {
  const identity = sessionKey(session);
  let stopped = false;
  let cache = caches.get(client);
  if (!cache) { cache = { recorded: new Set(), pending: new Map() }; caches.set(client, cache); }
  const visits = cache;

  const record = () => {
    if (stopped || document.visibilityState === "hidden") return;
    const key = `${identity}:${koreaDate.format(new Date())}`;
    if (visits.recorded.has(key) || visits.pending.has(key)) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    const request = Promise.resolve().then(async () => {
      try {
        const { error } = await client.rpc("great100_record_visit").abortSignal(controller.signal);
        if (error) return false;
        visits.recorded.add(key);
        window.dispatchEvent(new Event("great100:visit-recorded"));
        return true;
      } catch { return false; }
      finally { window.clearTimeout(timeout); visits.pending.delete(key); }
    });
    visits.pending.set(key, request);
    // Analytics failure never blocks login/editing. Online/focus/timer events retry.
    void request;
  };

  // This runs from a React effect, never inside Supabase's auth-state callback.
  record();
  window.addEventListener("focus", record);
  window.addEventListener("online", record);
  document.addEventListener("visibilitychange", record);
  const timer = window.setInterval(record, 60_000);
  return () => {
    stopped = true; window.clearInterval(timer);
    window.removeEventListener("focus", record); window.removeEventListener("online", record);
    document.removeEventListener("visibilitychange", record);
  };
}
