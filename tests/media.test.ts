import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import handler from "../api/media";

const mock = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), send: vi.fn(), sign: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mock.getUser }, from: mock.from }) }));
vi.mock("@aws-sdk/client-s3", async importOriginal => ({
  ...await importOriginal<typeof import("@aws-sdk/client-s3")>(), S3Client: class { send = mock.send; },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mock.sign }));
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const prefix = `${userId}/${projectId}/`;
let owned = true;
let databaseError: object | null = null;
let filters: [string, unknown][];

async function call(body: object, authorization = "Bearer user-token") {
  const result = { status: 200, body: undefined as any };
  const response = { setHeader: vi.fn(), status(code: number) { result.status = code; return response; }, json(value: unknown) { result.body = value; return response; } };
  await handler({ method: "POST", headers: { authorization }, body } as VercelRequest, response as unknown as VercelResponse);
  return result;
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co"); vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-key");
  for (const name of ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) vi.stubEnv(name, "test-value");
  mock.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  owned = true; databaseError = null; filters = [];
  mock.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: owned ? { id: projectId } : null, error: databaseError }),
      limit: async () => ({ data: [], error: databaseError }),
    };
    return query;
  });
  mock.send.mockResolvedValue({}); mock.sign.mockResolvedValue("https://private-r2.example/signed");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("rejects missing and invalid sessions before accessing files", async () => {
  expect((await call({ operation: "upload", projectId }, "")).status).toBe(401);
  mock.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
  expect((await call({ operation: "read", projectId, keys: [`${prefix}image.png`] })).status).toBe(401);
  expect(mock.sign).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});

it("checks project ownership before signing or deleting any file", async () => {
  owned = false;
  for (const operation of ["upload", "read", "delete", "delete-project"]) {
    expect((await call({ operation, projectId, key: `${prefix}image.png`, keys: [`${prefix}image.png`], contentType: "image/png", size: 10 })).status).toBe(404);
  }
  expect(filters).toContainEqual(["owner_id", userId]);
  expect(mock.sign).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});

it("rejects other projects' keys, traversal, and partially unauthorized batches", async () => {
  for (const key of [`${userId}/another-project/image.png`, `${prefix}../other.png`, `other-user/${projectId}/image.png`]) {
    expect((await call({ operation: "read", projectId, keys: [`${prefix}valid.png`, key] })).status).toBe(400);
    expect((await call({ operation: "delete", projectId, key })).status).toBe(400);
  }
  expect(mock.sign).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});

it("signs a bounded upload into a server-selected account/project path", async () => {
  const result = await call({ operation: "upload", projectId, contentType: "image/png", size: 1200, key: "chosen-by-client" });
  expect(result.status).toBe(200); expect(result.body.key.startsWith(prefix)).toBe(true);
  const [, command, options] = mock.sign.mock.calls[0];
  expect(command).toBeInstanceOf(PutObjectCommand);
  expect(command.input).toMatchObject({ Key: result.body.key, ContentType: "image/png", ContentLength: 1200 });
  expect(options.expiresIn).toBe(900);
  for (const contentType of ["text/html", "__proto__", 123]) expect((await call({ operation: "upload", projectId, contentType, size: 10 })).status).toBe(400);
  expect((await call({ operation: "upload", projectId, contentType: "image/png", size: 12_000_001 })).status).toBe(400);
});

it("reports setup readiness without requiring file credentials to exist", async () => {
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
  expect((await call({ operation: "status" })).body).toEqual({ databaseReady: true, storageReady: false });
  databaseError = { message: "table missing" };
  expect((await call({ operation: "status" })).body).toEqual({ databaseReady: false, storageReady: false });
  expect(mock.send).not.toHaveBeenCalled();
});

it("deletes every page under the owned prefix and stops on partial failures", async () => {
  mock.send.mockImplementation(async command => command instanceof ListObjectsV2Command
    ? { Contents: mock.send.mock.calls.filter(([value]) => value instanceof ListObjectsV2Command).length === 1 ? [{ Key: `${prefix}one.mp4` }, { Key: `${prefix}two.png` }] : [] }
    : {});
  expect((await call({ operation: "delete-project", projectId })).status).toBe(200);
  const commands = mock.send.mock.calls.map(([command]) => command);
  expect(commands.filter(command => command instanceof ListObjectsV2Command)).toHaveLength(2);
  expect(commands.find(command => command instanceof DeleteObjectsCommand).input.Delete.Objects).toEqual([{ Key: `${prefix}one.mp4` }, { Key: `${prefix}two.png` }]);
  mock.send.mockImplementation(async command => command instanceof ListObjectsV2Command ? { Contents: [{ Key: `${prefix}one.mp4` }] } : { Errors: [{ Code: "AccessDenied" }] });
  expect((await call({ operation: "delete-project", projectId })).status).toBe(502);
});
