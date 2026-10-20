import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { importLocalProject, listLocalProjects, localProjectsForImport } from "./platform";
import type { ProjectData } from "./types";

const mock = vi.hoisted(() => ({
  create: vi.fn(), read: vi.fn(), save: vi.fn(), upload: vi.fn(), export: vi.fn(),
  saved: new Map<string, ProjectData>(),
  context: { userId: "alice", client: {} },
}));
vi.mock("./cloud-session", () => ({ cloudAccessToken: async () => "token" }));
vi.mock("./cloud", () => ({
  cloudContext: () => mock.context,
  createCloudProject: mock.create, readCloudProject: mock.read, saveCloudProject: mock.save,
  uploadCloudFile: mock.upload, saveCloudRenderedVideo: mock.export,
  deleteCloudProject: vi.fn(), downloadCloudFile: vi.fn(), getCloudRenderedVideo: vi.fn(), listCloudProjects: vi.fn(), nextCloudEpisode: vi.fn(),
}));

beforeEach(async () => {
  vi.stubGlobal("window", {}); vi.clearAllMocks(); mock.saved.clear();
  await listLocalProjects();
  const db = await openDB("great100-studio", 6);
  for (const store of ["projects", "audio", "media", "videos", "settings"]) await db.clear(store);
  db.close();
  mock.create.mockImplementation(async draft => {
    const project = { ...draft, episode: 9, folder_name: "009_이순신", project_path: "projects/009_이순신", cloud_version: 1 };
    mock.saved.set(project.id, structuredClone(project)); return project;
  });
  mock.read.mockImplementation(async id => structuredClone(mock.saved.get(id) || null));
  mock.save.mockImplementation(async project => { mock.saved.set(project.id, structuredClone(project)); });
  mock.upload.mockImplementation(async () => `private-file-${mock.upload.mock.calls.length}`);
  mock.export.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

async function seed() {
  const project = createProjectDraft(2, "이순신", "장군", SAMPLE_WORK_TEXT);
  project.project_path = `projects/${project.folder_name}`;
  const image = (id: string) => ({ id, path: `${project.project_path}/02_character/${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" as const });
  project.anchor.candidates = [image("anchor")]; project.anchor.selected_candidate_id = "anchor";
  project.thumbnail.candidates = [image("thumbnail")];
  project.scenes[0].candidates = [{ ...image("video"), media_type: "video", path: `${project.project_path}/03_images/scene01/clip.mp4`, duration_sec: 2 }];
  project.scenes[0].support_candidates = [image("support")];
  project.background_music = { name: "music.mp3", mime_type: "audio/mpeg", path: `${project.project_path}/01_source/music.mp3` };
  project.scenes[0].narration_audio = { name: "voice.wav", mime_type: "audio/wav", duration_sec: 2, path: `${project.project_path}/03_images/scene01/voice.wav` };
  const db = await openDB("great100-studio", 6);
  await db.put("projects", project);
  await db.put("audio", { id: project.id, blob: new Blob(["music"], { type: "audio/mpeg" }) });
  await db.put("audio", { id: `${project.id}:narration:${project.scenes[0].id}`, blob: new Blob(["voice"], { type: "audio/wav" }) });
  await db.put("media", { id: `${project.id}:scene-video:video`, blob: new Blob(["video"], { type: "video/mp4" }) });
  await db.put("videos", { id: project.id, updated_at: project.updated_at, render_version: 9, blob: new Blob(["export"], { type: "video/mp4" }) });
  db.close(); return project;
}

it("copies every media kind into the current account and keeps the local original intact", async () => {
  const original = await seed();
  expect((await localProjectsForImport()).map(project => project.id)).toContain(original.id);
  await importLocalProject(original.id);
  const migrated = [...mock.saved.values()][0];
  expect(migrated.id).not.toBe(original.id); expect(migrated.cloud_owner_id).toBe("alice"); expect(migrated.migration_pending).toBe(false);
  expect(migrated.episode).toBe(9); expect(migrated.source_text).toBe(original.source_text);
  expect(migrated.anchor.candidates[0]).toMatchObject({ storage_key: expect.any(String), path: "projects/009_이순신/02_character/anchor.png" });
  expect(migrated.scenes[0].candidates[0]).toMatchObject({ storage_key: expect.any(String), preview_storage_key: expect.any(String) });
  expect(migrated.background_music?.storage_key).toBeTruthy(); expect(migrated.scenes[0].narration_audio?.storage_key).toBeTruthy();
  expect(mock.upload).toHaveBeenCalledTimes(7); expect(mock.export).toHaveBeenCalledTimes(1);
  const db = await openDB("great100-studio", 6);
  expect(await db.get("projects", original.id)).toEqual(original);
  expect(await db.count("media")).toBe(1); expect(await db.count("audio")).toBe(2); expect(await db.count("videos")).toBe(1);
  db.close();
  expect(await localProjectsForImport()).toEqual([]);
  await importLocalProject(original.id);
  expect(mock.create).toHaveBeenCalledTimes(1); expect(mock.upload).toHaveBeenCalledTimes(7);
});

it("resumes an interrupted transfer using its existing project and uploaded files", async () => {
  const original = await seed();
  mock.export.mockRejectedValueOnce(new Error("connection lost"));
  await expect(importLocalProject(original.id)).rejects.toThrow("connection lost");
  expect([...mock.saved.values()][0].migration_pending).toBe(true);
  expect(await localProjectsForImport()).toHaveLength(1);
  await importLocalProject(original.id);
  expect(mock.create).toHaveBeenCalledTimes(1); expect(mock.upload).toHaveBeenCalledTimes(7);
  expect([...mock.saved.values()][0].migration_pending).toBe(false);
  expect(await listLocalProjects()).toEqual([original]);
});

it("keeps an older rendered MP4 locally and requires regeneration for the new timeline", async () => {
  const project = await seed();
  const db = await openDB("great100-studio", 6);
  const old = await db.get("videos", project.id); old.render_version = 8; await db.put("videos", old);
  await importLocalProject(project.id);
  expect(mock.export).not.toHaveBeenCalled();
  expect((await db.get("videos", project.id)).render_version).toBe(8);
  expect([...mock.saved.values()][0].migration_pending).toBe(false);
  db.close();
});
