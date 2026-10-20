import { assertEditorReadable, prepareEditorWrite } from "./editor-format";
import { bindComposition, cropComposition, sceneComposition } from "./media-composition";
import { orderedScenes } from "./scene-order";
import { milliseconds, OPENING_DURATION, projectTimeline, VIDEO_FPS } from "./timeline";
import { resolveImageMotion } from "./video";
import type { ProjectData, Scene } from "./types";

export interface SplitBoundary { caption_id: string; seconds: number; before: string; after: string; error?: string }

export function splitBoundaries(project: ProjectData, scene: Scene): SplitBoundary[] {
  if (project.schema_version !== "2.1") return [];
  const start = scene.start_sec ?? 0; const duration = scene.duration ?? 10;
  let previousEnd = milliseconds(start); const ids = new Set<string>();
  const invalid = !Number.isFinite(start) || !Number.isFinite(duration) || duration < 1 || duration > 120 || (scene.captions || []).some(block => {
    const from = milliseconds(block.start_sec); const to = milliseconds(block.end_sec);
    const bad = !block.id || ids.has(block.id) || !Number.isFinite(from) || !Number.isFinite(to) || from < previousEnd || to - from < 100 || to > milliseconds(start + duration);
    if (block.id) ids.add(block.id); previousEnd = to;
    return bad;
  });
  return (scene.captions || []).slice(1).map((block, index) => {
    const seconds = (milliseconds(block.start_sec) - milliseconds(start)) / 1000;
    const previous = scene.captions![index];
    const error = invalid || !block.id || previous.end_sec > block.start_sec ? "장면 안에서 자막이 겹치지 않는 경계가 필요합니다."
      : seconds < 1 || duration - seconds < 1 ? "나눈 두 장면은 각각 1초 이상이어야 합니다." : undefined;
    return { caption_id: block.id || "", seconds, before: previous.text, after: block.text, error };
  });
}

export function splitScene(project: ProjectData, sceneId: string, captionId: string, newSceneId: string = crypto.randomUUID()): ProjectData {
  assertEditorReadable(project);
  const prepared = prepareEditorWrite(project);
  const ordered = orderedScenes(prepared);
  const index = ordered.findIndex(scene => scene.id === sceneId);
  if (index < 0) throw new Error("나눌 장면을 찾지 못했습니다.");
  if (!newSceneId || ordered.some(scene => scene.id === newSceneId)) throw new Error("새 장면 ID가 중복되었습니다.");
  const scene = ordered[index];
  const boundary = splitBoundaries(prepared, scene).find(item => item.caption_id === captionId);
  if (!boundary) throw new Error("나누려는 자막 경계를 다시 선택해 주세요.");
  if (boundary.error) throw new Error(boundary.error);
  const captionIndex = scene.captions!.findIndex(block => block.id === captionId);
  const duration = scene.duration ?? 10; const cut = boundary.seconds;
  const entry = projectTimeline(prepared).scenes.find(item => item.scene.id === sceneId)!;
  const clock = (seconds: number) => (Math.round((entry.startMs + milliseconds(seconds)) * VIDEO_FPS / 1000) - entry.startFrame) / VIDEO_FPS;
  const original = structuredClone(sceneComposition(scene));
  original.visuals = original.visuals.map((section, sectionIndex) => {
    const frameDuration = clock(section.end_sec) - clock(section.start_sec);
    const first = index === 0 && sectionIndex === 0 && original.mode !== "segments";
    return { ...section, motion: resolveImageMotion(section.motion, index),
      intro_duration_sec: original.mode === "segments" || !section.intro_asset_id ? section.intro_duration_sec : Math.min(frameDuration - 1 / VIDEO_FPS, clock(section.start_sec + (section.intro_duration_sec ?? 0)) - clock(section.start_sec)),
      support_start_sec: original.mode === "segments" || section.support_start_sec === undefined ? section.support_start_sec : clock(section.start_sec + section.support_start_sec) - clock(section.start_sec),
      presentation_duration_sec: section.presentation_duration_sec ?? frameDuration,
      playback_offset_sec: section.playback_offset_sec ?? 0,
      motion_start: first ? OPENING_DURATION / (OPENING_DURATION + frameDuration) : section.motion_start,
      motion_end: section.motion_end };
  });
  original.narrations = original.narrations.map(clip => ({ ...clip, continuity_id: clip.continuity_id || `${scene.id}:${clip.id}` }));
  const start = scene.start_sec ?? entry.sourceStartMs / 1000;
  const sourceOffset = scene.split_origin?.start_sec ?? 0;
  const originId = scene.split_origin?.origin_scene_id || scene.id;
  const makePart = (id: string, from: number, to: number, captions: NonNullable<Scene["captions"]>, right: boolean): Scene => {
    const part: Scene = { ...structuredClone(scene), id, title: right ? `${scene.title} · 이어짐` : scene.title, duration: Math.round((to - from) * 1000) / 1000,
      start_sec: (milliseconds(start) + milliseconds(from)) / 1000, end_sec: (milliseconds(start) + milliseconds(to)) / 1000,
      captions, narration: captions.map(block => block.text).join(" "), narration_audio: undefined,
      status: right && scene.status === "generating" ? scene.candidates.length ? "ready" : "idle" : scene.status,
      video_intro_candidate_id: null, emphasis_offset_sec: (scene.emphasis_offset_sec ?? 0) + clock(from),
      split_origin: { parent_scene_id: scene.id, origin_scene_id: originId, start_sec: (milliseconds(sourceOffset) + milliseconds(from)) / 1000, end_sec: (milliseconds(sourceOffset) + milliseconds(to)) / 1000 } };
    part.composition = bindComposition(part, cropComposition(original, from, to, clock));
    return part;
  };
  const left = makePart(scene.id, 0, cut, scene.captions!.slice(0, captionIndex), false);
  const right = makePart(newSceneId, cut, duration, scene.captions!.slice(captionIndex), true);
  const scenes = [...ordered.slice(0, index), left, right, ...ordered.slice(index + 1)].map((item, position) => ({ ...item, number: position + 1 }));
  const core = prepared.editor?.core_scene_ids || [];
  return { ...prepared, editor_version: 4, media: prepared.media || { assets: [] }, scenes,
    editor: { ...prepared.editor, core_scene_ids: core.includes(scene.id) ? [...core.slice(0, core.indexOf(scene.id) + 1), right.id, ...core.slice(core.indexOf(scene.id) + 1)] : core } };
}
