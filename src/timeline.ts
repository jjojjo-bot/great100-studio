import type { CaptionBlock, ProjectData, Scene, SceneNarrationAudio } from "./types";

export const VIDEO_FPS = 15;
export const OPENING_DURATION = 3;
export const ENDING_DURATION = 4;
export type CaptionTimingMode = "keep" | "scale";
export interface TimingRequest {
  projectId: string; sceneId: string; narrationDuration: number; mode: CaptionTimingMode;
  expected: string; narration?: SceneNarrationAudio;
}
export const milliseconds = (seconds: number) => Math.round(seconds * 1000);
export const frameSeconds = (frame: number) => frame / VIDEO_FPS;
export const snapToFrame = (seconds: number) => frameSeconds(Math.round(milliseconds(seconds) * VIDEO_FPS / 1000));
export const segmentProgress = (seconds: number, duration: number) => duration <= 1 / VIDEO_FPS ? 0 : Math.max(0, Math.min(1, seconds / (duration - 1 / VIDEO_FPS)));

export function frameTimeline(durations: number[], alreadyQuantized = false) {
  let elapsedUnits = 0;
  let startFrame = 0;
  return durations.map(duration => {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("영상 길이가 올바르지 않습니다.");
    const frames = duration * VIDEO_FPS;
    elapsedUnits += alreadyQuantized && Math.abs(frames - Math.round(frames)) < 0.000001 ? Math.round(frames) * 1000 : milliseconds(duration) * VIDEO_FPS;
    const endFrame = Math.max(startFrame + 1, Math.round(elapsedUnits / 1000));
    const result = { startFrame, endFrame, frames: endFrame - startFrame, start: frameSeconds(startFrame), end: frameSeconds(endFrame), duration: frameSeconds(endFrame - startFrame) };
    startFrame = endFrame;
    return result;
  });
}

export function projectTimeline(project: ProjectData) {
  const ordered = [...project.scenes].sort((a, b) => a.number - b.number);
  const frames = frameTimeline(ordered.map(scene => scene.duration ?? 10));
  let cursorMs = 0;
  const scenes = ordered.map((scene, index) => {
    const durationMs = milliseconds(scene.duration ?? 10);
    const sourceStartMs = project.schema_version === 1 ? cursorMs : milliseconds(scene.start_sec ?? cursorMs / 1000);
    const result = { scene, durationMs, sourceStartMs, sourceEndMs: sourceStartMs + durationMs, startMs: cursorMs, endMs: cursorMs + durationMs, ...frames[index] };
    cursorMs += durationMs;
    return result;
  });
  const ending = !!project.ending_message.trim() || !!project.thumbnail.selected_candidate_id;
  const bodyDuration = frameSeconds(frames.at(-1)?.endFrame ?? 0);
  return { scenes, bodyDuration, totalDuration: OPENING_DURATION + bodyDuration + (ending ? ENDING_DURATION : 0) };
}

export function playbackPosition(durations: number[], time: number) {
  const ranges = frameTimeline(durations, true);
  if (!ranges.length) return null;
  const bounded = Math.max(0, Math.min(time, ranges.at(-1)!.end));
  const index = ranges.findIndex((range, i) => bounded < range.end || i === ranges.length - 1);
  const range = ranges[index];
  return { index, seconds: Math.max(0, Math.min(range.duration, bounded - range.start)), ...range };
}

export function timingFingerprint(project: ProjectData): string {
  return JSON.stringify([project.id, project.ending_message, project.thumbnail.selected_candidate_id,
    project.scenes.map(scene => [scene.id, scene.number, scene.duration, scene.start_sec, scene.end_sec,
      scene.captions?.map(block => [block.id, block.start_sec, block.end_sec]), scene.narration_audio])]);
}

function validateCaptions(blocks: CaptionBlock[] | undefined, startMs: number, durationMs: number) {
  let previousEnd = startMs;
  for (const block of blocks || []) {
    const start = milliseconds(block.start_sec); const end = milliseconds(block.end_sec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || start < startMs || end > startMs + durationMs || end - start < 100) {
      throw new Error("자막은 장면 안에서 겹치지 않게 0.1초 이상 표시해야 합니다. 자막 시간이나 재배치 방식을 확인해 주세요.");
    }
    previousEnd = end;
  }
}

