import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { mergeProject } from "../tests/fixtures/merge-project";
import { prepareEditorWrite } from "./editor-format";
import { EditorHistory } from "./editor-history";
import { mergeScene } from "./scene-merge";
import { moveScene } from "./scene-order";
import { sceneComposition } from "./media-composition";
import { timingFingerprint } from "./timeline";
import { applyBatchNarration, batchNarrationFingerprint, narrationRowState, planBatchNarration, retainBatchNarration, type BatchNarrationRequest, type NarrationBatchRow } from "./scene-narration-batch";
import type { ProjectData, SceneNarrationAudio } from "./types";
const audio = (duration = 2): SceneNarrationAudio => ({ id: "new-voice", path: "new-voice.wav", name: "new.wav", mime_type: "audio/wav", duration_sec: duration });
const prepared = (duration = 2) => ({ file: new File(["wave"], "scene_02.wav", { type: "audio/wav" }), extension: "wav", mime: "audio/wav", duration });
const request = (p: ProjectData, index = 0, duration = 2): BatchNarrationRequest => ({ projectId: p.id, sceneId: p.scenes[index].id, prepared: prepared(duration), selection: "keep", expected: batchNarrationFingerprint(p.scenes[index]) });

it.each([1, "2.0", "2.1"] as const)("attaches a fitting recording without changing pictures, timing or source in format %s", version => {
  const p = prepareEditorWrite(editorProject()); p.schema_version = version; const before = structuredClone(p), planned = request(p), kept = retainBatchNarration(p, p.scenes[0].id, audio());
  const next = prepareEditorWrite(applyBatchNarration(kept.project, planned, kept.narration));
  expect(p).toEqual(before); expect(next.scenes[0].narration_audio?.id).toBe("new-voice"); expect(next.scenes[0].duration).toBe(before.scenes[0].duration);
  expect(next.scenes[0].captions).toEqual(before.scenes[0].captions); expect(next.source).toEqual(before.source); expect(next.source_text).toBe(before.source_text);
  expect(sceneComposition(next.scenes[0]).visuals).toEqual(sceneComposition(before.scenes[0]).visuals); expect(next.media!.assets[0].local_key).toBe(`${p.id}:narration:${p.scenes[0].id}:new-voice`);
});
it("preserves existing merged voices by default and restores all old windows with undo after explicit replacement", () => {
  const p = mergeScene(mergeProject(), "scene_01"), planned = { ...request(p), selection: "replace" as const }, kept = retainBatchNarration(p, p.scenes[0].id, audio());
  expect(() => planBatchNarration(p, { ...planned, selection: "keep" })).toThrow("기존 녹음");
  const next = prepareEditorWrite(applyBatchNarration(kept.project, planned, kept.narration)), history = new EditorHistory(); history.record(p, next, "녹음 적용", false, true);
  expect(sceneComposition(next.scenes[0]).narrations).toHaveLength(1); expect(sceneComposition(next.scenes[0]).visuals).toEqual(sceneComposition(p.scenes[0]).visuals);
  const undo = history.undo(next); expect(undo.status).toBe("applied"); if (undo.status !== "applied") throw new Error("undo");
  expect(sceneComposition(undo.project.scenes[0]).narrations).toEqual(sceneComposition(p.scenes[0]).narrations); expect(undo.project.media!.assets.some(asset => asset.id === "narration:new-voice")).toBe(true); expect(history.redo(undo.project).status).toBe("applied");
});
it("requires explicit long-file review and rechecks the whole timeline before applying it", () => {
  const p = prepareEditorWrite(editorProject()), planned = request(p, 0, 12.05), kept = retainBatchNarration(p, p.scenes[0].id, audio(12.05));
  expect(() => planBatchNarration(p, planned)).toThrow("시간 조정");
  planned.timing = { expected: timingFingerprint(p), mode: "scale" };
  const next = prepareEditorWrite(applyBatchNarration(kept.project, planned, kept.narration)); expect(next.scenes[0].duration).toBe(12.1); expect(next.scenes[0].captions![0].end_sec).toBe(12.1); expect(next.scenes[1].start_sec).toBe(12.1);
  const moved = moveScene(p, p.scenes[1].id, 1); expect(() => planBatchNarration(moved, planned)).toThrow("전체 장면 시간");
});
it("allows reordering but rejects changed scripts, caption timing, recordings and missing targets", () => {
  const p = prepareEditorWrite(editorProject()), planned = request(p, 1), moved = moveScene(p, p.scenes[1].id, 1);
  expect(planBatchNarration(moved, planned)).toBe(moved);
  for (const change of [(draft: ProjectData) => { draft.scenes[1].captions![0].text = "다른 대본"; }, (draft: ProjectData) => { draft.scenes[1].captions![0].end_sec -= 1; }, (draft: ProjectData) => { draft.scenes[1].narration_audio = audio(); }]) {
    const draft = structuredClone(p); change(draft); expect(() => planBatchNarration(draft, planned)).toThrow("변경");
  }
  expect(() => planBatchNarration({ ...p, scenes: p.scenes.filter(scene => scene.id !== planned.sceneId) }, planned)).toThrow("없어졌");
});
it("retains a late file under its original storage key after the old scene disappears and reuses it on another scene", () => {
  const p = prepareEditorWrite(editorProject()), origin = p.scenes[1].id, detached = { ...p, scenes: p.scenes.filter(scene => scene.id !== origin) }, kept = retainBatchNarration(detached, origin, audio());
  const next = prepareEditorWrite(applyBatchNarration(kept.project, request(kept.project, 1), kept.narration));
  expect(next.scenes[1].narration_audio?.asset_id).toBe("narration:new-voice"); expect(next.media!.assets.find(asset => asset.id === "narration:new-voice")!.local_key).toBe(`${p.id}:narration:${origin}:new-voice`); expect(retainBatchNarration(next, origin, kept.narration).project).toBe(next);
});
it("blocks duplicate targets, missing targets and long files from normal bulk application", () => {
  const p = editorProject(), one: NarrationBatchRow = { id: "one", file: prepared().file, previewUrl: "blob:voice", prepared: prepared(12), status: "ready", sceneId: p.scenes[1].id }, two = { ...one, id: "two" };
  expect(narrationRowState(p, [one, two], one, "keep")).toMatchObject({ ready: true, long: true }); expect(narrationRowState(p, [one, two], two, "keep").problem).toContain("하나만");
  expect(narrationRowState(p, [one], { ...one, sceneId: "missing" }, "keep").ready).toBe(false);
});
it("rejects a cached original whose path or decoded duration does not match the inspected file", () => {
  const p = prepareEditorWrite(editorProject()), kept = retainBatchNarration(p, p.scenes[0].id, audio());
  expect(() => applyBatchNarration(kept.project, request(p), { ...kept.narration, path: "another.wav" })).toThrow("원본 정보");
  expect(() => applyBatchNarration(kept.project, request(p, 0, 3), kept.narration)).toThrow("원본 정보");
});
