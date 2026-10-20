import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../api/narration";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: auth } }) }));
const requestId = "0ccf3eee-c2c3-478c-a974-cde3a90d03fb";
const body = { text: "세종은 새로운 글자를 만들었다.", voice: "alloy", pace: "normal", request_id: requestId };
function request(value: unknown = body, token = "user-token") { return { method: "POST", body: value, headers: { authorization: token && `Bearer ${token}` } } as VercelRequest; }
function response() {
  const result = { statusCode: 200, body: undefined as any };
  const api = { setHeader: vi.fn(), status: (code: number) => { result.statusCode = code; return api; }, json: (value: unknown) => { result.body = value; return api; } };
  return { result, api: api as unknown as VercelResponse };
}
function audio(overrides = {}) { return { choices: [{ finish_reason: "stop", message: { audio: { data: "aGVsbG8=", transcript: body.text } } }], usage: { prompt_tokens: 60, completion_tokens: 100, total_tokens: 160 }, ...overrides }; }
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "server-only-key"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co"); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-key");
  auth.mockResolvedValue({ data: { user: { id: "account-a" } }, error: null });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("authenticated scene narration endpoint", () => {
  it("rejects unauthenticated and expired sessions before making a paid call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const missing = response(); await handler(request(body, ""), missing.api); expect(missing.result.statusCode).toBe(401);
    auth.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    const expired = response(); await handler(request(), expired.api); expect(expired.result.statusCode).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it("requires server configuration without exposing credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const output = response(); await handler(request(), output.api); expect(output.result.statusCode).toBe(503);
    expect(JSON.stringify(output.result.body)).not.toContain("server-only-key");
  });
  it.each([{ ...body, text: " " }, { ...body, text: "가".repeat(1801) }, { ...body, voice: "custom" }, { ...body, pace: "toString" }, { ...body, request_id: "invalid" }])("rejects invalid inputs before paid generation: %j", async input => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const output = response(); await handler(request(input), output.api);
    expect(output.result.statusCode).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("requests nonstored MP3 and returns only validated speech and usage metadata", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(audio()), { headers: { "x-request-id": "openai-request" } })); vi.stubGlobal("fetch", fetch);
    const output = response(); await handler(request(), output.api);
    expect(output.result.statusCode).toBe(200);
    const sent = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({ model: "gpt-audio-1.5", store: false, audio: { voice: "alloy", format: "mp3" } });
    expect(sent.messages[1].content).toBe(body.text);
    expect(output.result.body.generation).toMatchObject({ input_text: body.text, request_id: requestId, provider_request_id: "openai-request", usage: { input_tokens: 60, output_tokens: 100, total_tokens: 160 } });
    expect(JSON.stringify(output.result.body)).not.toContain("server-only-key");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(body.text);
  });
  it.each([
    { choices: [{ finish_reason: "length", message: { audio: { data: "aGVsbG8=", transcript: body.text } } }] },
    { choices: [{ finish_reason: "stop", message: { audio: { data: "aGVsbG8=", transcript: "다른 내용을 추가했다" } } }] },
    { choices: [{ finish_reason: "stop", message: {} }] },
  ])("rejects truncated, changed or missing speech: %j", async value => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(audio(value)))));
    const output = response(); await handler(request(), output.api); expect(output.result.statusCode).toBe(502); expect(output.result.body.audio_base64).toBeUndefined();
  });
  it("maps limits and timeouts without automatically retrying or leaking upstream errors", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "secret upstream detail" } }), { status: 429 })); vi.stubGlobal("fetch", fetch);
    const limited = response(); await handler(request(), limited.api); expect(limited.result.statusCode).toBe(429); expect(JSON.stringify(limited.result.body)).not.toContain("secret");
    fetch.mockRejectedValueOnce(new Error("server-only-key"));
    const timeout = response(); await handler(request(), timeout.api); expect(timeout.result.statusCode).toBe(502); expect(timeout.result.body.error).toContain("자동 재시도하지"); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
