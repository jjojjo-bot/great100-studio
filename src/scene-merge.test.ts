import { expect, it } from "vitest";
import { mergeProject } from "../tests/fixtures/merge-project";
import { editorProject } from "../tests/fixtures/editor-project";
import { mergeScene, sceneMergeTarget } from "./scene-merge";
import { splitScene } from "./scene-split";
import { moveScene } from "./scene-order";
import { prepareEditorWrite, assertEditorWrite } from "./editor-format";
import { EditorHistory, type HistoryResult } from "./editor-history";
import { buildVideoPlan, visualPlayback } from "./video";
import { narrationTimeline } from "./narration-timeline";
import { mergeProjectChanges } from "./project-changes";
import { projectTimeline } from "./timeline";

const applied = (result: HistoryResult) => { if (result.status !== "applied") throw new Error(result.status); return prepareEditorWrite(result.project); };

it("merges source windows, captions, candidate palettes and core links without changing originals or duration", () => {
  const before = mergeProject(); const snapshot = structuredClone(before);
  const next = mergeScene(before, "scene_01", "scene_02");
  expect(before).toEqual(snapshot); expect(next.editor_version).toBe(5);
  expect(next.scenes.map(scene => [scene.id, scene.number, scene.start_sec, scene.end_sec])).toEqual([["scene_01", 1, 0, 3.4], ["scene_03", 2, 3.4, 5.1]]);
  expect(next.scenes[0].captions).toEqual([...before.scenes[0].captions!, ...before.scenes[1].captions!]);
  expect(next.scenes[0].source_scene_ids).toEqual(["scene_01", "scene_02"]);
  expect(next.editor?.core_scene_ids).toEqual(["scene_01"]);
  expect(next.scenes[0].candidates.map(candidate => candidate.id)).toEqual(["image-0", "video", "image-1"]);
  expect(next.scenes[0].composition).toMatchObject({ visuals: [{ asset_id: "candidate:video" }, { asset_id: "candidate:image-1" }], narrations: [{ asset_id: "narration:voice-0" }, { asset_id: "narration:voice-1" }] });
  expect(next.media).toEqual(before.media); expect(next.source).toEqual(before.source); expect(next.source_text).toBe(before.source_text);
  expect(projectTimeline(next).totalDuration).toBe(projectTimeline(before).totalDuration);
  expect(() => assertEditorWrite(next, before)).not.toThrow();
  expect(prepareEditorWrite(JSON.parse(JSON.stringify(next)))).toEqual(next);
});

it("preserves both scenes' visual clocks, emphasis, auto motion and music volumes", () => {
  const before = mergeProject(); const original = buildVideoPlan(before); const next = mergeScene(before, "scene_01"); const plan = buildVideoPlan(next);
  expect(plan.map(segment => segment.duration)).toEqual(original.map(segment => segment.duration));
  for (let index = 0; index < plan.length; index++) {
    expect(plan[index].motion).toBe(original[index].motion);
    expect(plan[index].musicVolume).toBe(original[index].musicVolume);
    expect(plan[index].emphasisSubtitle).toBe(original[index].emphasisSubtitle);
    for (const time of [0, plan[index].duration / 2, Math.max(0, plan[index].duration - 1 / 15)]) expect(visualPlayback(plan[index], time)).toEqual(visualPlayback(original[index], time));
  }
});

it("preserves the exact voice times and original per-scene frame limits", () => {
  const before = mergeProject(); const next = mergeScene(before, "scene_01");
  const sound = (project: ReturnType<typeof mergeProject>) => narrationTimeline(project).map(clip => [clip.asset_id, clip.start_sec, clip.end_sec, clip.source_start_sec, clip.source_end_sec]);
  const a = sound(before), b = sound(next); expect(b).toHaveLength(a.length);
  for (let index = 0; index < a.length; index++) { expect(b[index][0]).toBe(a[index][0]); for (let field = 1; field < 5; field++) expect(b[index][field]).toBeCloseTo(a[index][field] as number, 6); }
});

