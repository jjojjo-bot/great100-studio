import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { setCloudSession } from "./cloud-session";
import { cloudContext, cloudFileUrls, listCloudProjects, saveCloudProject, saveCloudRenderedVideo, uploadCloudFile } from "./cloud";
import { editorProject } from "../tests/fixtures/editor-project";

const userId = "alice";
const session = { user: { id: userId }, access_token: "alice-token" } as Session;
let rpc: ReturnType<typeof vi.fn>;
let getSession: ReturnType<typeof vi.fn>;
let from: ReturnType<typeof vi.fn>;
const project = () => ({ ...createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT), cloud_owner_id: userId, cloud_version: 0 });
beforeEach(() => {
  rpc = vi.fn(); getSession = vi.fn(async () => ({ data: { session }, error: null }));
  from = vi.fn();
  setCloudSession({ auth: { getSession }, rpc, from } as unknown as SupabaseClient, session);
});
afterEach(() => { setCloudSession(null, null); vi.unstubAllGlobals(); });

it("serializes rapid saves against consecutive server revisions", async () => {
  let revision = 0;
  let active = 0;
  rpc.mockImplementation(async (_name, input) => {
    expect(active++).toBe(0);
    await Promise.resolve();
    expect(input.p_expected_version).toBe(revision);
    active--;
    return { data: [{ version: ++revision }], error: null };
  });
  const draft = project();
  await Promise.all([saveCloudProject(draft), saveCloudProject({ ...draft, person: "수정 1" }), saveCloudProject({ ...draft, person: "수정 2" })]);
  expect(revision).toBe(3); expect(rpc.mock.calls[2][1].p_data.person).toBe("수정 2");
});

it("round-trips editor metadata and unknown fields through the version-aware JSONB RPC", async () => {
  const draft = { ...editorProject(), cloud_owner_id: userId, cloud_version: 0, extra: { keep: true } };
  rpc.mockResolvedValue({ data: [{ version: 1 }], error: null });
  await saveCloudProject(draft);
  expect(rpc.mock.calls[0][0]).toBe("great100_save_editor_project");
  const stored = rpc.mock.calls[0][1].p_data;
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [{ id: draft.id, owner_id: userId, data: stored, version: 1 }], error: null }) };
  from.mockReturnValue(query);
  const [reopened] = await listCloudProjects();
  expect(reopened).toMatchObject({ editor_version: 1, editor: draft.editor, extra: draft.extra, source: draft.source });
  expect(reopened.scenes[0].captions).toEqual(draft.scenes[0].captions);
  await expect(saveCloudProject({ ...draft, editor_version: 2 })).rejects.toThrow("새로운 편집 형식");
  await expect(saveCloudProject({ ...draft, source_text: "다른 제작안" })).rejects.toThrow("원본 제작안");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("requires the editor migration instead of falling back to the legacy save RPC", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  await expect(saveCloudProject(project())).rejects.toThrow("편집 형식 저장 설정");
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][0]).toBe("great100_save_editor_project");
});

it("stops queued edits after another PC wins a revision conflict", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "PROJECT_CONFLICT" } });
  const draft = { ...project(), cloud_version: 4 };
  const results = await Promise.allSettled([saveCloudProject(draft), saveCloudProject({ ...draft, person: "뒤따른 수정" })]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].p_expected_version).toBe(4);
});

