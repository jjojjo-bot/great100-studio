import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { mergeProject } from "../tests/fixtures/merge-project";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { mergeScene } from "./scene-merge";
import { splitScene } from "./scene-split";
import { moveScene } from "./scene-order";
import { prepareEditorWrite } from "./editor-format";
import { suggestedSceneId } from "./scene-image-batch";
import { sceneNarrationBundle, sceneNarrationRows } from "./scene-narration-export";

it.each([1, "2.0", "2.1"] as const)("exports edited scripts, lengths and filenames without changing format %s", version => {
  const p = version === 1 ? createProjectDraft(1, "이순신", "왕", SAMPLE_WORK_TEXT) : editorProject(version);
  p.scenes[0].narration = "현재 내레이션 · 한글 🌊";
  if (version === "2.1") p.scenes[0].captions![0].text = "현재 자막으로 편집한 대본 🌊";
  const before = structuredClone(p), bundle = sceneNarrationBundle(p, [p.scenes[2].id, p.scenes[0].id, p.scenes[0].id]);
  expect(p).toEqual(before); expect(bundle.selected.map(row => row.scene.id)).toEqual([p.scenes[0].id, p.scenes[2].id]);
  expect(bundle.text).toContain(version === "2.1" ? "현재 자막으로 편집한 대본 🌊" : "현재 내레이션 · 한글 🌊");
  expect(bundle.text).toContain(`현재 장면 길이: ${p.scenes[0].duration}초`); expect(bundle.text).toContain("낭독할 대본:"); expect(bundle.selected[0].filename).toMatch(/^scene_01__g100\[.+\]\.wav$/);
  expect(bundle.filename).toBe(`${p.folder_name}_narration_scripts.txt`); expect(bundle.excluded).toEqual([]);
});
it("uses current caption order, preserves line breaks and does not impose a paid generation limit", () => {
  const p = editorProject(); p.scenes[0].narration = "오래된 대본";
  p.scenes[0].captions = [{ text: "훈민정음\n첫 줄 🌅", start_sec: 0, end_sec: 3 }, { text: "새 글자 ".repeat(500), start_sec: 3, end_sec: 10 }];
  const row = sceneNarrationRows(p)[0]; expect(row.script).toBe(p.scenes[0].captions.map(c => c.text).join(" ").trim()); expect(row.valid).toBe(true);
  expect(sceneNarrationBundle(p, [row.scene.id]).text).not.toContain("오래된 대본"); expect(row.characters).toBeGreaterThan(1800);
});
it("does not fall back to old narration when current captions are empty and excludes removed IDs once", () => {
  const p = editorProject(); p.scenes[0].captions![0].text = " "; const bundle = sceneNarrationBundle(p, [p.scenes[0].id, "removed", "removed"]);
  expect(bundle.text).toBe(""); expect(bundle.excluded).toEqual([p.scenes[0].id, "removed"]); expect(bundle.selected).toEqual([]);
  p.scenes[1].captions = undefined; p.scenes[1].narration = undefined; p.scenes[1].caption = "이전 형식 자막 대본";
  expect(sceneNarrationRows(p)[1].script).toBe("이전 형식 자막 대본");
});
it("distinguishes merged and split voice windows from empty scenes, retained originals and unreadable composition", () => {
  const merged = mergeScene(mergeProject(), "scene_01"), rows = sceneNarrationRows(merged);
  expect(rows.map(row => [row.hasNarration, row.narrationCount])).toEqual([[true, 2], [false, 0]]);
  const cut = merged.scenes[0].captions![1].id!, split = splitScene(merged, merged.scenes[0].id, cut, "장면_나눔:child");
  expect(split.scenes[1].narration_audio).toBeUndefined(); expect(sceneNarrationRows(split)[1].hasNarration).toBe(true);
  split.scenes[0].composition!.narrations = null as never; expect(sceneNarrationRows(split)[0].hasNarration).toBeUndefined();
  expect(sceneNarrationRows(split)[2].hasNarration).toBe(false); expect(split.media!.assets.some(asset => asset.kind === "audio")).toBe(true);
});
it("keeps exported IDs stable after reordering and does not select a replacement for a removed scene", () => {
  const p = prepareEditorWrite(editorProject()), selected = [p.scenes[1].id], filename = sceneNarrationBundle(p, selected).selected[0].filename;
  const moved = moveScene(p, selected[0], 1), bundle = sceneNarrationBundle(moved, selected);
  expect(bundle.selected[0].scene.number).toBe(3); expect(bundle.text).toContain("Scene 3 ·"); expect(suggestedSceneId(filename, moved.scenes, p.id)).toBe(selected[0]);
  const removed = { ...moved, scenes: moved.scenes.filter(scene => scene.id !== selected[0]) };
  expect(sceneNarrationBundle(removed, selected).text).toBe(""); expect(suggestedSceneId(filename, removed.scenes, p.id)).toBe(""); expect(suggestedSceneId(filename, moved.scenes, "other-project")).toBe("");
});
it.each(["wav", "mp3", "m4a", "mp4", "webm"])("keeps the recommended identity when saving a real %s recording", extension => {
  const p = editorProject(); p.id = "프로젝트:조선/1"; p.scenes[0].id = "장면_나눔:abc-123";
  const filename = sceneNarrationRows(p)[0].filename.replace(/\.wav$/, ` (1).${extension}`);
  expect(filename).toMatch(/^[\x20-\x7e]+$/); expect(filename).not.toMatch(/[\\/:*?"<>|]/);
  expect(suggestedSceneId(filename, p.scenes, p.id)).toBe(p.scenes[0].id);
});
it("labels invalid lengths for review without losing a usable script or mutating the project", () => {
  for (const duration of [NaN, Infinity, 0, 121]) {
    const p = editorProject(); p.scenes[0].duration = duration; const before = structuredClone(p), bundle = sceneNarrationBundle(p, [p.scenes[0].id]);
    expect(bundle.selected).toHaveLength(1); expect(bundle.text).toContain("현재 장면 길이: 길이 확인 필요"); expect(bundle.text).not.toMatch(/NaN|Infinity/); expect(p).toEqual(before);
  }
});
it("preserves Korean and fractional lengths while making the TXT filename safe", () => {
  const p = editorProject(); p.folder_name = "001_세종/새\n이름"; p.scenes[0].duration = 12.3;
  const bundle = sceneNarrationBundle(p, [p.scenes[0].id]); expect(bundle.filename).toBe("001_세종_새_이름_narration_scripts.txt"); expect(bundle.text).toContain("현재 장면 길이: 12.3초");
});
