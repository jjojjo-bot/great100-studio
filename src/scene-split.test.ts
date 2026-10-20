import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { splitBoundaries, splitScene } from "./scene-split";
import { assertEditorWrite, prepareEditorWrite } from "./editor-format";
import { EditorHistory, type HistoryResult } from "./editor-history";
import { mergeProjectChanges } from "./project-changes";
import { narrationTimeline } from "./narration-timeline";
import { buildVideoPlan, visualPlayback } from "./video";
import { projectTimeline, proposeNarrationTiming } from "./timeline";
import { moveScene } from "./scene-order";
import { sceneComposition } from "./media-composition";
import type { ProjectData } from "./types";

function splittableProject(cut = 3.1) {
  const project = editorProject();
  for (const [index, item] of project.scenes.entries()) {
    item.candidates = [{ id: `other-${index}`, path: `projects/original/other-${index}.png`, preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" }];
    item.selected_candidate_id = `other-${index}`;
  }
  const scene = project.scenes[0];
  scene.captions = [{ id: "caption-a", text: "앞 문구", start_sec: 0, end_sec: cut - 0.1 }, { id: "caption-b", text: "뒤 문구", start_sec: cut, end_sec: 10 }];
  scene.candidates = [
    { id: "image", path: "projects/original/image.png", preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" },
    { id: "video", path: "projects/original/video.mp4", preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 5 },
  ];
  scene.narration = "앞 문구 뒤 문구";
  scene.selected_candidate_id = "video"; scene.video_intro_duration_sec = 1.4; scene.video_trim_start_sec = 0.4; scene.video_trim_end_sec = 3.4;
  scene.support_candidates = [{ ...scene.candidates[0], id: "support", path: "projects/original/support.png" }];
  scene.support_selected_candidate_id = "support"; scene.support_start_sec = 3; scene.motion = "zoom-in";
  scene.narration_audio = { id: "voice", name: "voice.wav", path: "projects/original/voice.wav", mime_type: "audio/wav", duration_sec: 9 };
  return prepareEditorWrite(project);
}
const applied = (result: HistoryResult): ProjectData => { if (result.status !== "applied") throw new Error(result.status); return prepareEditorWrite(result.project); };

it("preserves source, caption identities, timing gaps, original locators and the core mapping", () => {
  const before = splittableProject(); const snapshot = structuredClone(before);
  before.editor!.core_scene_ids = [before.scenes[0].id];
  snapshot.editor!.core_scene_ids = [before.scenes[0].id];
  const next = splitScene(before, before.scenes[0].id, "caption-b", "child");
  expect(next.editor_version).toBe(4); expect(before).toEqual(snapshot);
  expect(next.source).toEqual(before.source); expect(next.source_text).toBe(before.source_text); expect(next.media).toEqual(before.media);
  expect(next.scenes.map(scene => [scene.id, scene.number, scene.start_sec, scene.end_sec])).toEqual([["scene_01", 1, 0, 3.1], ["child", 2, 3.1, 10], ["scene_02", 3, 10, 20], ["scene_03", 4, 20, 30]]);
  expect(next.scenes.flatMap(scene => scene.captions || [])).toEqual(before.scenes.flatMap(scene => scene.captions || []));
  expect(next.editor?.core_scene_ids).toEqual(["scene_01", "child"]);
  expect(projectTimeline(next).scenes.at(-1)?.endFrame).toBe(projectTimeline(before).scenes.at(-1)?.endFrame);
  expect(() => assertEditorWrite(next, before)).not.toThrow();
  expect(prepareEditorWrite(JSON.parse(JSON.stringify(next)))).toEqual(next);
});

it.each([1.1, 1.5, 3.1, 4.5, 7.1])("retains video, intro, frozen frame, motion and support clocks at a %ss cut", cut => {
  const before = splittableProject(cut); const next = splitScene(before, "scene_01", "caption-b", "child");
  const original = buildVideoPlan(before)[1]; const parts = buildVideoPlan(next).slice(1, 3);
  const boundary = parts[0].duration;
  for (const time of [0, Math.max(0, boundary - 1 / 15), boundary, Math.min(9.9, boundary + 0.2), 9.8]) {
    const index = time + 0.00001 >= boundary ? 1 : 0;
    const old = visualPlayback(original, time); const current = visualPlayback(parts[index], time - (index ? boundary : 0));
    for (const field of ["videoTime", "motionProgress", "supportOpacity", "supportProgress", "introOpacity", "emphasisAge"] as const) expect(current[field]).toBeCloseTo(old[field], 5);
    expect(current.videoActive).toBe(old.videoActive);
  }
});

it("coalesces a voice cut between frames and preserves raw source ranges for scene preview", () => {
  const before = splittableProject(3.1); const next = splitScene(before, "scene_01", "caption-b", "child");
  expect(narrationTimeline(next)).toEqual([expect.objectContaining({ start_sec: 3, end_sec: 12, source_start_sec: 0, source_end_sec: 9 })]);
  const child = narrationTimeline(next, "child")[0];
  expect(child.start_sec).toBeCloseTo(-1 / 30); expect(child.source_start_sec).toBe(3.1); expect(child.source_end_sec).toBe(9);
  expect(next.scenes[0].narration_audio).toBeUndefined(); expect(next.scenes[1].narration_audio).toBeUndefined();
  const reordered = moveScene(next, "child", 1);
  expect(narrationTimeline(reordered)).toHaveLength(2);
});

it("preserves the exact sound start of a sparse voice entirely after a fractional cut", () => {
  const before = splittableProject(3.1); const clip = before.scenes[0].composition!.narrations[0];
  clip.start_sec = 4; clip.end_sec = 6; clip.source_start_sec = 1; clip.source_end_sec = 3;
  const next = splitScene(before, "scene_01", "caption-b", "child");
  expect(narrationTimeline(next)[0]).toMatchObject({ start_sec: 7, end_sec: 9, source_start_sec: 1, source_end_sec: 3 });
});

it("supports nested splits and replacing a child's screen or voice without changing its sibling", () => {
  const before = splittableProject(3.1);
  before.scenes[0].captions![1].end_sec = 6;
  before.scenes[0].captions!.push({ id: "caption-c", text: "마지막", start_sec: 6, end_sec: 10 });
  const next = splitScene(splitScene(before, "scene_01", "caption-b", "child"), "child", "caption-c", "grandchild");
  expect(next.scenes[2].split_origin).toMatchObject({ origin_scene_id: "scene_01", start_sec: 6, end_sec: 10 });
  expect(narrationTimeline(next)).toHaveLength(1);
  const edited = structuredClone(next); edited.scenes[1].selected_candidate_id = "image";
  edited.scenes[1].narration_audio = { id: "new", name: "new.wav", path: "projects/original/new.wav", mime_type: "audio/wav", duration_sec: 2 };
  const saved = prepareEditorWrite(edited);
  expect(saved.scenes[0]).toEqual(next.scenes[0]);
  expect(sceneComposition(saved.scenes[1])).toMatchObject({ visuals: [{ asset_id: "candidate:image" }], narrations: [{ asset_id: "narration:new", source_start_sec: 0, source_end_sec: 2 }] });
  expect(() => assertEditorWrite(saved, next)).not.toThrow();
});

it("undoes membership and core links in one step, retains late media, and restores raw voice metadata", () => {
  const before = splittableProject(); const next = splitScene(before, "scene_01", "caption-b", "child"); const history = new EditorHistory();
  history.record(before, next, "장면 나누기", true);
  const uploaded = structuredClone(next); uploaded.scenes[1].candidates.push({ ...uploaded.scenes[1].candidates[0], id: "late", path: "projects/original/late.png" });
  const current = prepareEditorWrite(uploaded);
  const undo = applied(history.undo(current));
  expect(undo.scenes.map(scene => scene.id)).toEqual(before.scenes.map(scene => scene.id));
  expect(undo.scenes[0].narration_audio).toEqual(before.scenes[0].narration_audio);
  expect(narrationTimeline(undo)[0].source_end_sec).toBe(9);
  expect(undo.media?.assets.some(asset => asset.id === "candidate:late")).toBe(true);
  const redo = applied(history.redo(undo));
  expect(redo.scenes[1].candidates.some(candidate => candidate.id === "late")).toBe(true);
  expect(redo.scenes[1].composition).toEqual(next.scenes[1].composition);
});

it("recovers a detached child's late generation on redo and keeps earlier caption/order history", () => {
  const before = splittableProject(); const history = new EditorHistory();
  const edited = structuredClone(before); edited.scenes[0].captions![0].text = "최신"; history.record(before, edited);
  const moved = moveScene(edited, "scene_01", 1); history.record(edited, moved, "장면 순서 변경");
  const next = splitScene(moved, "scene_01", "caption-b", "child"); history.record(moved, next, "장면 나누기", true);
  const undo = applied(history.undo(next));
  const detached = structuredClone(next.scenes[2]); detached.candidates.push({ ...detached.candidates[0], id: "later", path: "projects/original/later.png" });
  history.captureDetachedScene(next.id, next.scenes[2], detached);
  const redone = applied(history.redo(undo));
  expect(redone.scenes[2].candidates.at(-1)?.id).toBe("later");
  const unsplit = applied(history.undo(redone));
  const unmoved = applied(history.undo(unsplit)); expect(unmoved.scenes[0].id).toBe("scene_01");
  expect(applied(history.undo(unmoved)).scenes[0].captions![0].text).toBe("앞 문구");
});

it("merges a pre-split generation without resurrecting captions or resetting clocks", () => {
  const before = splittableProject(); const next = splitScene(before, "scene_01", "caption-b", "child");
  const late = structuredClone(before); late.scenes[0].candidates.push({ ...late.scenes[0].candidates[0], id: "late", path: "late.png" });
  const merged = prepareEditorWrite(mergeProjectChanges(before, late, next));
  expect(merged.scenes[0].captions).toEqual(next.scenes[0].captions); expect(merged.scenes[1]).toEqual(next.scenes[1]);
  expect(merged.scenes[0].composition).toEqual(next.scenes[0].composition);
});

it("retains nested split history while both children are temporarily absent", () => {
  const before = splittableProject(3.1); const history = new EditorHistory();
  before.scenes[0].captions![1].end_sec = 6;
  before.scenes[0].captions!.push({ id: "caption-c", text: "마지막", start_sec: 6, end_sec: 10 });
  const first = splitScene(before, "scene_01", "caption-b", "child"); history.record(before, first, "장면 나누기", true);
  const second = splitScene(first, "child", "caption-c", "grandchild"); history.record(first, second, "장면 나누기", true);
  const unsplit = applied(history.undo(applied(history.undo(second))));
  expect(unsplit.scenes).toHaveLength(3);
  const redone = applied(history.redo(applied(history.redo(unsplit))));
  expect(redone.scenes).toEqual(second.scenes);
});

it("undoes a new long voice's timing edit on a child without losing the voice or its original visual windows", () => {
  const before = splitScene(splittableProject(), "scene_01", "caption-b", "child");
  const proposal = proposeNarrationTiming(before, "child", 8, "scale").project;
  proposal.scenes[1].narration_audio = { id: "new-long", path: "projects/original/long.wav", name: "long.wav", duration_sec: 8, mime_type: "audio/wav" };
  const next = prepareEditorWrite(proposal); const history = new EditorHistory(); history.record(before, next, "녹음 길이에 맞추기");
  const undo = applied(history.undo(next));
  expect(undo.scenes[1].composition!.visuals).toEqual(before.scenes[1].composition!.visuals);
  expect(undo.scenes[1].narration_audio?.id).toBe("new-long");
  const redo = applied(history.redo(undo));
  expect(redo.scenes[1].duration).toBe(8); expect(redo.scenes[1].composition!.narrations[0].end_sec).toBe(8);
  expect(redo.scenes[1].composition!.visuals).toEqual(next.scenes[1].composition!.visuals);
});

it("rejects old schemas, overlaps, short halves, missing captions and duplicate identities", () => {
  const before = splittableProject(0.9);
  expect(splitBoundaries(before, before.scenes[0])[0].error).toContain("1초");
  expect(() => splitScene(before, "scene_01", "caption-b")).toThrow("1초");
  before.scenes[0].captions![0].end_sec = 2;
  expect(() => splitScene(before, "scene_01", "caption-b")).toThrow("겹치지");
  expect(() => splitScene(editorProject("2.0"), "scene_01", "caption-b")).toThrow("다시 선택");
  expect(() => splitScene(splittableProject(), "scene_01", "missing")).toThrow("다시 선택");
  expect(() => splitScene(splittableProject(), "scene_01", "caption-b", "scene_02")).toThrow("중복");
  const invalid = splittableProject(); invalid.scenes[0].start_sec = NaN;
  expect(() => splitScene(invalid, "scene_01", "caption-b")).toThrow("장면 안에서");
});
