import { collectMediaAssets, sceneComposition } from "./media-composition";
import { isCoreScene } from "./editor-format";
import { orderedScenes } from "./scene-order";
import type { MediaAsset, ProjectData, Scene, SceneComposition } from "./types";

export const REVIEW_FILTERS = [
  { id: "all", label: "모든 장면" }, { id: "visual", label: "화면 미선택" },
  { id: "narration", label: "녹음 없음" }, { id: "timing", label: "시간 오류" },
] as const;
export type ReviewFilter = typeof REVIEW_FILTERS[number]["id"];
export interface ReviewView {
  filter: ReviewFilter; scrollY: number;
  anchor?: { sceneId: string; offset: number };
  returning?: boolean;
}
export const createReviewView = (): ReviewView => ({ filter: "all", scrollY: 0 });
export interface SceneReview {
  scene: Scene; duration: number; captionCount: number; hasCaption: boolean;
  hasVisual: boolean; visualCount: number; visualLabel: string; previewUrl?: string; supportPreviewUrls: string[];
  hasNarration: boolean; narrationCount: number; timingIssues: string[]; mediaIssues: string[]; core: boolean;
}
const finite = (value: number | undefined): value is number => Number.isFinite(value);
const imageUrl = (asset?: MediaAsset) => asset?.preview_url || asset?.preview_inline_data || (asset?.kind === "image" ? asset.inline_data : undefined);

