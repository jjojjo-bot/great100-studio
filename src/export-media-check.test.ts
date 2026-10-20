import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { mergeScene } from "./scene-merge";
import { splitScene, splitBoundaries } from "./scene-split";
import { prepareEditorWrite } from "./editor-format";
import { checkResult, currentCheckResult, exportMediaCheckPlan, sameMediaCheckPlan } from "./export-media-check";
import type { ImageCandidate } from "./types";
const image = (id: string): ImageCandidate => ({ id, path: `${id}.png`, preview_url: `data:image/png;base64,${id}`, created_at: "now", mode: "uploaded" });
function fixture() {
  const p = editorProject();
  for (const scene of p.scenes) { scene.candidates = [image("shared"), image("unused")]; scene.selected_candidate_id = "shared"; }
  p.anchor.candidates = [image("anchor")]; p.anchor.selected_candidate_id = "anchor";
  p.thumbnail.candidates = [image("thumb")]; p.thumbnail.selected_candidate_id = "thumb";
  p.scenes[0].narration_audio = { id: "voice", path: "voice.wav", name: "voice.wav", mime_type: "audio/wav", duration_sec: 2 };
  p.background_music = { id: "music", path: "music.wav", name: "music.wav", mime_type: "audio/wav" };
  return prepareEditorWrite(p);
}
it.each([1, "2.0", "2.1"] as const)("indexes only output files, deduplicates shared originals and retains all uses in format %s", version => {
  const p = fixture(); p.schema_version = version; const before = structuredClone(p), plan = exportMediaCheckPlan(p);
  expect(p).toEqual(before); expect(plan.items).toHaveLength(4);
  expect(plan.items.some(item => ["candidate:unused", "candidate:anchor"].includes(item.asset.id))).toBe(false);
  const shared = plan.items.find(item => item.asset.id === "candidate:shared")!;
  expect(shared.locations.map(use => use.sceneId).filter(Boolean)).toContain(p.scenes[2].id); expect(shared.locations.some(use => use.label === "오프닝")).toBe(true);
  expect(plan.items.find(item => item.asset.id === "candidate:thumb")!.locations[0].target).toBe("thumbnail");
  expect(plan.items.find(item => item.asset.path === "voice.wav")!.requiredEnd).toBe(2);
});
it("includes video posters, actual active frame positions, intro and support images", () => {
  const p = fixture(), scene = p.scenes[0]; scene.candidates.push({ ...image("clip"), path: "clip.mp4", media_type: "video", duration_sec: 3 }); scene.selected_candidate_id = "clip"; scene.video_intro_candidate_id = null; scene.video_trim_start_sec = .5; scene.video_trim_end_sec = 2;
  scene.support_candidates = [image("support")]; scene.support_selected_candidate_id = "support";
  const plan = exportMediaCheckPlan(p), clip = plan.items.find(item => item.kind === "video")!;
  expect(plan.items.some(item => item.kind === "poster" && item.asset.id === "candidate:clip")).toBe(true);
  expect(clip.times[0]).toBe(.5); expect(clip.times.at(-1)).toBeLessThan(2); expect(clip.requiredEnd).toBe(clip.times.at(-1));
  expect(plan.items.some(item => item.asset.id === "candidate:support")).toBe(true);
  scene.video_intro_candidate_id = "shared"; const withIntro = exportMediaCheckPlan(p);
  expect(withIntro.items.some(item => item.kind === "poster")).toBe(false); expect(withIntro.fingerprint).not.toBe(plan.fingerprint);
});
it("checks merged and split source windows without losing either voice", () => {
  const p = fixture(); p.scenes[1].candidates = [image("second")]; p.scenes[1].selected_candidate_id = "second";
  p.scenes[1].narration_audio = { ...p.scenes[0].narration_audio!, asset_id: undefined, id: "voice2", path: "voice2.wav" };
  const merged = mergeScene(prepareEditorWrite(p), p.scenes[0].id), plan = exportMediaCheckPlan(merged);
  expect(plan.items.some(item => item.asset.id === "candidate:second")).toBe(true); expect(plan.items.filter(item => item.kind === "audio")).toHaveLength(3);
  const boundary = splitBoundaries(merged, merged.scenes[0]).find(b => !b.error)!;
  const split = splitScene(merged, merged.scenes[0].id, boundary.caption_id), next = exportMediaCheckPlan(split);
  expect(next.items.filter(item => item.kind === "audio")).toHaveLength(3); expect(next.items.find(item => item.asset.path === "voice.wav")!.requiredEnd).toBeGreaterThan(0);
});
it("continues checking other scenes when one visual is missing and treats absent narration as optional", () => {
  const p = fixture(); p.scenes[1].selected_candidate_id = undefined; p.scenes.forEach(scene => { scene.narration_audio = undefined; scene.composition = undefined; });
  const plan = exportMediaCheckPlan(p); expect(plan.issues.some(issue => issue.location.sceneId === p.scenes[1].id)).toBe(true);
  expect(plan.items.some(item => item.asset.id === "candidate:shared")).toBe(true); expect(plan.issues.some(issue => issue.message.includes("녹음"))).toBe(false);
});
it("invalidates source and trim changes but ignores expiring cloud URLs and unrelated text edits", () => {
  const p = fixture(); for (const scene of p.scenes) for (const candidate of scene.candidates) candidate.storage_key = candidate.id;
  const before = exportMediaCheckPlan(p); p.scenes[0].title = "새 제목"; p.scenes[0].candidates[0].preview_url = "https://expired.example/image?new-signature";
  expect(exportMediaCheckPlan(p).fingerprint).toBe(before.fingerprint);
  expect(sameMediaCheckPlan(exportMediaCheckPlan(p), before)).toBe(true);
  for (const scene of p.scenes) scene.candidates[0].storage_key = "new-original";
  expect(exportMediaCheckPlan(p).fingerprint).not.toBe(before.fingerprint);
});

it("detects inline byte changes without serializing large images into the result identity", () => {
  const p = fixture(), large = "data:image/png;base64," + "A".repeat(1_000_000);
  for (const scene of p.scenes) scene.candidates[0].preview_url = large;
  const before = exportMediaCheckPlan(p), original = before.items.find(item => item.asset.id === "candidate:shared")!, result = checkResult(original, "passed", "원본 확인");
  expect(before.fingerprint.length).toBeLessThan(5000); expect(original.fingerprint.length).toBeLessThan(1000); expect(currentCheckResult(original, result)).toBe(true);
  for (const scene of p.scenes) scene.candidates[0].preview_url = large + "B";
  const after = exportMediaCheckPlan(p); expect(sameMediaCheckPlan(before, after)).toBe(false); expect(currentCheckResult(after.items.find(item => item.key === original.key)!, result)).toBe(false);
});
