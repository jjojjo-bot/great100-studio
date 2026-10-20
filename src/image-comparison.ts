import { bindComposition, candidateAssetId, prepareMediaProject, sceneComposition, visualSelectionFingerprint } from "./media-composition";
import type { ImageCandidate, ProjectData, Scene } from "./types";

export type ImageComparisonRequest = { projectId: string; sceneId: string; candidateId: string; expectedVisual: string };
export type ImageComparisonResult = "saved" | "unsaved" | "changed";
export const imageCandidates = (scene: Scene) => scene.candidates.filter(candidate => candidate.media_type !== "video");

export function isCurrentImage(scene: Scene, candidate: ImageCandidate): boolean {
  const visuals = sceneComposition(scene).visuals;
  return visuals.length === 1 && visuals[0].asset_id === candidateAssetId(candidate);
}

export function initialComparisonIds(scene: Scene): string[] {
  const candidates = imageCandidates(scene);
  const used = [...new Set(sceneComposition(scene).visuals.map(section => section.asset_id))];
  const current = used.flatMap(id => candidates.filter(candidate => candidateAssetId(candidate) === id));
  return [...current, ...candidates.filter(candidate => !current.some(item => item.id === candidate.id))].slice(0, 4).map(candidate => candidate.id);
}

export function imageUsage(scene: Scene, candidate: ImageCandidate): string {
  if (isCurrentImage(scene, candidate)) return "현재 선택";
  const sections = sceneComposition(scene).visuals.flatMap((section, index) => section.asset_id === candidateAssetId(candidate) ? [index + 1] : []);
  return sections.length ? `현재 ${sections.join("·")}구간` : "";
}

export function applyComparedImage(project: ProjectData, request: ImageComparisonRequest): ProjectData {
  if (project.id !== request.projectId) throw new Error("비교한 프로젝트가 다릅니다.");
  const scene = project.scenes.find(item => item.id === request.sceneId);
  if (!scene) throw new Error("비교한 장면이 없어졌습니다. 작업 보드에서 다시 선택해 주세요.");
  const candidate = imageCandidates(scene).find(item => item.id === request.candidateId);
  if (!candidate) throw new Error("이미지 후보가 없어졌습니다. 최신 후보를 다시 골라 주세요.");
  if (visualSelectionFingerprint(scene) !== request.expectedVisual) throw new Error("현재 화면이 변경되었습니다. 최신 화면을 확인하고 후보를 다시 골라 주세요.");
  if (isCurrentImage(scene, candidate)) return project;
  const next = { ...scene, selected_candidate_id: candidate.id };
  if (scene.composition?.mode === "segments") {
    // Choosing the first image of a merged scene must also be able to replace
    // the whole visual track, even when its legacy selected ID already matches.
    const fresh = sceneComposition({ ...next, composition: undefined });
    next.composition = bindComposition(next, { ...sceneComposition(scene), visuals: fresh.visuals });
  }
  return prepareMediaProject({ ...project, scenes: project.scenes.map(item => item.id === scene.id ? next : item) }, project);
}
