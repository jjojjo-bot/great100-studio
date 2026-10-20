import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { buildProjectZip, createProjectOnDisk, discardSceneNarration, getSceneNarration, inspectSceneNarration, savePreparedNarration, saveProject } from "./platform";
import { proposeNarrationTiming } from "./timeline";
import { applyBatchNarration, batchNarrationFingerprint, retainBatchNarration } from "./scene-narration-batch";
import { listProjects } from "./platform";

it("reopens and exports a batch recording reassigned from a removed scene using its original local key and bytes", async () => {
  const project = editorProject(); project.project_path = await createProjectOnDisk(project); const origin = project.scenes[1];
  const file = new File(["same original WAV bytes"], "scene_02.wav", { type: "audio/wav" }), prepared = { file, duration: 2, mime: "audio/wav", extension: "wav" };
  const audio = await savePreparedNarration(project, origin, prepared), detached = { ...project, scenes: project.scenes.filter(scene => scene.id !== origin.id) }, kept = retainBatchNarration(detached, origin.id, audio), scene = kept.project.scenes[1];
  const next = applyBatchNarration(kept.project, { projectId: project.id, sceneId: scene.id, prepared, selection: "keep", expected: batchNarrationFingerprint(scene) }, kept.narration); await saveProject(next);
  const [reopened] = await listProjects(); expect(await (await getSceneNarration(reopened, reopened.scenes[1]))!.text()).toBe("same original WAV bytes");
  expect(reopened.media!.assets.find(asset => asset.id === kept.narration.asset_id)!.local_key).toContain(`:narration:${origin.id}:`);
  const zip = await JSZip.loadAsync(await (await buildProjectZip(reopened)).arrayBuffer()), root = `${reopened.folder_name}/`, manifest = JSON.parse(await zip.file(root + "01_source/media_manifest.json")!.async("string"));
  expect(await zip.file(root + manifest.find((entry: { asset_id: string }) => entry.asset_id === kept.narration.asset_id).archive_path)!.async("string")).toBe("same original WAV bytes");
});

beforeEach(() => {
  vi.stubGlobal("window", {}); vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("AudioContext", class { decodeAudioData = async () => ({ duration: 14 }); close = async () => {}; });
});
afterEach(() => vi.unstubAllGlobals());

it("inspects without overwriting old audio and keeps immutable file versions through cancellation and replacement", async () => {
  const project = editorProject(); project.project_path = await createProjectOnDisk(project);
  const scene = project.scenes[0];
  scene.narration_audio = { name: "old.wav", path: `${project.project_path}/03_images/scene01/narration.wav`, mime_type: "audio/wav", duration_sec: 2 };
  const db = await openDB("great100-studio", 6);
  const old = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
  await db.put("audio", { id: `${project.id}:narration:${scene.id}`, blob: old });
  await saveProject(project);
  const file = new File([new Uint8Array([82, 73, 70, 70])], "new.wav", { type: "audio/wav" });
  const prepared = await inspectSceneNarration(file);
  expect(prepared.duration).toBe(14);
  expect(await db.count("audio")).toBe(1);
  expect((await getSceneNarration(project, scene))!.size).toBe(3);
  const proposal = proposeNarrationTiming(project, scene.id, 14, "keep");
  const unused = await savePreparedNarration(project, proposal.project.scenes[0], prepared);
  expect(unused.path).toContain(unused.id);
  expect(await db.count("audio")).toBe(2);
  await discardSceneNarration(project, scene, unused);
  expect(await db.count("audio")).toBe(1);
  const recording = await savePreparedNarration(project, proposal.project.scenes[0], prepared);
  proposal.project.scenes[0].narration_audio = recording;
  await saveProject(proposal.project);
  expect((await getSceneNarration(proposal.project, proposal.project.scenes[0]))!.size).toBe(file.size);
  expect((await getSceneNarration(project, scene))!.size).toBe(3);
  const backup = await db.get("settings", `editor-backup:${project.id}:1`);
  expect(backup.scenes[0]).toMatchObject({ duration: 10 });
  const saved = await db.get("projects", project.id);
  expect(saved.media.assets.some((asset: { path: string }) => asset.path === scene.narration_audio!.path)).toBe(true);
  expect(backup.source).toEqual(project.source);
  const zip = await JSZip.loadAsync(await (await buildProjectZip(proposal.project)).arrayBuffer());
  const folder = `${project.folder_name}/03_images/scene01/`;
  expect(zip.file(`${folder}narration_${recording.id}.wav`)).not.toBeNull();
  expect(zip.file(`${folder}narration.wav`)).not.toBeNull();
  db.close();
});
