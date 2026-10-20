import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { applyGeneratedNarration, generatedApplyFingerprint, narrationScript } from "./narration-generation";
import { prepareEditorWrite } from "./editor-format";
import { EditorHistory } from "./editor-history";
import { sceneComposition } from "./media-composition";
import { mergeScene } from "./scene-merge";
import { splitScene } from "./scene-split";
import type { NarrationGeneration, SceneNarrationAudio } from "./types";

export const generation: NarrationGeneration = { provider: "openai", model: "gpt-audio-1.5", request_id: "request", input_text: "세종의 이야기 1", transcript: "세종의 이야기 1", voice: "alloy", pace: "normal", created_at: "2026-10-20T00:00:00Z", usage: { input_tokens: 60, output_tokens: 100, total_tokens: 160 } };
const audio: SceneNarrationAudio = { id: "generated", name: "ai.mp3", path: "generated.mp3", mime_type: "audio/mpeg", duration_sec: 14, generation };
function setup() {
  let project = editorProject();
  for (const scene of project.scenes) { scene.candidates = [{ id: scene.id, path: `${scene.id}.png`, mode: "uploaded", created_at: "now", preview_url: "data:image/png;base64,a" }]; scene.selected_candidate_id = scene.id; }
  project = prepareEditorWrite(project);
  return { project, request: { projectId: project.id, sceneId: project.scenes[0].id, expected: generatedApplyFingerprint(project, project.scenes[0]), narration: audio, adjustDuration: true, mode: "scale" as const } };
}
it("uses the currently edited captions as the narration script, with legacy narration fallback", () => {
  const { project } = setup(); const scene = project.scenes[0];
  scene.captions![0].text = "새로운 문구"; expect(narrationScript(scene)).toBe("새로운 문구");
  expect(narrationScript({ ...scene, captions: undefined })).toBe(scene.narration);
});
it("revalidates script, timing, scene membership and audio selection at the root callback", () => {
  const { project, request } = setup();
  for (const change of [
    () => { project.scenes[0].captions![0].text = "새 대본"; },
    () => { project.scenes[0].duration = 11; },
    () => { project.scenes[0].narration_audio = { ...audio, id: "other" }; },
    () => { project.scenes.shift(); },
  ]) { const copy = structuredClone(project); change(); expect(() => applyGeneratedNarration(project, request)).toThrow(/변경/); Object.assign(project, copy); }
});
it("does not shorten the scene unless requested and blocks audio longer than it", () => {
  const { project, request } = setup();
  expect(() => applyGeneratedNarration(project, { ...request, adjustDuration: false })).toThrow(/장면보다/);
  const changed = applyGeneratedNarration(project, { ...request, narration: { ...audio, duration_sec: 4 }, adjustDuration: false });
  expect(changed.scenes[0].duration).toBe(10); expect(changed.scenes[0].narration_audio?.generation).toEqual(generation);
});
it("undoes the selected voice and time changes together without deleting originals or late image results", () => {
  const { project, request } = setup();
  project.scenes[0].narration_audio = { ...audio, id: "old", path: "old.mp3", duration_sec: 2, generation: undefined };
  const before = prepareEditorWrite(project); request.expected = generatedApplyFingerprint(before, before.scenes[0]);
  const after = prepareEditorWrite(applyGeneratedNarration(before, request));
  const history = new EditorHistory(); history.record(before, after, "AI 내레이션 적용", false, true);
  after.scenes[0].candidates.push({ id: "late", path: "late.png", preview_url: "data:image/png;base64,b", mode: "uploaded", created_at: "now" });
  const undo = history.undo(after); expect(undo.status).toBe("applied");
  if (undo.status !== "applied") return;
  const restored = prepareEditorWrite(undo.project);
  expect(restored.editor_version).toBe(3); expect(restored.scenes[0].duration).toBe(10); expect(restored.scenes[1].start_sec).toBe(10);
  expect(restored.scenes[0].narration_audio?.id).toBe("old"); expect(sceneComposition(restored.scenes[0]).narrations[0].asset_id).toContain("old");
  expect(restored.scenes[0].candidates.at(-1)?.id).toBe("late"); expect(restored.media?.assets.some(asset => asset.generation?.request_id === generation.request_id)).toBe(true);
  const redo = history.redo(restored); expect(redo.status).toBe("applied");
  if (redo.status === "applied") { expect(redo.project.scenes[0].narration_audio).toEqual(after.scenes[0].narration_audio); expect(redo.project.scenes[1].start_sec).toBe(14); }
});
it("retains generation provenance through merging and splitting audio windows", () => {
  const { project, request } = setup();
  const changed = prepareEditorWrite(applyGeneratedNarration(project, request));
  const merged = mergeScene(changed, changed.scenes[0].id);
  const divided = splitScene(merged, merged.scenes[0].id, merged.scenes[0].captions![1].id!);
  expect(divided.media?.assets.find(asset => asset.id === "narration:generated")?.generation).toEqual(generation);
  expect(divided.source).toEqual(project.source);
});
it("restores both original audio windows after replacing a merged scene's narration", () => {
  const { project } = setup();
  project.scenes[0].narration_audio = { ...audio, id: "old-a", path: "old-a.mp3", duration_sec: 2, generation: undefined };
  project.scenes[1].narration_audio = { ...audio, id: "old-b", path: "old-b.mp3", duration_sec: 3, generation: undefined };
  const merged = mergeScene(prepareEditorWrite(project), project.scenes[0].id);
  const scene = merged.scenes[0], beforeClips = structuredClone(sceneComposition(scene).narrations), visuals = structuredClone(sceneComposition(scene).visuals);
  const request = { projectId: merged.id, sceneId: scene.id, expected: generatedApplyFingerprint(merged, scene), narration: { ...audio, duration_sec: 4, generation: { ...generation, input_text: narrationScript(scene) } }, adjustDuration: false, mode: "scale" as const };
  const after = prepareEditorWrite(applyGeneratedNarration(merged, request));
  const history = new EditorHistory(); history.record(merged, after, "AI 내레이션 적용", false, true);
  expect(sceneComposition(after.scenes[0]).narrations).toHaveLength(1);
  const undo = history.undo(after); expect(undo.status).toBe("applied");
  if (undo.status === "applied") { const restored = prepareEditorWrite(undo.project); expect(sceneComposition(restored.scenes[0]).narrations).toEqual(beforeClips); expect(sceneComposition(restored.scenes[0]).visuals).toEqual(visuals); expect(history.redo(restored).status).toBe("applied"); }
});
