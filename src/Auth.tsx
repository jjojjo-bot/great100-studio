import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isTauri } from "./platform";
import { authRedirectUrl, clearAuthRedirect, getAuthClient } from "./supabase";
import "./auth.css";

interface AuthState {
  client: SupabaseClient | null;
  session: Session | null;
}

const AuthContext = createContext<AuthState>({ client: null, session: null });

function loginError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : "";
  const details = cause && typeof cause === "object" && "details" in cause ? cause.details : null;
  if (code === "access_denied" || (details && typeof details === "object" && "error" in details && details.error === "access_denied")) {
    return "Google 로그인이 취소되었습니다. 다시 로그인할 수 있습니다.";
  }
  return "로그인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [setup] = useState(() => {
    // Desktop OAuth needs an external browser and a native callback, and is a separate integration.
    if (isTauri()) return { client: null, error: "" };
    try {
      const client = getAuthClient();
      return { client, error: !client && import.meta.env.PROD ? "로그인 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요." : "" };
    } catch {
      return { client: null, error: "로그인 연결 설정을 확인해 주세요. 관리자에게 문의해 주세요." };
    }
  });
  const client = setup.client;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!client);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) return;
    let active = true;
    let eventVersion = 0;
    setLoading(true);
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      eventVersion++;
      setSession(nextSession);
      if (nextSession) setError("");
    });
    const version = eventVersion;
    const restore = async () => {
      // The SDK exchanges a returning PKCE code once during initialization, including in StrictMode.
      const initialized = await client.auth.initialize();
      if (initialized.error) throw initialized.error;
      const { data, error: restoreError } = await client.auth.getSession();
      if (restoreError) throw restoreError;
      if (active && eventVersion === version) setSession(data.session);
    };
    void restore().catch((cause) => {
      if (active) setError(loginError(cause));
    }).finally(() => {
      if (active) {
        clearAuthRedirect();
        setLoading(false);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client]);

  const signIn = async () => {
    if (!client) return;
    setSigningIn(true);
    setError("");
    try {
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authRedirectUrl(), queryParams: { prompt: "select_account" } },
      });
      if (signInError) throw signInError;
    } catch (cause) {
      setError(loginError(cause));
    } finally {
      setSigningIn(false);
    }
  };

  if (setup.error) return <LoginScreen error={setup.error} />;
  if (loading) return <LoginScreen loading />;
  if (client && !session) return <LoginScreen error={error} busy={signingIn} onSignIn={signIn} onRetry={() => window.location.reload()} />;
  return <AuthContext.Provider value={{ client, session }}><Fragment key={session?.user.id || "local"}>{children}</Fragment></AuthContext.Provider>;
}

function GoogleMark() {
  return <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.89 46.98 24.55Z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.77 23.77 0 0 0 0 24c0 3.87.94 7.53 2.56 10.78l7.97-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>;
}

function LoginScreen({ loading, busy, error, onSignIn, onRetry }: { loading?: boolean; busy?: boolean; error?: string; onSignIn?: () => void; onRetry?: () => void }) {
  return <main className="auth-screen">
    <section className="auth-card" aria-label="Great100 로그인">
      <div className="brand auth-brand"><div className="brand-mark" aria-hidden="true"><span>G</span></div><div><strong>Great100</strong><small>STORY STUDIO</small></div></div>
      <div className="eyebrow">EVERY LIFE HAS A STORY</div>
      <h1>한 사람의 이야기를,<br />한 편의 영상으로.</h1>
      {loading ? <p className="auth-loading" role="status"><LoaderCircle className="spin" size={18} /> 로그인 정보를 확인하고 있어요.</p> : <>
        <p>Google 계정으로 로그인하고<br />나만의 영상 제작을 시작하세요.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="google-sign-in" disabled={!onSignIn || busy} onClick={onSignIn}>
          {busy ? <LoaderCircle className="spin" size={20} /> : <GoogleMark />}{busy ? "Google로 연결 중…" : "Google로 계속하기"}
        </button>
        {error && onRetry && <button className="text-button auth-retry" onClick={onRetry}>로그인 상태 다시 확인</button>}
        <small className="auth-storage-note">현재 프로젝트와 업로드 파일은 이 브라우저에 저장됩니다.</small>
      </>}
    </section>
    <span className="auth-footer">한국을 빛낸 100인 · Great100 Studio</span>
  </main>;
}

export function AccountMenu() {
  const { client, session } = useContext(AuthContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!client || !session) return <span className="local-account-note">로컬 작업 · 이 브라우저에 저장</span>;
  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
    } catch {
      setError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };
  return <div className="account-menu">
    <div className="account-details"><strong>{session.user.email || "Google 계정"}</strong><small>작업은 이 브라우저에 저장됩니다.</small></div>
    <button className="btn ghost" onClick={signOut} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />} 로그아웃</button>
    {error && <span className="account-error" role="alert">{error}</span>}
  </div>;
}
