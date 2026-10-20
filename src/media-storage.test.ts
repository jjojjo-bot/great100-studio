import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import { buildProjectZip, createProjectOnDisk, deleteCandidateAsset, deleteProject, getMediaAsset, getSceneNarration, getSceneVideo, listProjects, saveProject } from "./platform";
import { candidateAssetId, narrationAssetId } from "./media-composition";
import { moveScene } from "./scene-order";
import { EditorHistory } from "./editor-history";
import { getRenderedVideo, saveRenderedVideo } from "./platform";
import { originalImageIdentity, restoreImageCandidate } from "./image-library";
import { readOriginalImageCandidate } from "./library-image-reader";

it("restores a detached image from the same original, reopens it and exports identical bytes without a second registry entry", async () => {
  const draft = editorProject(); draft.project_path = await createProjectOnDisk(draft);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
  const candidate = { id: "original", path: `${draft.project_path}/03_images/scene01/original.svg`, preview_url: `data:image/svg+xml;base64,${btoa(svg)}`, mode: "mock" as const, created_at: "now" };
  draft.scenes[0].candidates = [candidate]; draft.scenes[0].selected_candidate_id = candidate.id; await saveProject(draft);
  const [original] = await listProjects(); original.scenes[0].candidates = []; original.scenes[0].selected_candidate_id = undefined; await saveProject(original);
  const [detached] = await listProjects(), asset = detached.media!.assets[0];
  const restoredCandidate = await readOriginalImageCandidate(detached, asset, async () => {});
  const restored = restoreImageCandidate(detached, { projectId: detached.id, sceneId: detached.scenes[1].id, assetId: asset.id, expectedOriginal: originalImageIdentity(asset) }, restoredCandidate);
  await saveProject(restored); const [reopened] = await listProjects();
  expect(reopened.scenes[1].candidates[0].path).toBe(candidate.path); expect(reopened.scenes[1].selected_candidate_id).toBeUndefined(); expect(reopened.media!.assets).toHaveLength(1);
  expect(await (await getMediaAsset(reopened, asset.id))!.text()).toBe(svg);
  const zip = await JSZip.loadAsync(await (await buildProjectZip(reopened)).arrayBuffer()), root = `${reopened.folder_name}/`;
  const manifest = JSON.parse(await zip.file(root + "01_source/media_manifest.json")!.async("string")); expect(manifest).toHaveLength(1);
  expect(await zip.file(root + manifest[0].archive_path)!.async("string")).toBe(svg);
  expect(JSON.parse(await zip.file(root + "project_data.json")!.async("string")).source).toEqual(draft.source);
});

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

it("persists a move and its undo, invalidates the old render and exports the selected file under its new number", async () => {
  const draft = editorProject(); draft.project_path = await createProjectOnDisk(draft);
  const scene = draft.scenes[0];
  scene.candidates = [{ id: "image", path: `${draft.project_path}/03_images/scene01/candidate_image.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" }];
  scene.selected_candidate_id = "image";
  await saveProject(draft); const [original] = await listProjects();
  await saveRenderedVideo(original, new Blob(["old-MP4"], { type: "video/mp4" }));
  const moved = { ...moveScene(original, scene.id, 1), updated_at: new Date(Date.parse(original.updated_at) + 1000).toISOString() };
  const history = new EditorHistory(); history.record(original, moved, "장면 순서 변경"); await saveProject(moved);
  const [reopened] = await listProjects();
  expect(reopened.scenes.map(scene => scene.id)).toEqual(["scene_02", "scene_01", "scene_03"]);
  expect(await getRenderedVideo(reopened)).toBeNull();
  expect(await (await getMediaAsset(reopened, "candidate:image"))?.arrayBuffer()).toEqual(await (await getMediaAsset(original, "candidate:image"))?.arrayBuffer());
  const zip = await JSZip.loadAsync(await (await buildProjectZip(reopened)).arrayBuffer());
  expect(zip.file(`${reopened.folder_name}/03_images/scene02/selected.png`)).not.toBeNull();
  expect(zip.file(`${reopened.folder_name}/03_images/scene01/candidate_image.png`)).not.toBeNull();
  const metadata = JSON.parse(await zip.file(`${reopened.folder_name}/project_data.json`)!.async("string"));
  expect(metadata.scenes.map((scene: { id: string }) => scene.id)).toEqual(reopened.scenes.map(scene => scene.id));
  const undo = history.undo(reopened); if (undo.status !== "applied") throw new Error(undo.status);
  await saveProject(undo.project); const [restored] = await listProjects();
  expect(restored.scenes.map(scene => scene.id)).toEqual(original.scenes.map(scene => scene.id));
  expect(restored.source).toEqual(original.source); expect(restored.media).toEqual(original.media);
});