it("uploads generated images once and persists object keys without expiring URLs", async () => {
  const nativeFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).startsWith("data:")) return nativeFetch(url);
    if (url === "/api/media") {
      expect(options?.headers).toMatchObject({ Authorization: "Bearer alice-token" });
      return Response.json({ key: "alice/project/image.svg", url: "https://private-r2.example/put" });
    }
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  let version = 0;
  rpc.mockImplementation(async () => ({ data: [{ version: ++version }], error: null }));
  const draft = project();
  draft.anchor.candidates = [{ id: "generated", path: "image.svg", preview_url: "data:image/svg+xml;charset=utf-8,%3Csvg/%3E", created_at: "now", mode: "mock" }];
  await saveCloudProject(draft); await saveCloudProject(draft);
  expect(fetchMock.mock.calls.filter(([url]) => url === "https://private-r2.example/put")).toHaveLength(1);
  const stored = rpc.mock.calls[1][1].p_data;
  expect(stored.anchor.candidates[0]).toMatchObject({ storage_key: "alice/project/image.svg", preview_url: "" });
  expect(stored.cloud_owner_id).toBeUndefined(); expect(stored.cloud_version).toBeUndefined();
  expect(draft.anchor.candidates[0].preview_url).toContain("data:image/");
});

it("does not delete old media until the edited project is saved successfully", async () => {
  const draft = project();
  draft.anchor.candidates = [{ id: "original", path: "image.png", storage_key: "original-file", preview_url: "https://signed", mode: "uploaded", created_at: "now" }];
  rpc.mockResolvedValueOnce({ data: [{ version: 1 }], error: null }).mockResolvedValueOnce({ error: { code: "40001" } });
  const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ deleted: true })); vi.stubGlobal("fetch", fetchMock);
  await saveCloudProject(draft);
  const removed = { ...draft, anchor: { ...draft.anchor, candidates: [] } };
  await expect(saveCloudProject(removed)).rejects.toThrow("다른 PC");
  expect(fetchMock).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({ data: [{ version: 2 }], error: null });
  await saveCloudProject(removed);
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ operation: "delete", key: "original-file" });
});

it("batches large projects' file URLs and normalizes SVG content types", async () => {
  const batches: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url !== "/api/media") return new Response();
    const body = JSON.parse(options.body); batches.push(body);
    return Response.json(body.operation === "read" ? { urls: Object.fromEntries(body.keys.map((key: string) => [key, `signed:${key}`])) } : { key: "svg", url: "https://r2.example/put" });
  }));
  const keys = Array.from({ length: 205 }, (_, index) => `file-${index}`);
  const urls = await cloudFileUrls("project", [...keys, keys[0]]);
  expect(batches.map(batch => batch.keys.length)).toEqual([100, 100, 5]); expect(Object.keys(urls)).toHaveLength(205);
  await uploadCloudFile("project", new Blob(["<svg/>"], { type: "image/svg+xml;charset=utf-8" }));
  expect(batches[3].contentType).toBe("image/svg+xml");
});

it("blocks old-account writes after the login changes", async () => {
  const draft = project();
  // The save was initiated while this account was active, then waits for its session.
  let resolveSession!: (value: unknown) => void;
  getSession.mockImplementationOnce(() => new Promise(resolve => { resolveSession = resolve; }));
  const saving = saveCloudProject(draft);
  await vi.waitFor(() => expect(resolveSession).toBeTypeOf("function"));
  setCloudSession(null, null);
  resolveSession({ data: { session }, error: null });
  await expect(saving).rejects.toThrow("계정이 바뀌었습니다");
  expect(rpc).not.toHaveBeenCalled();
  expect(() => cloudContext(draft)).toThrow("계정으로 다시 로그인");
});

it.each([true, false])("retains the valid export until its replacement metadata is saved (success: %s)", async success => {
  const deleted: string[] = [];
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { storage_key: "old-export" }, error: null }), upsert: async () => ({ error: success ? null : { code: "network" } }) };
  from.mockReturnValue(query);
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url !== "/api/media") return new Response();
    const body = JSON.parse(options.body);
    if (body.operation === "delete") { deleted.push(body.key); return Response.json({ deleted: true }); }
    return Response.json({ key: "new-export", url: "https://r2.example/upload" });
  }));
  const saving = saveCloudRenderedVideo(project(), new Blob(["mp4"], { type: "video/mp4" }), 8);
  if (success) await saving; else await expect(saving).rejects.toThrow("저장하지 못했습니다");
  expect(deleted).toEqual([success ? "old-export" : "new-export"]);
});
