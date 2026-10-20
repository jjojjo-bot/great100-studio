import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import { candidateAssetId, sceneComposition, visualSelectionFingerprint } from "./media-composition";
import { filterLibraryImages, libraryImages, originalImageIdentity, restoreImageCandidate, type RestoreImageRequest } from "./image-library";
import { EditorHistory } from "./editor-history";
import { mergeScene } from "./scene-merge";
import { moveScene } from "./scene-order";
import type { ImageCandidate, ProjectData } from "./types";

const image = (id: string): ImageCandidate => ({ id, path: `${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" });
function fixture() {
  const p = editorProject(); p.anchor.candidates = [image("anchor")]; p.anchor.selected_candidate_id = "anchor";
  p.thumbnail.candidates = [image("thumb")]; p.thumbnail.selected_candidate_id = "thumb";
  p.scenes.forEach((scene, i) => { scene.title = `장면 ${i + 1}`; scene.candidates = [image(`main-${i}`), image(`option-${i}`)]; scene.selected_candidate_id = `main-${i}`; });
  p.scenes[0].support_candidates = [image("support")]; p.scenes[0].support_selected_candidate_id = "support";
  p.media = { assets: [{ id: "candidate:detached", kind: "image", path: "detached.png", mime_type: "image/png", inline_data: "data:image/png;base64,iVBORw0KGgo=" }] };
  return prepareEditorWrite(p);
}
const request = (p: ProjectData, scene = 0): RestoreImageRequest => ({ projectId: p.id, sceneId: p.scenes[scene].id, assetId: "candidate:detached", expectedOriginal: originalImageIdentity(p.media!.assets.find(a => a.id === "candidate:detached")!) });

it("indexes selected anchor, thumbnail, main and support uses separately from candidate locations, including detached images", () => {
  const p = fixture(), before = structuredClone(p), catalog = libraryImages(p);
  expect(catalog.images).toHaveLength(10); expect(catalog.warnings).toEqual([]); expect(p).toEqual(before);
  expect(catalog.images.find(i => i.asset.id === "candidate:anchor")!.uses).toEqual(["인물 기준 이미지"]);
  expect(catalog.images.find(i => i.asset.id === "candidate:thumb")!.uses).toEqual(["썸네일"]);
  expect(catalog.images.find(i => i.asset.id === "candidate:main-0")!.uses[0]).toContain("Scene 1 · 장면 1 · 주 화면");
  expect(catalog.images.find(i => i.asset.id === "candidate:support")!.uses[0]).toContain("보조 화면");
  expect(catalog.images.find(i => i.asset.id === "candidate:option-0")!.uses).toEqual([]);
  expect(catalog.images.find(i => i.asset.id === "candidate:option-0")!.locations).toHaveLength(1);
  expect(filterLibraryImages(catalog.images, "detached", "", true).map(i => i.asset.id)).toEqual(["candidate:detached"]);
  expect(filterLibraryImages(catalog.images, "unused", "", true)).toHaveLength(4);
  expect(filterLibraryImages(catalog.images, "all", "MAIN-0", true)).toHaveLength(1);
  expect(filterLibraryImages(catalog.images, "all", "장면 3", true)).toHaveLength(2);
});
it("uses actual merged composition references even when the legacy selected ID covers only the first section", () => {
  const p = mergeScene(fixture(), "scene_01"), catalog = libraryImages(p);
  expect(catalog.images.find(i => i.asset.id === "candidate:main-1")!.uses[0]).toContain("Scene 1");
  expect(catalog.images.find(i => i.asset.id === "candidate:main-1")!.uses[0]).toContain("주 화면");
});
it("includes a video intro as an image use and excludes video and audio originals", () => {
  const p = fixture(), scene = p.scenes[0]; scene.candidates.push({ ...image("video"), path: "video.mp4", media_type: "video", duration_sec: 10 }); scene.selected_candidate_id = "video"; scene.video_intro_candidate_id = "main-0";
  scene.narration_audio = { id: "voice", name: "voice.wav", mime_type: "audio/wav", path: "voice.wav", duration_sec: 2 };
  const catalog = libraryImages(prepareEditorWrite(p)); expect(catalog.images).toHaveLength(10);
  expect(catalog.images.find(i => i.asset.id === "candidate:main-0")!.uses[0]).toContain("앞 이미지");
  expect(catalog.images.every(i => i.asset.kind === "image")).toBe(true);
});
it("does not label unknown screen connections as unused when a composition cannot be read", () => {
  const p = fixture(); p.scenes[0].composition!.visuals = null as never;
  const catalog = libraryImages(p); expect(catalog.warnings).toHaveLength(1);
  expect(filterLibraryImages(catalog.images, "unused", "", false)).toEqual([]);
});
it.each([1, "2.0", "2.1"] as const)("restores the original identity without selecting a screen in format %s", version => {
  const p = fixture(); p.schema_version = version; const before = structuredClone(p), planned = request(p);
  const restored = restoreImageCandidate(p, planned, image("detached"));
  expect(p).toEqual(before); expect(restored.scenes[0].candidates.at(-1)!.id).toBe("detached");
  expect(restored.scenes[0].selected_candidate_id).toBe(before.scenes[0].selected_candidate_id);
  expect(visualSelectionFingerprint(restored.scenes[0])).toBe(visualSelectionFingerprint(before.scenes[0])); expect(restored.scenes[0].composition!.narrations).toEqual(before.scenes[0].composition!.narrations); expect(restored.source).toEqual(before.source); expect(restored.source_text).toBe(before.source_text);
  expect(restored.media!.assets.map(a => a.id)).toEqual(before.media!.assets.map(a => a.id));
  expect(restoreImageCandidate(restored, planned, image("detached"))).toBe(restored);
});
it("keeps empty scenes empty and freezes a selected video's automatic intro including no intro", () => {
  for (const intro of [false, true]) {
    const p = fixture(), scene = p.scenes[1]; scene.candidates = [{ ...image("clip"), path: "clip.mp4", media_type: "video", duration_sec: 10 }, ...(intro ? [image("intro")] : [])]; scene.selected_candidate_id = "clip";
    const before = prepareEditorWrite(p), fp = visualSelectionFingerprint(before.scenes[1]), restored = restoreImageCandidate(before, request(before, 1), image("detached"));
    expect(visualSelectionFingerprint(restored.scenes[1])).toBe(fp); expect(restored.scenes[1].video_intro_candidate_id).toBe(intro ? "intro" : null);
  }
  const p = fixture(); p.scenes[1].selected_candidate_id = undefined; const restored = restoreImageCandidate(p, request(p, 1), image("detached"));
  expect(restored.scenes[1].selected_candidate_id).toBeUndefined(); expect(sceneComposition(restored.scenes[1]).visuals).toHaveLength(0);
});
it("uses the current stable scene ID after a move and keeps merged visual and voice windows intact", () => {
  const p = fixture(), planned = request(p), moved = moveScene(p, planned.sceneId, 1), restored = restoreImageCandidate(moved, planned, image("detached"));
  expect(restored.scenes[1].candidates.at(-1)!.id).toBe("detached"); expect(restored.scenes[0].candidates.some(c => c.id === "detached")).toBe(false);
  const merged = mergeScene(p, "scene_01"), next = restoreImageCandidate(merged, request(merged), image("detached"));
  expect(next.scenes[0].composition).toEqual(merged.scenes[0].composition); expect(next.editor).toEqual(merged.editor);
});
it("retains a restored candidate when undoing and redoing an earlier edit", () => {
  const p = fixture(), edited = prepareEditorWrite({ ...p, scenes: p.scenes.map((scene, i) => i ? scene : { ...scene, selected_candidate_id: "option-0" }) });
  const history = new EditorHistory(); history.record(p, edited); const next = restoreImageCandidate(edited, request(edited), image("detached")); history.reconcile(next);
  const undo = history.undo(next); expect(undo.status).toBe("applied"); if (undo.status !== "applied") throw new Error("undo");
  expect(undo.project.scenes[0].candidates.some(c => c.id === "detached")).toBe(true); expect(history.redo(undo.project).status).toBe("applied");
});
it("rejects removed scenes, changed originals, cross-project requests and mismatched candidate links", () => {
  const p = fixture(), planned = request(p);
  expect(() => restoreImageCandidate({ ...p, id: "other" }, planned, image("detached"))).toThrow("프로젝트");
  expect(() => restoreImageCandidate({ ...p, scenes: p.scenes.slice(1) }, planned, image("detached"))).toThrow("장면이 없어");
  expect(() => restoreImageCandidate(p, { ...planned, expectedOriginal: "old" }, image("detached"))).toThrow("원본 이미지 정보");
  expect(() => restoreImageCandidate(p, planned, image("wrong"))).toThrow("원본 연결");
  expect(candidateAssetId(restoreImageCandidate(p, planned, image("detached")).scenes[0].candidates.at(-1)!)).toBe(planned.assetId);
});
