import type { ImageCandidate, Scene, VisualAsset } from "./types";

export function withoutAssetCandidate(asset: VisualAsset, candidateId: string): VisualAsset {
  return {
    ...asset,
    candidates: asset.candidates.filter((candidate) => candidate.id !== candidateId),
    selected_candidate_id: asset.selected_candidate_id === candidateId ? undefined : asset.selected_candidate_id,
  };
}

export function withoutSceneCandidate(scene: Scene, candidateId: string, support = false): Scene {
  if (support) return {
    ...scene,
    support_candidates: (scene.support_candidates || []).filter((candidate) => candidate.id !== candidateId),
    support_selected_candidate_id: scene.support_selected_candidate_id === candidateId ? undefined : scene.support_selected_candidate_id,
  };
  const candidates = scene.candidates.filter((candidate) => candidate.id !== candidateId);
  return {
    ...scene,
    candidates,
    selected_candidate_id: scene.selected_candidate_id === candidateId ? undefined : scene.selected_candidate_id,
    video_intro_candidate_id: scene.video_intro_candidate_id === candidateId ? undefined : scene.video_intro_candidate_id,
  };
}

export function findCandidate(candidates: ImageCandidate[], id: string): ImageCandidate {
  const candidate = candidates.find((item) => item.id === id);
  if (!candidate) throw new Error("삭제할 후보를 찾지 못했습니다. 화면을 새로고침해 주세요.");
  return candidate;
}
