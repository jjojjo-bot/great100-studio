// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { AccountMenu, AuthGate } from "./Auth";

const setup = vi.hoisted(() => ({ getAuthClient: vi.fn(), desktop: false }));
vi.mock("./supabase", async (original) => ({ ...await original<typeof import("./supabase")>(), getAuthClient: setup.getAuthClient }));
vi.mock("./platform", () => ({ isTauri: () => setup.desktop }));

const session: Session = {
  access_token: "test-access", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600,
  user: { id: "user-1", email: "creator@example.com", aud: "authenticated", app_metadata: { provider: "google" }, user_metadata: {}, created_at: "2026-10-19T00:00:00Z" },
};

function authClient(saved: Session | null = null) {
  let listener: (event: AuthChangeEvent, nextSession: Session | null) => void = () => {};
  const unsubscribe = vi.fn();
  const auth = {
    initialize: vi.fn(async () => ({ error: null as unknown })),
    getSession: vi.fn(async () => ({ data: { session: saved }, error: null as unknown })),
    onAuthStateChange: vi.fn((callback: typeof listener) => { listener = callback; return { data: { subscription: { unsubscribe } } }; }),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null as unknown })),
    signOut: vi.fn(async () => { listener("SIGNED_OUT", null); return { error: null as unknown }; }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth, unsubscribe, emit: (event: AuthChangeEvent, nextSession: Session | null) => listener(event, nextSession) };
}

const studio = () => <AuthGate><div>영상 작업 화면</div><AccountMenu /></AuthGate>;

beforeEach(() => {
  setup.getAuthClient.mockReset();
  setup.desktop = false;
  window.history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("Google login", () => {
  it("does not mount the studio or read projects before authentication", async () => {
    const { client } = authClient();
    setup.getAuthClient.mockReturnValue(client);
    const readProjects = vi.fn();
    function ProtectedStudio() { useEffect(readProjects, []); return <div>영상 작업 화면</div>; }
    render(<AuthGate><ProtectedStudio /></AuthGate>);
    expect(screen.getByRole("status").textContent).toContain("로그인 정보를 확인");
    await screen.findByRole("button", { name: "Google로 계속하기" });
    expect(readProjects).not.toHaveBeenCalled();
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
  });

  it("requests Google OAuth and returns to this app's root", async () => {
    const { client, auth } = authClient();
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    fireEvent.click(await screen.findByRole("button", { name: "Google로 계속하기" }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google", options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: "select_account" } },
    }));
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
  });

  it("allows another login attempt after an OAuth request fails", async () => {
    const { client, auth } = authClient();
    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: new Error("network failure") });
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    fireEvent.click(await screen.findByRole("button", { name: "Google로 계속하기" }));
    expect((await screen.findByRole("alert")).textContent).toContain("연결 상태");
    const retry = screen.getByRole("button", { name: "Google로 계속하기" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledTimes(2));
  });

  it("restores a saved session, and signs out only this browser", async () => {
    const { client, auth } = authClient(session);
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    expect(await screen.findByText("creator@example.com")).toBeTruthy();
    expect(screen.getByText("영상 작업 화면")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("button", { name: "Google로 계속하기" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
  });

  it("keeps the signed-in screen when sign-out fails and shows the error", async () => {
    const { client, auth } = authClient(session);
    auth.signOut.mockImplementation(async () => ({ error: new Error("network failure") }));
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    expect((await screen.findByRole("alert")).textContent).toContain("로그아웃하지 못했습니다");
    expect(screen.getByText("영상 작업 화면")).toBeTruthy();
  });

  it("keeps a newer auth event when an older session lookup finishes later", async () => {
    const { client, auth, emit } = authClient();
    let finish!: (result: { data: { session: Session | null }; error: null }) => void;
    auth.getSession.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    await act(async () => { emit("SIGNED_IN", session); finish({ data: { session: null }, error: null }); });
    expect(await screen.findByText("creator@example.com")).toBeTruthy();
    act(() => emit("SIGNED_OUT", null));
    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeTruthy();
  });

  it("reports a cancelled callback and removes OAuth parameters without losing page state", async () => {
    const { client, auth } = authClient();
    auth.initialize.mockResolvedValue({ error: { details: { error: "access_denied", code: "unspecified_code" } } });
    setup.getAuthClient.mockReturnValue(client);
    window.history.replaceState({ retained: true }, "", "/?error=access_denied&error_description=cancelled&view=studio");
    render(studio());
    expect((await screen.findByRole("alert")).textContent).toContain("로그인이 취소되었습니다");
    expect(window.location.search).toBe("?view=studio");
    expect(window.history.state).toEqual({ retained: true });
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("does not reveal the studio if restoring a session fails", async () => {
    const { client, auth } = authClient();
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error("network failure") });
    setup.getAuthClient.mockReturnValue(client);
    render(studio());
    expect((await screen.findByRole("alert")).textContent).toContain("연결 상태");
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
  });

  it("cleans up auth subscriptions during StrictMode remounts and unmount", async () => {
    const { client, auth, unsubscribe } = authClient(session);
    setup.getAuthClient.mockReturnValue(client);
    const view = render(<StrictMode>{studio()}</StrictMode>);
    await screen.findByText("creator@example.com");
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});

describe("auth configuration", () => {
  it("retains local development without configured credentials", () => {
    setup.getAuthClient.mockReturnValue(null);
    render(studio());
    expect(screen.getByText("영상 작업 화면")).toBeTruthy();
    expect(screen.getByText("로컬 작업 · 이 브라우저에 저장")).toBeTruthy();
  });

  it("does not silently bypass authentication in a production build without credentials", () => {
    vi.stubEnv("PROD", true);
    setup.getAuthClient.mockReturnValue(null);
    render(studio());
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("로그인 설정");
    expect((screen.getByRole("button", { name: "Google로 계속하기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a configuration error instead of bypassing partially configured auth", () => {
    setup.getAuthClient.mockImplementation(() => { throw new Error("missing public key"); });
    render(studio());
    expect(screen.queryByText("영상 작업 화면")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("로그인 연결 설정");
  });

  it("keeps the desktop app in local mode without starting web OAuth", () => {
    vi.stubEnv("PROD", true);
    setup.desktop = true;
    render(studio());
    expect(screen.getByText("영상 작업 화면")).toBeTruthy();
    expect(setup.getAuthClient).not.toHaveBeenCalled();
  });
});
