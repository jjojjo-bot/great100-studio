import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { moveScene } from "./scene-order";
import { EditorHistory, type HistoryResult } from "./editor-history";
import { mergeProjectChanges } from "./project-changes";
import { prepareEditorWrite } from "./editor-format";
import { reportForProject } from "./app-data";
import { projectTimeline } from "./timeline";
import type { ProjectData } from "./types";

const applied = (result: HistoryResult) => { if (result.status !== "applied") throw new Error(result.status); return result.project; };
const ids = (project: ProjectData) => project.scenes.map(scene => scene.id);

it.each([1, "2.0", "2.1"] as const)("moves %s scenes with stable IDs, source and caption positions", version => {
  const original = version === 1 ? createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT) : editorProject(version);
  const snapshot = structuredClone(original);
  const movedId = original.scenes[0].id;
  const next = moveScene(original, movedId, 1);
  expect(ids(next).slice(0, 2)).toEqual([original.scenes[1].id, movedId]);
  expect(next.scenes.map(scene => scene.number)).toEqual(next.scenes.map((_scene, index) => index + 1));
  expect(next.source).toEqual(original.source); expect(next.source_text).toEqual(original.source_text);
  expect(next.editor).toEqual(original.editor);
  expect(original).toEqual(snapshot);
  expect(reportForProject(next).errors).toEqual([]);
  let cursor = 0;
  for (const scene of next.scenes) {
    expect(scene.start_sec).toBe(cursor); expect(scene.end_sec).toBeCloseTo(cursor + (scene.duration ?? 10));
    const before = projectTimeline(original).scenes.find(entry => entry.scene.id === scene.id)!;
    expect(scene.captions?.map(block => [block.id, Math.round((block.start_sec - scene.start_sec!) * 1000), Math.round((block.end_sec - scene.start_sec!) * 1000)]))
      .toEqual(before.scene.captions?.map(block => [block.id, Math.round(block.start_sec * 1000) - before.sourceStartMs, Math.round(block.end_sec * 1000) - before.sourceStartMs]));
    cursor = scene.end_sec!;
  }
});

it("closes old timing gaps on a move and restores the exact original gaps in one undo", () => {
  const project = editorProject();
  project.scenes.forEach((scene, index) => { if (index) { scene.start_sec! += 2; scene.end_sec! += 2; scene.captions!.forEach(block => { block.start_sec += 2; block.end_sec += 2; }); } });
  const next = moveScene(project, project.scenes[1].id, -1);
  const history = new EditorHistory(); history.record(project, next, "장면 순서 변경");
  expect(next.scenes.map(scene => scene.start_sec)).toEqual([0, 10, 20]);
  const undo = applied(history.undo(next)); expect(undo).toEqual(project);
  expect(applied(history.redo(undo))).toEqual(next);
  expect(history.redoLabel).toBeUndefined();
});

