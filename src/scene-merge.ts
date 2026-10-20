import { assertEditorReadable, editorIdentityErrors, prepareEditorWrite } from "./editor-format";
import { bindComposition, sceneComposition } from "./media-composition";
import { orderedScenes } from "./scene-order";
import { captureSceneComposition } from "./scene-presentation";
import { milliseconds } from "./timeline";
import type { ImageCandidate, ProjectData, Scene } from "./types";

export function sceneMergeTarget(project: ProjectData, sceneId: string) {
  const ordered = orderedScenes(project); const index = ordered.findIndex(scene => scene.id === sceneId);
  const first = ordered[index]; const second = ordered[index + 1];
  const duration = ((first?.duration ?? 10) * 1000 + (second?.duration ?? 10) * 1000) / 1000;
  let error = project.schema_version !== "2.1" ? "APP_DATA 2.1 장면에서 합치기를 사용할 수 있습니다."
    : !first ? "합칠 장면을 찾지 못했습니다." : !second ? "마지막 장면에는 합칠 다음 장면이 없습니다."
      : !Number.isFinite(duration) || duration > 120 || (first.duration ?? 10) < 1 || (second.duration ?? 10) < 1 ? "합친 장면의 길이는 120초 이하여야 합니다." : "";
  if (!error) {
    try { if (!sceneComposition(first).visuals.length || !sceneComposition(second).visuals.length) error = "두 장면의 화면을 선택한 뒤 합쳐 주세요."; }
    catch (cause) { error = (cause as Error).message; }
  }
  return { first, second, duration: Math.round(duration * 1000) / 1000, error };
}

const candidates = (first: ImageCandidate[], second: ImageCandidate[]) => {
  const seen = new Set(first.map(item => item.id)); return [...first, ...second.filter(item => !seen.has(item.id))];
};

export function mergeScene(project: ProjectData, sceneId: string, expectedNextId?: string): ProjectData {
  assertEditorReadable(project);
  const prepared = prepareEditorWrite(project); const target = sceneMergeTarget(prepared, sceneId);
  if (target.error) throw new Error(target.error);
  const { first, second, duration } = target;
  if (expectedNextId && second.id !== expectedNextId) throw new Error("인접 장면이 변경되었습니다. 합칠 대상을 다시 확인해 주세요.");
  const errors = editorIdentityErrors(prepared); if (errors.length) throw new Error(errors[0]);
  for (const scene of [first, second]) {
    const startMs = milliseconds(scene.start_sec ?? 0); let endMs = startMs;
    for (const block of scene.captions || []) {
      const from = milliseconds(block.start_sec); const to = milliseconds(block.end_sec);
      if (!Number.isFinite(startMs) || !Number.isFinite(from) || !Number.isFinite(to) || from < endMs || to - from < 100 || to > startMs + milliseconds(scene.duration ?? 10)) throw new Error("합칠 장면의 자막 시간을 확인해 주세요. 자막은 장면 안에서 겹치지 않게 0.1초 이상 표시해야 합니다.");
      endMs = to;
    }
  }
  const ordered = orderedScenes(prepared); const index = ordered.findIndex(scene => scene.id === sceneId);
  const left = captureSceneComposition(prepared, first, index, true);
  const right = captureSceneComposition(prepared, second, index + 1, true);
  const offsetMs = milliseconds(first.duration ?? 10); const offset = offsetMs / 1000;
  const frameOffset = right.entry.start - left.entry.start;
  const prefix = (scene: Scene, side: ReturnType<typeof captureSceneComposition>, rawOffset: number, clockOffset: number) => ({
    visuals: side.composition.visuals.map(section => ({ ...section, id: `${scene.id}:${section.id}`,
      start_sec: (milliseconds(section.start_sec) + milliseconds(rawOffset)) / 1000, end_sec: (milliseconds(section.end_sec) + milliseconds(rawOffset)) / 1000 })),
    narrations: side.composition.narrations.map(clip => ({ ...clip, id: `${scene.id}:${clip.id}`,
      start_sec: (milliseconds(clip.start_sec) + milliseconds(rawOffset)) / 1000, end_sec: (milliseconds(clip.end_sec) + milliseconds(rawOffset)) / 1000,
      timeline_offset_sec: (clip.timeline_offset_sec ?? 0) + clockOffset - rawOffset,
      playback_end_sec: clockOffset + Math.min(side.entry.duration, clip.playback_end_sec ?? side.entry.duration) })),
  });
  const a = prefix(first, left, 0, 0); const b = prefix(second, right, offset, frameOffset);
  const start = first.start_sec ?? left.entry.sourceStartMs / 1000;
  const shift = milliseconds(start) + offsetMs - right.entry.sourceStartMs;
  const merged: Scene = { ...structuredClone(first), title: `${first.title} · ${second.title}`, duration,
    start_sec: start, end_sec: (milliseconds(start) + milliseconds(duration)) / 1000,
    captions: [...(first.captions || []), ...(second.captions || []).map(block => ({ ...block, start_sec: (milliseconds(block.start_sec) + shift) / 1000, end_sec: (milliseconds(block.end_sec) + shift) / 1000 }))],
    narration: [...(first.captions || []), ...(second.captions || [])].map(block => block.text).join(" "), narration_audio: undefined,
    prompt: [first.prompt, second.prompt].filter(Boolean).join("\n\n"),
    candidates: candidates(first.candidates, second.candidates), support_candidates: candidates(first.support_candidates || [], second.support_candidates || []),
    split_origin: undefined, merge_origin: { scene_ids: [...new Set([first.id, ...(first.merge_origin?.scene_ids || []), second.id, ...(second.merge_origin?.scene_ids || [])])] },
    source_scene_ids: [...new Set([...(first.source_scene_ids || []), ...(second.source_scene_ids || [])])], video_intro_candidate_id: null,
  };
  merged.composition = bindComposition(merged, { source_signature: "", visuals: [...a.visuals, ...b.visuals], narrations: [...a.narrations, ...b.narrations] });
  const core = [...new Set((prepared.editor?.core_scene_ids || []).map(id => id === second.id ? first.id : id))];
  const remaining = ordered.slice(index + 2).map((scene, position) => {
    const original = sceneComposition(scene); const frozen = captureSceneComposition(prepared, scene, index + 2 + position).composition;
    return { ...scene, composition: { ...original, visuals: original.visuals.map((section, offset) => ({ ...section, motion: frozen.visuals[offset].motion })) } };
  });
  const next = { ...prepared, editor_version: 5, media: prepared.media || { assets: [] }, editor: { ...prepared.editor, core_scene_ids: core },
    scenes: [...ordered.slice(0, index), merged, ...remaining].map((scene, position) => ({ ...scene, number: position + 1 })) };
  const invalid = editorIdentityErrors(next); if (invalid.length) throw new Error(invalid[0]);
  return next;
}
