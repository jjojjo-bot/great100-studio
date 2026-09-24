import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/generate";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const originalKey = process.env.OPENAI_API_KEY;
const originalAccess = process.env.GREAT100_ACCESS_KEY;

function response() {
  const result = { statusCode: 200, body: undefined as unknown };
  const api = {
    setHeader: vi.fn(() => api),
    status: vi.fn((code: number) => { result.statusCode = code; return api; }),
    json: vi.fn((body: unknown) => { result.body = body; return api; }),
  };
  return { api: api as unknown as VercelResponse, result };
}

function request(body: unknown, authorization = "") {
  return { method: "POST", body, headers: { authorization } } as VercelRequest;
}

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalAccess === undefined) delete process.env.GREAT100_ACCESS_KEY;
  else process.env.GREAT100_ACCESS_KEY = originalAccess;
  vi.unstubAllGlobals();
});

describe("image generation endpoint", () => {
  it("requires both server configuration and the access code", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GREAT100_ACCESS_KEY;
    const missing = response();
    await handler(request({ prompt: "portrait" }), missing.api);
    expect(missing.result.statusCode).toBe(503);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GREAT100_ACCESS_KEY = "private-access";
    const denied = response();
    await handler(request({ prompt: "portrait" }, "Bearer wrong"), denied.api);
    expect(denied.result.statusCode).toBe(401);
  });

  it("uses generation for text and editing for a selected anchor", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GREAT100_ACCESS_KEY = "private-access";
    const calls: { endpoint: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (endpoint: string, options: RequestInit) => {
      calls.push({ endpoint, body: options.body });
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 });
    }));

    const first = response();
    await handler(request({ prompt: "portrait" }, "Bearer private-access"), first.api);
    expect(first.result.statusCode).toBe(200);
    expect(calls[0].endpoint).toContain("/images/generations");
    expect(JSON.parse(calls[0].body as string).size).toBe("1536x864");

    const second = response();
    await handler(request({ prompt: "same person at sea", reference_image: "data:image/jpeg;base64,aGVsbG8=" }, "Bearer private-access"), second.api);
    expect(second.result.statusCode).toBe(200);
    expect(calls[1].endpoint).toContain("/images/edits");
    expect(calls[1].body).toBeInstanceOf(FormData);
  });
});
