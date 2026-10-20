import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { applyComparedImage, imageCandidates, initialComparisonIds, isCurrentImage, type ImageComparisonRequest } from "./image-comparison";
import { candidateAssetId, sceneComposition, visualSelectionFingerprint } from "./media-composition";
import { prepareEditorWrite } from "./editor-format";
import { EditorHistory } from "./editor-history";
import { mergeScene } from "./scene-merge";
import { splitScene } from "./scene-split";
import { moveScene } from "./scene-order";
import type { ImageCandidate, ProjectData } from "./types";

const image = (id: string): ImageCandidate => ({ id, path: `${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" });
function project() {
  const p = editorProject();
  for (const scene of p.scenes) { scene.candidates = Array.from({ length: 6 }, (_, i) => image(`${scene.id}-${i}`)); scene.selected_candidate_id = scene.candidates[5].id; }
  return prepareEditorWrite(p);
}
const request = (p: ProjectData, candidate = 0, scene = 0): ImageComparisonRequest => ({ projectId: p.id, sceneId: p.scenes[scene].id, candidateId: p.scenes[scene].candidates[candidate].id, expectedVisual: visualSelectionFingerprint(p.scenes[scene]) });

it("includes the current image first, caps comparison at four, and excludes videos", () => {
  const p = project(), scene = p.scenes[0]; scene.candidates[1].media_type = "video";
  expect(imageCandidates(scene)).toHaveLength(5);
  expect(initialComparisonIds(scene)).toEqual([scene.candidates[5].id, scene.candidates[0].id, scene.candidates[2].id, scene.candidates[3].id]);
  expect(isCurrentImage(scene, scene.candidates[5])).toBe(true);
});
it.each([1, "2.0", "2.1"] as const)("changes only the intended scene image for format %s and retains originals, narration, captions and source", version => {
  const p = project(); p.schema_version = version; if (version === 1) { p.source = undefined; p.scenes.forEach(scene => { scene.source_scene_ids = []; }); }
  p.scenes[0].narration_audio = { id: "voice", name: "voice.wav", path: "voice.wav", mime_type: "audio/wav", duration_sec: 2 };
  const before = prepareEditorWrite(p), snapshot = structuredClone(before), next = applyComparedImage(before, request(before));
  expect(before).toEqual(snapshot); expect(next.scenes[0].selected_candidate_id).toBe(before.scenes[0].candidates[0].id);
  expect(next.scenes[0].candidates).toEqual(before.scenes[0].candidates); expect(next.scenes[0].captions).toEqual(before.scenes[0].captions);
  expect(next.scenes[0].duration).toBe(before.scenes[0].duration); expect(next.scenes[0].narration_audio).toEqual(before.scenes[0].narration_audio);
  expect(sceneComposition(next.scenes[0]).narrations).toEqual(sceneComposition(before.scenes[0]).narrations);
  expect(next.scenes[1]).toEqual(before.scenes[1]); expect(next.source).toEqual(before.source); expect(next.source_text).toBe(before.source_text); expect(next.editor).toEqual(before.editor);
  expect(next.media?.assets).toEqual(before.media?.assets);
});
it("uses fixed scene IDs after reordering and ignores unrelated caption edits", () => {
  const before = project(), planned = request(before), moved = moveScene(before, planned.sceneId, 1);
  moved.scenes[1].captions![0].text = "편집한 자막";
  const next = applyComparedImage(moved, planned);
  expect(next.scenes[1].selected_candidate_id).toBe(planned.candidateId); expect(next.scenes[1].captions![0].text).toBe("편집한 자막");
  expect(next.scenes[0].selected_candidate_id).toBe(before.scenes[1].selected_candidate_id);
});
it("rejects removed targets, missing candidates, videos, wrong projects and a changed visual", () => {
  const before = project(), planned = request(before);
  expect(() => applyComparedImage({ ...before, id: "other" }, planned)).toThrow("프로젝트");
  expect(() => applyComparedImage({ ...before, scenes: before.scenes.slice(1) }, planned)).toThrow("장면이 없어");
  const changed = structuredClone(before); changed.scenes[0].selected_candidate_id = changed.scenes[0].candidates[1].id;
  expect(() => applyComparedImage(changed, planned)).toThrow("현재 화면이 변경");
  expect(() => applyComparedImage(before, { ...planned, candidateId: "gone" })).toThrow("후보가 없어");
  before.scenes[0].candidates[0].media_type = "video";
  expect(() => applyComparedImage(before, planned)).toThrow("후보가 없어");
});
it("reselecting the first image of a merged scene replaces all visual sections and can undo and redo without removing a late candidate", () => {
  const before = mergeScene(project(), "scene_01"), first = before.scenes[0].candidates.findIndex(candidate => candidate.id === before.scenes[0].selected_candidate_id);
  expect(initialComparisonIds(before.scenes[0]).slice(0, 2)).toEqual([before.scenes[0].selected_candidate_id, "scene_02-5"]);
  expect(isCurrentImage(before.scenes[0], before.scenes[0].candidates[first])).toBe(false);
  const next = applyComparedImage(before, request(before, first));
  expect(next.scenes[0].selected_candidate_id).toBe(before.scenes[0].selected_candidate_id); expect(sceneComposition(next.scenes[0]).visuals).toHaveLength(1);
  expect(sceneComposition(next.scenes[0]).visuals[0].end_sec).toBe(20);
  const history = new EditorHistory(); history.record(before, next, "비교 이미지 선택");
  const late = prepareEditorWrite({ ...next, scenes: next.scenes.map((scene, i) => i ? scene : { ...scene, candidates: [...scene.candidates, image("late")] }) });
  history.reconcile(late); const undo = history.undo(late); expect(undo.status).toBe("applied"); if (undo.status !== "applied") throw new Error("undo");
  expect(sceneComposition(undo.project.scenes[0]).visuals).toEqual(sceneComposition(before.scenes[0]).visuals);
  expect(undo.project.scenes[0].candidates.some(candidate => candidate.id === "late")).toBe(true);
  const redo = history.redo(undo.project); expect(redo.status).toBe("applied"); if (redo.status !== "applied") throw new Error("redo");
  expect(sceneComposition(redo.project.scenes[0]).visuals[0].asset_id).toBe(candidateAssetId(before.scenes[0].candidates[first]));
  expect(redo.project.source).toEqual(before.source);
});
it("preserves the audio window and other child when choosing an image for a split scene", () => {
  const p = project(); p.scenes[0].narration_audio = { id: "voice", name: "voice.wav", path: "voice.wav", mime_type: "audio/wav", duration_sec: 9 };
  const merged = mergeScene(prepareEditorWrite(p), "scene_01"), divided = splitScene(merged, merged.scenes[0].id, merged.scenes[0].captions![1].id!);
  const next = applyComparedImage(divided, request(divided, 0, 1));
  expect(next.scenes[0]).toEqual(divided.scenes[0]); expect(sceneComposition(next.scenes[1]).narrations).toEqual(sceneComposition(divided.scenes[1]).narrations);
  expect(next.scenes[1].split_origin).toEqual(divided.scenes[1].split_origin); expect(next.editor).toEqual(divided.editor);
});
it("does not change a scene already using the chosen image", () => {
  const p = project(); expect(applyComparedImage(p, request(p, 5))).toBe(p);
});