it("closes an internal source-time gap while preserving caption-relative positions and later scene timestamps", () => {
  const before = mergeProject(); before.scenes[1].start_sec! += 2; before.scenes[1].end_sec! += 2;
  before.scenes[1].captions!.forEach(block => { block.start_sec += 2; block.end_sec += 2; });
  before.scenes[2].start_sec! += 2; before.scenes[2].end_sec! += 2; before.scenes[2].captions!.forEach(block => { block.start_sec += 2; block.end_sec += 2; });
  const next = mergeScene(before, "scene_01");
  expect(next.scenes[0].captions![1]).toMatchObject({ start_sec: 1.1, end_sec: 3.4 });
  expect(next.scenes[1].start_sec).toBe(5.4); expect(next.scenes[1].captions).toEqual(before.scenes[2].captions);
  const history = new EditorHistory(); history.record(before, next, "장면 합치기", true);
  expect(applied(history.undo(next)).scenes).toEqual(before.scenes);
});

it("undoes and redoes a merge while retaining late originals and earlier edits on the removed scene", () => {
  const before = mergeProject(); const edited = structuredClone(before); edited.scenes[1].captions![0].text = "두 번째에서 편집";
  const history = new EditorHistory(); history.record(before, edited);
  const next = mergeScene(edited, "scene_01"); history.record(edited, next, "장면 합치기", true);
  const current = structuredClone(next); current.scenes[0].candidates.push({ ...current.scenes[0].candidates[0], id: "late", path: "late.png" });
  const saved = prepareEditorWrite(current); const undo = applied(history.undo(saved));
  expect(undo.scenes[0].candidates.map(candidate => candidate.id)).toEqual(["image-0", "video", "late"]);
  expect(undo.scenes[1]).toEqual(edited.scenes[1]); expect(undo.editor?.core_scene_ids).toEqual(before.editor?.core_scene_ids);
  expect(undo.scenes[0].narration_audio).toEqual(before.scenes[0].narration_audio);
  expect(undo.media?.assets.some(asset => asset.id === "candidate:late")).toBe(true);
  const redone = applied(history.redo(undo)); expect(redone.scenes[0].composition).toEqual(next.scenes[0].composition);
  const unsplit = applied(history.undo(redone)); expect(applied(history.undo(unsplit)).scenes[1].captions).toEqual(before.scenes[1].captions);
});

it("retains an original scene's late result in the removed snapshot for undo", () => {
  const before = mergeProject(); const next = mergeScene(before, "scene_01"); const history = new EditorHistory(); history.record(before, next, "장면 합치기", true);
  const late = structuredClone(before.scenes[1]); late.candidates.push({ ...late.candidates[0], id: "finished", path: "finished.png" }); late.status = "ready";
  history.captureDetachedScene(before.id, before.scenes[1], late);
  const undo = applied(history.undo(next)); expect(undo.scenes[1].candidates.at(-1)?.id).toBe("finished");
  const redone = applied(history.redo(undo)); expect(redone.scenes).toHaveLength(2);
});

it("supports split → merge → split and repeated merges with independent section IDs", () => {
  const before = mergeProject(); const merged = mergeScene(before, "scene_01"); const boundary = merged.scenes[0].captions![1].id!;
  const split = splitScene(merged, "scene_01", boundary, "child"); expect(split.editor_version).toBe(5);
  expect(split.scenes[1]).toMatchObject({ subtitle: "강조 2", music_volume: 90 });
  narrationTimeline(split).forEach((clip, index) => { expect(clip.start_sec).toBeCloseTo(narrationTimeline(merged)[index].start_sec, 6); expect(clip.end_sec).toBeCloseTo(narrationTimeline(merged)[index].end_sec, 6); });
  const again = mergeScene(split, "scene_01"); const all = mergeScene(again, "scene_01");
  expect(all.scenes).toHaveLength(1); const composition = all.scenes[0].composition!;
  expect(new Set([...composition.visuals, ...composition.narrations].map(clip => clip.id)).size).toBe(composition.visuals.length + composition.narrations.length);
  expect(buildVideoPlan(all).map(segment => segment.musicVolume)).toEqual(buildVideoPlan(before).map(segment => segment.musicVolume));
  expect(all.scenes[0].merge_origin?.scene_ids).toEqual(expect.arrayContaining(["scene_01", "scene_02", "scene_03", "child"]));
});

