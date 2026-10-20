import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { mergeProject } from "../tests/fixtures/merge-project";
import { mergeScene } from "./scene-merge";
import { splitScene } from "./scene-split";
import { moveScene } from "./scene-order";
import { matchesReviewFilter, reviewScenes } from "./scene-review";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";

it.each([1, "2.0", "2.1"] as const)("reads %s projects without mutating data or treating optional narration as a time error", version => {
  const project = version === 1 ? createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT) : editorProject(version);
  const before = structuredClone(project), items = reviewScenes(project);
  expect(project).toEqual(before); expect(items).toHaveLength(project.scenes.length);
  expect(items.every(item => !item.hasNarration && !item.hasVisual && !item.timingIssues.length)).toBe(true);
  expect(items.every(item => item.hasCaption)).toBe(true);
});
it("uses retained visual and voice windows after merging and splitting, independently of candidate palettes", () => {
  const original = mergeProject(), merged = mergeScene(original, original.scenes[0].id);
  merged.scenes[0].candidates = []; merged.scenes[0].support_candidates = [];
  const before = structuredClone(merged), item = reviewScenes(merged)[0];
  expect(item).toMatchObject({ hasVisual: true, hasNarration: true, visualCount: 2, narrationCount: 2, captionCount: 2, core: true, timingIssues: [] });
  expect(item.previewUrl).toBe(original.scenes[0].candidates[0].preview_url); expect(item.supportPreviewUrls).toHaveLength(1);
  expect(merged).toEqual(before);
  const split = splitScene(merged, merged.scenes[0].id, merged.scenes[0].captions![1].id!);
  expect(reviewScenes(split).slice(0, 2).every(item => item.hasVisual && item.hasNarration && !item.timingIssues.length)).toBe(true);
});
it("reports overlapping and out-of-scene captions on only the affected scenes", () => {
  const project = editorProject();
  project.scenes[1].captions = [{ id: "a", text: "앞", start_sec: 10, end_sec: 15 }, { id: "b", text: "뒤", start_sec: 14, end_sec: 21 }];
  const items = reviewScenes(project);
  expect(items.filter(item => matchesReviewFilter(item, "timing")).map(item => item.scene.id)).toEqual([project.scenes[1].id]);
  expect(items[1].timingIssues.join(" ")).toContain("겹칩니다"); expect(items[1].timingIssues.join(" ")).toContain("범위를 벗어났습니다");
});
it("distinguishes missing originals from valid voices and detects invalid source playback limits", () => {
  const project = mergeScene(mergeProject(), "scene_01");
  project.media!.assets = project.media!.assets.filter(asset => asset.kind !== "audio");
  expect(reviewScenes(project)[0]).toMatchObject({ hasVisual: true, hasNarration: false });
  expect(reviewScenes(project)[0].mediaIssues.join(" ")).toContain("녹음 원본 연결");
  project.scenes[0].composition!.narrations[0].playback_end_sec = 100;
  expect(reviewScenes(project)[0].timingIssues.join(" ")).toContain("녹음 구간");
});
it("handles invalid lengths without crashing and keeps the display order and core link after a move", () => {
  const project = mergeProject(), moved = moveScene(project, project.scenes[0].id, 1);
  expect(reviewScenes(moved).map(item => item.scene.id)).toEqual(moved.scenes.map(scene => scene.id));
  expect(reviewScenes(moved).find(item => item.core)?.scene.id).toBe(project.scenes[1].id);
  moved.scenes[0].duration = NaN;
  expect(reviewScenes(moved)[0].timingIssues).toContain("장면 길이는 1~120초여야 합니다.");
});
