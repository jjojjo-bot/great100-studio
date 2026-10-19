// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { startVisitTracking } from "./visit-analytics";

let stop: (() => void)[];
const token = (sessionId: string, extra = "") => `header.${btoa(JSON.stringify({ session_id: sessionId, extra }))}.signature`;
const session = (id = "session-a", extra = "") => ({ user: { id: "alice" }, access_token: token(id, extra) }) as Session;
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as SupabaseClient);
const ready = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => { stop = []; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T14:59:50Z")); });
afterEach(() => { stop.forEach(cleanup => cleanup()); vi.useRealTimers(); vi.restoreAllMocks(); });

it("records a restored login and deduplicates StrictMode mounts, focus events and token refreshes", async () => {
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ error: null }) })); const database = client(rpc);
  stop.push(startVisitTracking(database, session()), startVisitTracking(database, session()));
  await ready(); expect(rpc).toHaveBeenCalledTimes(1); expect(rpc).toHaveBeenCalledWith("great100_record_visit");
  window.dispatchEvent(new Event("focus")); await ready(); expect(rpc).toHaveBeenCalledTimes(1);
  stop.push(startVisitTracking(database, session("session-a", "refreshed-token")));
  await ready(); expect(rpc).toHaveBeenCalledTimes(1);
  stop.push(startVisitTracking(database, session("session-b")));
  await ready(); expect(rpc).toHaveBeenCalledTimes(2);
});

it("records a new Korean calendar day while a visible page stays open", async () => {
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ error: null }) }));
  stop.push(startVisitTracking(client(rpc), session())); await ready();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rpc).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000); expect(rpc).toHaveBeenCalledTimes(2);
});

it("retries failed reports and stops sending new visits after cleanup", async () => {
  const rpc = vi.fn().mockImplementationOnce(() => { throw new Error("offline"); }).mockImplementation(() => ({ abortSignal: async () => ({ error: null }) }));
  const cleanup = startVisitTracking(client(rpc), session()); stop.push(cleanup);
  await ready(); expect(rpc).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("online")); await ready(); expect(rpc).toHaveBeenCalledTimes(2);
  cleanup(); vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(60_000);
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("waits for a hidden tab to become visible before counting a visit", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ error: null }) }));
  stop.push(startVisitTracking(client(rpc), session())); await ready(); expect(rpc).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); await ready();
  expect(rpc).toHaveBeenCalledTimes(1);
});
