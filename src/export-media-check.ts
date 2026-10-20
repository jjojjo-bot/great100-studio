import { buildSceneSegments, buildVideoPlan, visualPlayback, type VideoSegment } from "./video";
import { collectMediaAssets, musicAssetId } from "./media-composition";
import { narrationTimeline } from "./narration-timeline";
import { orderedScenes } from "./scene-order";
import { VIDEO_FPS } from "./timeline";
import type { MediaAsset, ProjectData } from "./types";

export type CheckLocation = { sceneId?: string; target: "scene" | "thumbnail" | "music" | "project"; label: string };
export type MediaCheckItem = { key: string; kind: "image" | "poster" | "video" | "audio"; asset: MediaAsset; previewUrl?: string; locations: CheckLocation[]; times: number[]; requiredEnd: number; fingerprint: string };
export type MediaCheckPlan = { items: MediaCheckItem[]; issues: { message: string; location: CheckLocation }[]; fingerprint: string };
export type MediaCheckResult = { fingerprint: string; originalData?: string; previewData?: string; status: "passed" | "error"; message: string };

const checkPreviewData = (item: MediaCheckItem) => item.kind === "poster"
  ? item.asset.preview_storage_key ? undefined : item.previewUrl || item.asset.preview_inline_data || item.asset.preview_url
  : item.asset.storage_key ? undefined : item.previewUrl;
export function checkResult(item: MediaCheckItem, status: MediaCheckResult["status"], message: string): MediaCheckResult {
  return { fingerprint: item.fingerprint, originalData: item.asset.inline_data, previewData: checkPreviewData(item), status, message };
}
export function currentCheckResult(item: MediaCheckItem, result?: MediaCheckResult): boolean {
  return !!result && result.fingerprint === item.fingerprint && result.originalData === item.asset.inline_data
    && result.previewData === checkPreviewData(item);
}
export function sameMediaCheckPlan(left: MediaCheckPlan, right: MediaCheckPlan): boolean {
  return left.fingerprint === right.fingerprint && left.items.length === right.items.length
    && left.items.every((item, index) => currentCheckResult(right.items[index], checkResult(item, "passed", "")));
}

// Signed URLs are temporary. Storage identities and inline bytes describe the
// original; frame samples and required audio windows describe its current use.
// Large inline strings stay as references in results instead of being copied
// into a serialized fingerprint on every editor change.
export function mediaCheckFingerprint(item: MediaCheckItem): string {
  const a = item.asset;
  const preview = item.kind === "poster" ? a.preview_storage_key || item.previewUrl : !a.storage_key ? item.previewUrl : undefined;
  return JSON.stringify([item.key, a.path, a.kind, a.mime_type, a.storage_key, a.preview_storage_key, a.local_store, a.local_key,
    preview?.startsWith("data:") ? "inline" : preview, item.times, item.requiredEnd]);
}

export function exportMediaCheckPlan(project: ProjectData): MediaCheckPlan {
  const items = new Map<string, MediaCheckItem>(), issues: MediaCheckPlan["issues"] = [];
  const projectLocation: CheckLocation = { target: "project", label: "프로젝트" };
  const issue = (message: string, location: CheckLocation) => { if (!issues.some(i => i.message === message)) issues.push({ message, location }); };
  let assets: MediaAsset[];
  try { assets = collectMediaAssets(project); }
  catch (cause) { return { items: [], issues: [{ message: (cause as Error).message, location: projectLocation }], fingerprint: JSON.stringify([project.id, (cause as Error).message]) }; }
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const add = (id: string | undefined, kind: MediaCheckItem["kind"], location: CheckLocation, previewUrl?: string, times: number[] = [], requiredEnd = 0) => {
    if (!id) return;
    const asset = byId.get(id);
    if (!asset) { issue(`${location.label} 원본 자료 연결을 찾지 못했습니다.`, location); return; }
    const key = `${kind}:${id}`, item = items.get(key) || { key, kind, asset, previewUrl, locations: [], times: [], requiredEnd: 0, fingerprint: "" };
    if (!item.locations.some(use => use.sceneId === location.sceneId && use.target === location.target && use.label === location.label)) item.locations.push(location);
    item.times = [...new Set([...item.times, ...times])].sort((a, b) => a - b);
    item.requiredEnd = Math.max(item.requiredEnd, requiredEnd);
    items.set(key, item);
  };
  const addSegment = (segment: VideoSegment, location: CheckLocation) => {
    if (segment.imageAssetId) add(segment.imageAssetId, byId.get(segment.imageAssetId)?.kind === "video" ? "poster" : "image", location, segment.imageUrl);
    if (segment.supportImageAssetId) add(segment.supportImageAssetId, "image", { ...location, label: `${location.label} · 보조 화면` }, segment.supportImageUrl);
    if (segment.videoAssetId) {
      const frames = Math.round(segment.duration * VIDEO_FPS), states = Array.from({ length: frames }, (_, n) => visualPlayback(segment, n / VIDEO_FPS)).filter(state => state.videoActive);
      if (states.length) {
        const first = states[0].videoTime, last = states.at(-1)!.videoTime;
        add(segment.videoAssetId, "video", location, undefined, [first, (first + last) / 2, last], last);
      }
    }
  };
  // A bad scene must not prevent checking the files used by other scenes.
  for (const [index, scene] of orderedScenes(project).entries()) {
    const location: CheckLocation = { target: "scene", sceneId: scene.id, label: `Scene ${scene.number} · ${scene.title}` };
    try { for (const segment of buildSceneSegments(project, scene, index)) addSegment(segment, location); }
    catch (cause) { issue((cause as Error).message, location); }
    try { for (const clip of narrationTimeline(project, scene.id)) add(clip.asset_id, "audio", { ...location, label: `${location.label} · 녹음` }, undefined, [], clip.source_end_sec); }
    catch (cause) { issue((cause as Error).message, location); }
  }
  const thumbnail = project.thumbnail.candidates.find(candidate => candidate.id === project.thumbnail.selected_candidate_id);
  if (thumbnail) add(`candidate:${thumbnail.id}`, "image", { target: "thumbnail", label: "엔딩 · 썸네일" }, thumbnail.preview_url);
  if (project.background_music) add(musicAssetId(project), "audio", { target: "music", label: "전체 영상 · 배경음악" });
  try {
    const plan = buildVideoPlan(project);
    const first = plan[0];
    if (first?.opening) addSegment(first, { target: "scene", sceneId: orderedScenes(project)[0]?.id, label: "오프닝" });
    // Joining a split voice can extend its effective source window by a frame.
    for (const clip of narrationTimeline(project)) {
      const item = items.get(`audio:${clip.asset_id}`);
      if (item) item.requiredEnd = Math.max(item.requiredEnd, clip.source_end_sec);
    }
  } catch (cause) { issue((cause as Error).message, projectLocation); }
  const list = [...items.values()];
  for (const item of list) item.fingerprint = mediaCheckFingerprint(item);
  return { items: list, issues, fingerprint: JSON.stringify([project.id, list.map(item => [item.key, item.fingerprint]), issues]) };
}
