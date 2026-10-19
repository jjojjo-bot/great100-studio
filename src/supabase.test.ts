// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { authRedirectUrl, clearAuthRedirect, createAuthClient } from "./supabase";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ auth: {} })) }));
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, "", "/"); });
afterEach(() => vi.unstubAllEnvs());

describe("Supabase client configuration", () => {
  it("allows local development only when both settings are absent", () => {
    expect(createAuthClient({})).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(() => createAuthClient({ VITE_SUPABASE_URL: "https://project.supabase.co" })).toThrow("함께 설정");
    expect(() => createAuthClient({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toThrow("함께 설정");
  });

  it("rejects invalid URLs and server-side secret keys", () => {
    for (const url of ["not-a-url", "ftp://project.supabase.co"]) {
      expect(() => createAuthClient({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toThrow();
    }
    expect(() => createAuthClient({ VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" })).toThrow("publishable key");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses PKCE with persistent sessions and automatic callback detection", () => {
    createAuthClient({ VITE_SUPABASE_URL: " https://project.supabase.co ", VITE_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_test " });
    expect(createClient).toHaveBeenCalledWith("https://project.supabase.co", "sb_publishable_test", {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  });

  it("returns to the app base path without copying URL parameters into OAuth", () => {
    vi.stubEnv("BASE_URL", "/studio/");
    window.history.replaceState(null, "", "/studio/?next=https://example.com");
    expect(authRedirectUrl()).toBe(`${window.location.origin}/studio/`);
  });

  it("removes completed callback parameters and preserves unrelated URL and history state", () => {
    window.history.replaceState({ draft: 1 }, "", "/?code=one-time-code&sb_flow_id=flow-1&view=projects#scene-2");
    clearAuthRedirect();
    expect(window.location.search).toBe("?view=projects");
    expect(window.location.hash).toBe("#scene-2");
    expect(window.history.state).toEqual({ draft: 1 });
    window.history.replaceState(null, "", "/#error=access_denied&error_description=cancelled");
    clearAuthRedirect();
    expect(window.location.hash).toBe("");
  });
});
