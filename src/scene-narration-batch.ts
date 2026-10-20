import { collectMediaAssets, narrationAssetId, sceneComposition, sceneNarrationAsset } from "./media-composition";
import { narrationScript } from "./narration-generation";
import { proposeNarrationTiming, timingFingerprint, type CaptionTimingMode } from "./timeline";
import type { PreparedNarration } from "./platform";
import type { ProjectData, Scene, SceneNarrationAudio } from "./types";

export const MAX_BATCH_NARRATIONS = 40;
export const MAX_BATCH_NARRATION_BYTES = 120_000_000;
export type NarrationBatchSelection = "keep" | "replace";
export type SavedBatchNarration = { narration: SceneNarrationAudio; originSceneId: string };
export type BatchNarrationRequest = {
  projectId: string; sceneId: string; prepared: PreparedNarration; selection: NarrationBatchSelection; expected: string;
  saved?: SavedBatchNarration; timing?: { expected: string; mode: CaptionTimingMode };
};
export type BatchNarrationResult = { saved: SavedBatchNarration; applied: boolean; note: string };
export type NarrationBatchRow = { id: string; file: File; sceneId: string; previewUrl: string; prepared?: PreparedNarration; saved?: SavedBatchNarration;
  status: "checking" | "ready" | "applying" | "done" | "error"; invalid?: boolean; message?: string };

export const batchNarrationFingerprint = (scene: Scene) => JSON.stringify([scene.id, scene.duration ?? 10, narrationScript(scene),
  scene.captions?.map(block => [block.id, Math.round((block.start_sec - (scene.start_sec ?? 0)) * 1000), Math.round((block.end_sec - (scene.start_sec ?? 0)) * 1000)]),
  scene.narration_audio && [narrationAssetId(scene), scene.narration_audio.path, scene.narration_audio.storage_key, scene.narration_audio.duration_sec],
  sceneComposition(scene).narrations, scene.split_origin, scene.merge_origin]);

export function narrationRowState(project: ProjectData, rows: NarrationBatchRow[], row: NarrationBatchRow, selection: NarrationBatchSelection) {
  const scene = project.scenes.find(item => item.id === row.sceneId);
  let problem = "", hasNarration = false;
  try { if (scene) hasNarration = sceneComposition(scene).narrations.length > 0; } catch { problem = "장면의 녹음 구성을 확인해 주세요."; }
  if (!problem && row.invalid) problem = row.message || "파일을 확인해 주세요.";
  if (!problem && !scene) problem = row.sceneId ? "장면이 없어졌습니다. 연결할 장면을 다시 선택해 주세요." : "연결할 장면을 선택해 주세요.";
  if (!problem && rows.find(item => item.sceneId === row.sceneId && !item.invalid)?.id !== row.id) problem = "같은 장면에는 파일 하나만 연결하세요. 먼저 연결한 파일을 확인해 주세요.";
  if (!problem && selection === "keep" && hasNarration) problem = "기존 녹음을 유지합니다. 바꾸려면 ‘새 녹음으로 교체’를 선택하세요.";
  const long = !!scene && !!row.prepared && row.prepared.duration > (scene.duration ?? 10) + 0.000001;
  return { scene, hasNarration, problem, long, ready: !!row.prepared && !problem && row.status !== "checking" && row.status !== "applying" && row.status !== "done" };
}

export function planBatchNarration(project: ProjectData, request: BatchNarrationRequest): ProjectData {
  const scene = project.scenes.find(item => item.id === request.sceneId);
  if (project.id !== request.projectId || !scene) throw new Error("연결할 장면이 없어졌습니다. 장면을 다시 선택해 주세요.");
  if (batchNarrationFingerprint(scene) !== request.expected) throw new Error("장면의 대본·시간·녹음이 변경되었습니다. 연결안을 확인한 뒤 다시 적용해 주세요.");
  if (request.selection === "keep" && sceneComposition(scene).narrations.length) throw new Error("기존 녹음이 있어 유지했습니다. 연결안을 확인하고 교체 여부를 선택해 주세요.");
  if (!Number.isFinite(request.prepared.duration) || request.prepared.duration <= 0 || request.prepared.duration > 120) throw new Error("녹음 길이는 0초 초과, 120초 이하여야 합니다.");
  if (request.timing) {
    if (timingFingerprint(project) !== request.timing.expected) throw new Error("전체 장면 시간이나 녹음이 변경되었습니다. 최신 시간 조정안을 다시 확인해 주세요.");
    return proposeNarrationTiming(project, scene.id, request.prepared.duration, request.timing.mode).project;
  }
  if (request.prepared.duration > (scene.duration ?? 10) + 0.000001) throw new Error("녹음이 장면보다 깁니다. 시간 조정 검토에서 확인해 주세요.");
  return project;
}

// Register the file against the scene used by the original storage operation.
// Reusing it elsewhere keeps that original local key, path and storage key.
export function retainBatchNarration(project: ProjectData, originSceneId: string, narration: SceneNarrationAudio): { project: ProjectData; narration: SceneNarrationAudio } {
  const original = sceneNarrationAsset(project, { id: originSceneId, narration_audio: narration })!;
  const assetId = original.id;
  const audio = { ...narration, asset_id: assetId };
  const assets = collectMediaAssets(project), previous = assets.find(asset => asset.id === assetId);
  if (previous && (previous.kind !== "audio" || previous.path !== narration.path || previous.storage_key !== narration.storage_key || previous.mime_type !== narration.mime_type)) throw new Error("저장한 녹음 원본 연결이 다릅니다. 최신 작업을 다시 확인해 주세요.");
  return { project: previous ? project : { ...project, media: { ...project.media, assets: [...assets, original] } }, narration: audio };
}

export function applyBatchNarration(project: ProjectData, request: BatchNarrationRequest, narration: SceneNarrationAudio): ProjectData {
  const next = planBatchNarration(project, request), asset = collectMediaAssets(next).find(item => item.id === narrationAssetId({ narration_audio: narration } as Scene));
  if (!asset || asset.kind !== "audio" || asset.path !== narration.path || asset.storage_key !== narration.storage_key || Math.abs((asset.duration_sec ?? 0) - request.prepared.duration) > 0.000001
    || Math.abs(narration.duration_sec - request.prepared.duration) > 0.000001) throw new Error("저장한 녹음 원본 정보를 확인해 주세요.");
  return { ...next, scenes: next.scenes.map(scene => scene.id === request.sceneId ? { ...scene, narration_audio: narration } : scene) };
}
