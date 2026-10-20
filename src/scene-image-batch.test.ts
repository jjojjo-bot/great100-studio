import { afterEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { attachBatchImage, batchVisualFingerprint, inspectBatchImage, suggestedSceneId, type BatchImageRequest } from "./scene-image-batch";
import { prepareEditorWrite } from "./editor-format";
import { sceneComposition } from "./media-composition";
import { EditorHistory } from "./editor-history";
import { mergeScene } from "./scene-merge";
import { moveScene } from "./scene-order";
import type { ImageCandidate, ProjectData } from "./types";

const image = (id: string): ImageCandidate => ({ id, path: `images/${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" });
const request = (project: ProjectData, selection: BatchImageRequest["selection"] = "fill"): BatchImageRequest => ({ projectId: project.id, sceneId: project.scenes[0].id, file: new File(["image"], "scene_01.png"), selection, expectedVisual: batchVisualFingerprint(project.scenes[0]) });
const filled = () => { const project = editorProject(); for (const scene of project.scenes) { scene.candidates = [image(scene.id)]; scene.selected_candidate_id = scene.id; } return prepareEditorWrite(project); };
afterEach(() => vi.unstubAllGlobals());

it("suggests explicit scene numbers, rejects ambiguous/unlabeled files, and uses current display numbers after moves", () => {
  const project = editorProject(), scenes = project.scenes;
  for (const name of ["scene_01.png", "Scene 001 final.JPG", "EP100_scene-1.webp", "장면 01_서재.png", "01_서재.webp", "1.png"]) expect(suggestedSceneId(name, scenes), name).toBe(scenes[0].id);
  for (const name of ["ChatGPT Image Oct 20.png", "2026-10-20.jpg", "EP01.png", "scene1_scene2.png", "scene99.jpg", "portrait2.png", "01letters.png"]) expect(suggestedSceneId(name, scenes), name).toBe("");
  const moved = moveScene(project, scenes[0].id, 1);
  expect(suggestedSceneId("01.png", moved.scenes)).toBe(scenes[1].id);
});
it("fills missing screens, preserves selected videos and candidate-only imports", () => {
  const project = editorProject(), original = structuredClone(project), added = image("new");
  const filled = attachBatchImage(project, request(project), added).project;
  expect(filled.scenes[0].selected_candidate_id).toBe("new"); expect(project).toEqual(original);
  const video = { ...image("video"), media_type: "video" as const, duration_sec: 20 };
  filled.scenes[0].candidates.push(video); filled.scenes[0].selected_candidate_id = "video";
  const kept = attachBatchImage(filled, request(filled), image("another")).project;
  expect(kept.scenes[0].selected_candidate_id).toBe("video"); expect(kept.scenes[0].candidates).toHaveLength(3);
  expect(attachBatchImage(project, request(project, "candidate"), added).project.scenes[0].selected_candidate_id).toBeUndefined();
});
it("keeps a merged screen by default and can undo a replacement without deleting originals or uploaded candidates", () => {
  const merged = mergeScene(filled(), "scene_01"), planned = request(merged, "replace");
  const kept = prepareEditorWrite(attachBatchImage(merged, { ...planned, selection: "fill" }, image("kept")).project);
  expect(sceneComposition(kept.scenes[0]).visuals).toHaveLength(2);
  const replaced = prepareEditorWrite(attachBatchImage(kept, planned, image("replacement")).project);
  const history = new EditorHistory(); history.record(kept, replaced, "이미지 일괄 배치");
  expect(sceneComposition(replaced.scenes[0]).visuals).toHaveLength(1);
  const undo = history.undo(replaced); expect(undo.status).toBe("applied");
  if (undo.status !== "applied") throw new Error("undo");
  expect(sceneComposition(undo.project.scenes[0]).visuals).toHaveLength(2);
  expect(undo.project.scenes[0].candidates.some(item => item.id === "replacement")).toBe(true);
  expect(undo.project.media?.assets.some(item => item.id === "candidate:replacement")).toBe(true);
  expect(undo.project.source).toEqual(merged.source);
  expect(history.redo(undo.project).status).toBe("applied");
});
it("does not change an automatic video intro when adding candidates with screen preservation", () => {
  for (const withIntro of [false, true]) {
    const project = editorProject(), scene = project.scenes[0];
    scene.candidates = [{ ...image("video"), media_type: "video", duration_sec: 20 }, ...(withIntro ? [image("intro")] : [])];
    scene.selected_candidate_id = "video";
    const before = sceneComposition(scene).visuals;
    const result = attachBatchImage(project, request(project), image("new-candidate"));
    expect(result.selected).toBe(false); expect(sceneComposition(result.project.scenes[0]).visuals).toEqual(before);
    expect(result.project.scenes[0].video_intro_candidate_id).toBe(withIntro ? "intro" : null);
  }
});
it("uses stable IDs after reordering and preserves user selection changed during an upload", () => {
  const project = filled(), planned = request(project, "replace"), moved = moveScene(project, planned.sceneId, 1);
  const applied = attachBatchImage(moved, planned, image("new")).project;
  expect(applied.scenes[1].selected_candidate_id).toBe("new"); expect(applied.scenes[0].selected_candidate_id).toBe("scene_02");
  moved.scenes[1].candidates.push(image("manual")); moved.scenes[1].selected_candidate_id = "manual";
  const guarded = attachBatchImage(moved, planned, image("late"));
  expect(guarded.project.scenes[1].selected_candidate_id).toBe("manual"); expect(guarded.note).toContain("변경되어 후보로만");
});
it("retains an original if its target is merged away without assigning it by a reused scene number", () => {
  const project = filled(), planned = { ...request(project), sceneId: project.scenes[1].id, expectedVisual: batchVisualFingerprint(project.scenes[1]) };
  const merged = mergeScene(project, project.scenes[0].id), attached = attachBatchImage(merged, planned, image("late"));
  expect(attached.project.scenes).toEqual(merged.scenes);
  expect(attached.project.media?.assets.some(item => item.id === "candidate:late")).toBe(true);
  expect(attached.note).toContain("원본 자료");
  expect(() => attachBatchImage({ ...merged, id: "other" }, planned, image("late"))).toThrow("프로젝트가 다릅니다");
});
it("validates bytes, MIME, size, and real image decoding before uploading", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); const decode = vi.fn().mockResolvedValue(undefined);
  await inspectBatchImage(new File([png], "01.png", { type: "image/png" }), decode); expect(decode).toHaveBeenCalledOnce();
  await expect(inspectBatchImage(new File([png], "01.jpg", { type: "image/jpeg" }), decode)).rejects.toThrow("형식");
  await expect(inspectBatchImage(new File(["not image"], "01.png"), decode)).rejects.toThrow("PNG");
  await expect(inspectBatchImage(new File([], "empty.png"), decode)).rejects.toThrow("12MB");
  await expect(inspectBatchImage(new File([new Uint8Array(12_000_001)], "big.png"), decode)).rejects.toThrow("12MB");
  await expect(inspectBatchImage(new File([png], "corrupt.png"), vi.fn().mockRejectedValue(new Error("decode")))).rejects.toThrow("읽을 수 없습니다");
  const close = vi.fn(); vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close }));
  await inspectBatchImage(new File([png], "01.png")); expect(close).toHaveBeenCalledOnce();
});