it("keeps mixed originals, media intervals and core-scene links unchanged", () => {
  const project = editorProject();
  const scene = project.scenes[0];
  scene.candidates = [{ id: "video", path: "projects/original/03_images/scene01/video.mp4", media_type: "video", duration_sec: 3, preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" }];
  scene.selected_candidate_id = "video";
  scene.narration_audio = { id: "voice", name: "voice.wav", path: "projects/original/01_source/media/voice.wav", mime_type: "audio/wav", duration_sec: 2 };
  const prepared = prepareEditorWrite(project);
  const next = prepareEditorWrite(moveScene(prepared, scene.id, 1));
  expect(next.media).toEqual(prepared.media);
  expect(next.scenes[1].composition).toEqual(prepared.scenes[0].composition);
  expect(next.scenes[1].narration_audio).toEqual(prepared.scenes[0].narration_audio);
  expect(next.scenes[1].candidates).toEqual(prepared.scenes[0].candidates);
  expect(next.editor?.core_scene_ids).toEqual(prepared.editor?.core_scene_ids);
  expect(next.scenes[0].id).toBe(prepared.source!.core_achievement.scene_id);
});

it("merges an explicit move and its undo while preserving later uploads on the same scene", () => {
  const project = editorProject(); const moved = moveScene(project, project.scenes[0].id, 1);
  const current = structuredClone(project);
  const candidate = { id: "late", path: "old-location.png", preview_url: "data:image/png;base64,a", mode: "uploaded" as const, created_at: "now" };
  current.scenes[0].candidates.push(candidate);
  const merged = mergeProjectChanges(project, moved, current);
  expect(ids(merged)).toEqual(ids(moved)); expect(merged.scenes[1].candidates).toEqual([candidate]);
  const history = new EditorHistory(); history.record(project, moved, "장면 순서 변경");
  const undo = applied(history.undo(merged));
  const savedUndo = mergeProjectChanges(merged, undo, merged);
  expect(ids(savedUndo)).toEqual(ids(project)); expect(savedUndo.scenes[0].candidates).toEqual([candidate]);
  expect(ids(applied(history.redo(savedUndo)))).toEqual(ids(moved));
});

it("rebases a late caption edit to the moved scene and keeps its newer text", () => {
  const project = editorProject(); const moved = moveScene(project, project.scenes[0].id, 1);
  moved.scenes[1].captions![0].text = "이동 후 최신 문구";
  const late = structuredClone(project); late.scenes[0].captions![0].end_sec = 8;
  const next = mergeProjectChanges(project, late, moved);
  expect(ids(next)).toEqual(ids(moved));
  expect(next.scenes[1].captions![0]).toMatchObject({ text: "이동 후 최신 문구", start_sec: 10, end_sec: 18 });
  expect(next.scenes[1]).toMatchObject({ number: 2, start_sec: 10, end_sec: 20 });
});

it("preserves earlier caption history and ends it safely if scene membership changes", () => {
  const project = editorProject(); const history = new EditorHistory();
  const edited = structuredClone(project); edited.scenes[0].captions![0].text = "편집한 자막";
  history.record(project, edited); const next = moveScene(edited, edited.scenes[0].id, 1);
  history.record(edited, next, "장면 순서 변경");
  const undo = applied(history.undo(next)); expect(undo).toEqual(edited);
  expect(applied(history.undo(undo))).toEqual(project);
  const other = { ...next, scenes: next.scenes.slice(1) };
  history.reconcile(other); expect(history.redo(other).status).not.toBe("applied");
});

it("uses integer milliseconds for fractional durations without changing caption lengths", () => {
  const project = editorProject(); let cursor = 0;
  for (const [index, scene] of project.scenes.entries()) {
    scene.duration = [1.1, 2.3, 3.7][index]; scene.start_sec = cursor; cursor = Math.round((cursor + scene.duration) * 1000) / 1000; scene.end_sec = cursor;
    scene.captions = [{ ...scene.captions![0], start_sec: scene.start_sec, end_sec: cursor }];
  }
  const next = moveScene(project, project.scenes[0].id, 1);
  expect(next.scenes.map(scene => [scene.start_sec, scene.end_sec])).toEqual([[0, 2.3], [2.3, 3.4], [3.4, 7.1]]);
  expect(reportForProject(next).errors).toEqual([]);
});

it("does nothing at either boundary and rejects missing scenes or invalid timings", () => {
  const project = editorProject();
  expect(moveScene(project, project.scenes[0].id, -1)).toBe(project);
  expect(moveScene(project, project.scenes.at(-1)!.id, 1)).toBe(project);
  expect(() => moveScene(project, "missing", 1)).toThrow("장면을 찾지");
  const invalid = structuredClone(project); invalid.scenes[0].captions![0].end_sec = 11;
  expect(() => moveScene(invalid, invalid.scenes[0].id, 1)).toThrow("자막이 장면 범위");
  expect(() => moveScene({ ...project, editor_version: 5 }, project.scenes[0].id, 1)).toThrow("새로운 편집 형식");
});