export function proposeNarrationTiming(project: ProjectData, sceneId: string, narrationDuration: number, mode: CaptionTimingMode) {
  if (!Number.isFinite(narrationDuration) || narrationDuration <= 0 || narrationDuration > 120) throw new Error("녹음 길이는 0초 초과, 120초 이하여야 합니다.");
  const before = projectTimeline(project);
  const index = before.scenes.findIndex(entry => entry.scene.id === sceneId);
  if (index < 0) throw new Error("시간을 조정할 장면을 찾지 못했습니다.");
  const selected = before.scenes[index];
  if (selected.durationMs < 1000 || selected.durationMs > 120_000) throw new Error("장면 길이는 1~120초여야 합니다.");
  let durationMs = Math.max(1000, Math.ceil((narrationDuration * 1000 - 0.000001) / 100) * 100);
  // Leave enough whole frames for the final audio sample as well as rounding the
  // visible scene duration up to tenths of a second.
  const prefixMs = selected.startMs;
  const startFrame = Math.round(prefixMs * VIDEO_FPS / 1000);
  if (frameSeconds(Math.round((prefixMs + durationMs) * VIDEO_FPS / 1000) - startFrame) + 0.000001 < narrationDuration) durationMs += 100;
  if (durationMs > 120_000) throw new Error("녹음을 담을 장면 길이는 120초 이하여야 합니다.");
  const deltaMs = durationMs - selected.durationMs;
  const changes = new Map<string, Scene>();
  for (const [position, entry] of before.scenes.entries()) {
    validateCaptions(entry.scene.captions, entry.sourceStartMs, entry.durationMs);
    if (position < index) continue;
    const shiftMs = position > index ? deltaMs : 0;
    const startMs = entry.sourceStartMs + shiftMs;
    const nextDuration = position === index ? durationMs : entry.durationMs;
    const captions = entry.scene.captions?.map(block => {
      const relativeStart = milliseconds(block.start_sec) - entry.sourceStartMs;
      const relativeEnd = milliseconds(block.end_sec) - entry.sourceStartMs;
      const scale = position === index && mode === "scale" ? durationMs / selected.durationMs : 1;
      return { ...block, start_sec: (startMs + Math.round(relativeStart * scale)) / 1000, end_sec: (startMs + Math.round(relativeEnd * scale)) / 1000 };
    });
    validateCaptions(captions, startMs, nextDuration);
    changes.set(entry.scene.id, { ...entry.scene, duration: nextDuration / 1000, start_sec: startMs / 1000, end_sec: (startMs + nextDuration) / 1000, captions });
  }
  const next = { ...project, editor_version: Math.max(2, project.editor_version ?? 0), scenes: project.scenes.map(scene => changes.get(scene.id) || scene) };
  const after = projectTimeline(next);
  if (after.totalDuration > 900) throw new Error("전체 영상 길이는 오프닝·엔딩을 포함해 15분 이하여야 합니다.");
  return { project: next, before, after, duration: durationMs / 1000, delta: deltaMs / 1000 };
}

export function sourceCaptionTiming(project: ProjectData, scene: Scene): CaptionBlock[] | undefined {
  const original = project.source?.scenes.find(item => item.id === (scene.source_scene_id || scene.id));
  if (!original?.captions || original.captions.length !== scene.captions?.length) return undefined;
  const start = scene.start_sec ?? 0;
  const shifted = original.captions.map(block => ({ ...block, start_sec: (milliseconds(block.start_sec) - milliseconds(original.start_sec) + milliseconds(start)) / 1000,
    end_sec: (milliseconds(block.end_sec) - milliseconds(original.start_sec) + milliseconds(start)) / 1000 }));
  try { validateCaptions(shifted, milliseconds(start), milliseconds(scene.duration ?? 10)); return shifted; }
  catch { return undefined; }
}