// Read-only diagnostics. No file downloads, generation, project writes or timing
// normalization happen while viewing or filtering the board.
export function reviewScenes(project: ProjectData): SceneReview[] {
  let assets: MediaAsset[] = [];
  let registryError = "";
  try { assets = collectMediaAssets(project); } catch (error) { registryError = (error as Error).message; }
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const ordered = orderedScenes(project);
  return ordered.map((scene, index) => {
    const duration = scene.duration ?? 10;
    const timingIssues: string[] = [], mediaIssues: string[] = registryError ? [registryError] : [];
    if (!finite(duration) || duration < 1 || duration > 120) timingIssues.push("장면 길이는 1~120초여야 합니다.");
    if (project.schema_version !== 1) {
      if (!finite(scene.start_sec) || !finite(scene.end_sec) || scene.end_sec <= scene.start_sec) timingIssues.push("장면 시작·종료 시간을 확인해 주세요.");
      else {
        if (Math.abs(scene.end_sec - scene.start_sec - duration) > 0.001) timingIssues.push("장면 길이와 시작·종료 시간이 다릅니다.");
        const previous = ordered[index - 1];
        if (previous && finite(previous.end_sec) && previous.end_sec > scene.start_sec) timingIssues.push("이전 장면과 시간이 겹칩니다.");
      }
    }
    if (project.schema_version === "2.1") {
      let previousEnd = -Infinity;
      for (const [captionIndex, block] of (scene.captions || []).entries()) {
        if (!finite(block.start_sec) || !finite(block.end_sec) || block.end_sec <= block.start_sec) timingIssues.push(`자막 ${captionIndex + 1}의 시작·종료 시간을 확인해 주세요.`);
        else {
          if (block.start_sec < (scene.start_sec ?? 0) || block.end_sec > (scene.end_sec ?? (scene.start_sec ?? 0) + duration)) timingIssues.push(`자막 ${captionIndex + 1}이 장면 범위를 벗어났습니다.`);
          if (block.start_sec < previousEnd) timingIssues.push(`자막 ${captionIndex + 1}이 이전 자막과 겹칩니다.`);
          previousEnd = block.end_sec;
        }
      }
    }
    if (scene.narration_audio && (!finite(scene.narration_audio.duration_sec) || scene.narration_audio.duration_sec <= 0 || scene.narration_audio.duration_sec > duration + 0.15)) timingIssues.push("녹음 길이를 확인하고 장면 시간에 맞춰 주세요.");
    let composition: SceneComposition = { source_signature: "", visuals: [], narrations: [] };
    try { composition = sceneComposition(scene); } catch (error) { mediaIssues.push((error as Error).message); }
    const validRange = (start: number, end: number) => finite(start) && finite(end) && start >= 0 && end > start && end <= duration + 0.000001;
    let visualEnd = 0;
    for (const section of composition.visuals) {
      if (!validRange(section.start_sec, section.end_sec) || Math.abs(section.start_sec - visualEnd) > 0.000001) timingIssues.push("화면 구간의 시간이나 연결 순서를 확인해 주세요.");
      const asset = byId.get(section.asset_id);
      if (!asset || !asset.path || !["image", "video"].includes(asset.kind)) mediaIssues.push("화면 원본 연결을 확인해 주세요.");
      if (asset?.kind === "video" && (!finite(section.source_start_sec) || !finite(section.source_end_sec) || section.source_start_sec < 0 || section.source_end_sec <= section.source_start_sec || section.source_end_sec > (asset.duration_sec ?? Infinity) + 0.001)) timingIssues.push("동영상 원본의 시작·종료 구간을 확인해 주세요.");
      const presentation = section.presentation_duration_sec ?? section.end_sec - section.start_sec, offset = section.playback_offset_sec ?? 0;
      if (!finite(section.source_start_sec) || section.source_start_sec < 0 || !finite(presentation) || presentation <= 0 || !finite(offset) || offset < 0 || offset + section.end_sec - section.start_sec > presentation + 2 / 15 + 0.001) timingIssues.push("화면의 원본 재생 위치를 확인해 주세요.");
      if (section.intro_asset_id && (!finite(section.intro_duration_sec) || section.intro_duration_sec < 0 || section.intro_duration_sec >= presentation)) timingIssues.push("앞 이미지의 전환 시간을 확인해 주세요.");
      if (section.support_asset_id && (!finite(section.support_start_sec) || section.support_start_sec < 0 || section.support_start_sec >= presentation)) timingIssues.push("보조 이미지의 전환 시간을 확인해 주세요.");
      for (const id of [section.intro_asset_id, section.support_asset_id]) if (id && byId.get(id)?.kind !== "image") mediaIssues.push("보조 화면 원본 연결을 확인해 주세요.");
      visualEnd = section.end_sec;
    }
    if (composition.visuals.length && Math.abs(visualEnd - duration) > 0.000001) timingIssues.push("화면 구간이 장면 길이와 다릅니다.");
    let voiceEnd = 0;
    for (const clip of composition.narrations) {
      const asset = byId.get(clip.asset_id);
      if (!asset || !asset.path || asset.kind !== "audio") mediaIssues.push("녹음 원본 연결을 확인해 주세요.");
      if (!validRange(clip.start_sec, clip.end_sec) || clip.start_sec < voiceEnd || !finite(clip.source_start_sec) || !finite(clip.source_end_sec)
        || clip.source_start_sec < 0 || clip.source_end_sec <= clip.source_start_sec || clip.source_end_sec > (asset?.duration_sec ?? Infinity) + 0.001
        || !finite(clip.timeline_offset_sec ?? 0) || Math.abs(clip.timeline_offset_sec ?? 0) > 2 / 15 + 0.001
        || (clip.playback_end_sec !== undefined && (!finite(clip.playback_end_sec) || clip.playback_end_sec < 0 || clip.playback_end_sec > duration + 2 / 15 + 0.001))
        || Math.abs(clip.end_sec - clip.start_sec - clip.source_end_sec + clip.source_start_sec) > 0.001) timingIssues.push("녹음 구간의 시간이나 원본 범위를 확인해 주세요.");
      voiceEnd = clip.end_sec;
    }
    const visuals = composition.visuals.filter(section => { const asset = byId.get(section.asset_id); return !!asset?.path && ["image", "video"].includes(asset.kind); });
    const voices = composition.narrations.filter(clip => byId.get(clip.asset_id)?.kind === "audio" && !!byId.get(clip.asset_id)?.path);
    const first = visuals[0], main = first && byId.get(first.asset_id);
    const intro = first?.intro_asset_id && (first.playback_offset_sec ?? 0) < (first.intro_duration_sec ?? 0) ? byId.get(first.intro_asset_id) : undefined;
    const hasVisual = !!visuals.length && visuals.length === composition.visuals.length && !registryError;
    const hasVideo = visuals.some(section => byId.get(section.asset_id)?.kind === "video");
    const supportPreviewUrls = [...new Set(composition.visuals.map(section => section.support_asset_id && imageUrl(byId.get(section.support_asset_id))).filter((url): url is string => !!url))];
    const captionCount = project.schema_version === "2.1" ? scene.captions?.length || 0 : (scene.caption ?? scene.title)?.trim() ? 1 : 0;
    return { scene, duration, captionCount, hasCaption: project.schema_version === "2.1" ? !!captionCount && !!scene.captions?.every(block => block.text.trim()) : !!captionCount,
      hasVisual, visualCount: composition.visuals.length, visualLabel: hasVisual ? `${hasVideo ? "동영상" : "이미지"}${composition.visuals.length > 1 ? ` · ${composition.visuals.length}구간` : ""}` : "화면 미선택",
      previewUrl: imageUrl(intro || main), supportPreviewUrls, hasNarration: !!voices.length && voices.length === composition.narrations.length && !registryError,
      narrationCount: composition.narrations.length, timingIssues: [...new Set(timingIssues)], mediaIssues: [...new Set(mediaIssues)], core: isCoreScene(project, scene) };
  });
}

export function matchesReviewFilter(item: SceneReview, filter: ReviewFilter): boolean {
  return filter === "visual" ? !item.hasVisual : filter === "narration" ? !item.hasNarration : filter === "timing" ? !!item.timingIssues.length : true;
}