it("applies a merged scene's emphasis and music edits to every section and restores original per-section values on undo", () => {
  const before = mergeScene(mergeProject(), "scene_01");
  const changed = structuredClone(before); changed.scenes[0].subtitle = "통일할 문구"; changed.scenes[0].music_volume = 50;
  const next = prepareEditorWrite(changed); const history = new EditorHistory(); history.record(before, next);
  expect(next.scenes[0].composition!.visuals.map(section => [section.presentation!.subtitle, section.presentation!.music_volume])).toEqual([["통일할 문구", 50], ["통일할 문구", 50]]);
  const undo = applied(history.undo(next)); expect(undo.scenes[0].composition!.visuals).toEqual(before.scenes[0].composition!.visuals);
  const redo = applied(history.redo(undo)); expect(redo.scenes[0].composition!.visuals).toEqual(next.scenes[0].composition!.visuals);
});

it("preserves continuous split narration when its halves are joined", () => {
  const before = mergeProject(); before.scenes[0].duration = 4; before.scenes[0].end_sec = 4;
  before.scenes[0].captions = [{ id: "a", text: "세종의", start_sec: 0, end_sec: 1.1 }, { id: "b", text: "이야기 1", start_sec: 1.1, end_sec: 4 }];
  before.scenes[0].narration_audio!.duration_sec = 4; before.media = undefined; before.scenes[0].composition = undefined;
  const prepared = prepareEditorWrite(before); const divided = splitScene(prepared, "scene_01", "b", "child"); const joined = mergeScene(divided, "scene_01");
  expect(narrationTimeline(joined)[0]).toMatchObject({ start_sec: 3, end_sec: 7, source_start_sec: 0, source_end_sec: 4 });
  expect(narrationTimeline(joined)).toHaveLength(narrationTimeline(prepared).length);
});

it("merges after reordering and retains subsequent asynchronous updates on the surviving scene", () => {
  const before = moveScene(mergeProject(), "scene_03", -1); const next = mergeScene(before, "scene_01", "scene_03");
  const late = structuredClone(before); late.scenes[0].candidates.push({ ...late.scenes[0].candidates[0], id: "late", path: "late.png" });
  const current = prepareEditorWrite(mergeProjectChanges(before, late, next));
  expect(current.scenes).toHaveLength(2); expect(current.scenes[0].composition).toEqual(next.scenes[0].composition);
  expect(current.scenes[0].candidates.at(-1)?.id).toBe("late");
});

it("rejects missing/non-adjacent targets, old formats, missing screens, malformed captions and excessive duration", () => {
  const before = mergeProject(); expect(() => mergeScene(before, "scene_03")).toThrow("마지막");
  expect(() => mergeScene(before, "scene_01", "scene_03")).toThrow("인접 장면");
  expect(() => mergeScene(before, "missing")).toThrow("장면을 찾지");
  expect(() => mergeScene(editorProject("2.0"), "scene_01")).toThrow("2.1");
  expect(() => mergeScene(editorProject(), "scene_01")).toThrow("화면을 선택");
  const large = mergeProject(); large.scenes[0].duration = 120; expect(sceneMergeTarget(large, "scene_01").error).toContain("120초");
  const malformed = mergeProject(); malformed.scenes[1].captions![0].id = malformed.scenes[0].captions![0].id;
  expect(() => mergeScene(malformed, "scene_01")).toThrow("자막 ID");
});

it("promotes standalone original voice limits to v5 and blocks an older writer", () => {
  const before = mergeProject(); before.editor_version = 4;
  before.scenes[0].composition!.narrations[0].playback_end_sec = 0.5;
  const next = prepareEditorWrite(before); expect(next.editor_version).toBe(5);
  expect(next.scenes[0].composition!.narrations[0].playback_end_sec).toBe(0.5);
  expect(() => assertEditorWrite(before, next)).toThrow("더 최신");
});
