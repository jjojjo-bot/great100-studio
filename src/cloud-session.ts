import type { Session, SupabaseClient } from "@supabase/supabase-js";

export interface CloudSession { client: SupabaseClient; userId: string }
let current: CloudSession | null = null;

export function setCloudSession(client: SupabaseClient | null, session: Session | null): void {
  current = client && session ? { client, userId: session.user.id } : null;
}

export function getCloudSession(): CloudSession | null { return current; }

export async function cloudAccessToken(context: CloudSession): Promise<string> {
  const { data, error } = await context.client.auth.getSession();
  if (error || !data.session || data.session.user.id !== context.userId || current?.userId !== context.userId) {
    throw new Error("로그인한 계정이 바뀌었습니다. 작업을 다시 열어 주세요.");
  }
  return data.session.access_token;
}
