import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import { buildProjectZip, createProjectOnDisk, deleteCandidateAsset, deleteProject, getMediaAsset, getSceneNarration, getSceneVideo, listProjects, saveProject } from "./platform";
import { candidateAssetId, narrationAssetId } from "./media-composition";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => { vi.stubGlobal("window", {}); vi.stubGlobal("indexedDB", new IDBFactory()); native.invoke.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("reopens originals after renumbering and unlinking, includes detached bytes in ZIP, then deletes all project files", async () => {
  const draft = editorProject(); draft.project_path = await createProjectOnDisk(draft);
  const scene = draft.scenes[0];
  const clip = { id: "clip", path: `${draft.project_path}/03_images/scene01/candidate_clip.mp4`, preview_url: "data:image/png;base64,iVBORw0KGgo=", media_type: "video" as const, duration_sec: 2, mode: "uploaded" as const, created_at: "now" };
  scene.candidates = [clip]; scene.selected_candidate_id = clip.id;
  scene.narration_audio = { name: "old.wav", path: `${draft.project_path}/03_images/scene01/narration.wav`, mime_type: "audio/wav", duration_sec: 2 };
  const db = await openDB("great100-studio", 6);
  await db.put("media", { id: `${draft.id}:scene-video:clip`, blob: new Blob(["video-original"], { type: "video/mp4" }) });
  await db.put("audio", { id: `${draft.id}:narration:${scene.id}`, blob: new Blob(["voice-original"], { type: "audio/wav" }) });
  await saveProject(draft);
  const [project] = await listProjects(); const originalVoice = narrationAssetId(project.scenes[0])!;
  project.scenes[0].number = 8;
  expect(await (await getSceneVideo(project, project.scenes[0], clip))?.text()).toBe("video-original");
  expect(await (await getSceneNarration(project, project.scenes[0]))?.text()).toBe("voice-original");
  await deleteCandidateAsset(project, "scene", clip, 8);
  project.scenes[0].candidates = []; project.scenes[0].selected_candidate_id = undefined; project.scenes[0].narration_audio = undefined;
  await saveProject(project);
  const [reopened] = await listProjects();
  expect(await (await getMediaAsset(reopened, candidateAssetId(clip)))?.text()).toBe("video-original");
  expect(await (await getMediaAsset(reopened, originalVoice))?.text()).toBe("voice-original");
  const zip = await JSZip.loadAsync(await (await buildProjectZip(reopened)).arrayBuffer());
  const root = `${project.folder_name}/`;
  const manifest: Array<{ asset_id: string; archive_path: string }> = JSON.parse(await zip.file(root + "01_source/media_manifest.json")!.async("string"));
  for (const [id, text] of [[candidateAssetId(clip), "video-original"], [originalVoice, "voice-original"]]) {
    expect(await zip.file(root + manifest.find(entry => entry.asset_id === id)!.archive_path)!.async("string")).toBe(text);
  }
  const metadata = JSON.parse(await zip.file(root + "project_data.json")!.async("string"));
  expect(metadata.media.assets).toHaveLength(2); expect(metadata.source).toEqual(draft.source);
  expect(await db.get("settings", `editor-backup:${project.id}:1`)).toBeDefined();
  await deleteProject(reopened);
  expect(await db.count("media")).toBe(0); expect(await db.count("audio")).toBe(0);
  expect(await db.get("settings", `editor-backup:${project.id}:1`)).toBeUndefined(); db.close();
});

it("passes the original native path rather than the changed display number to both legacy file readers", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  native.invoke.mockResolvedValue(btoa("original-bytes"));
  const draft = editorProject(); const scene = draft.scenes[0];
  scene.candidates = [{ id: "clip", path: "projects/original/03_images/scene01/candidate_clip.mp4", preview_url: "poster", mode: "uploaded", media_type: "video", duration_sec: 2, created_at: "now" }];
  scene.narration_audio = { path: "projects/original/03_images/scene01/narration.wav", name: "old.wav", mime_type: "audio/wav", duration_sec: 2 };
  const project = prepareEditorWrite(draft); project.scenes[0].number = 7;
  expect(await (await getSceneVideo(project, project.scenes[0], scene.candidates[0]))?.text()).toBe("original-bytes");
  expect(await (await getSceneNarration(project, project.scenes[0]))?.text()).toBe("original-bytes");
  expect(native.invoke.mock.calls).toEqual([
    ["read_project_media", { projectPath: project.project_path, assetPath: scene.candidates[0].path }],
    ["read_project_media", { projectPath: project.project_path, assetPath: scene.narration_audio.path }],
  ]);
});
