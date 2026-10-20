import { allCandidates, candidateAssetId, collectMediaAssets, prepareMediaProject, resolveVideoIntroImage, sceneComposition } from "./media-composition";
import { orderedScenes } from "./scene-order";
import type { ImageCandidate, MediaAsset, ProjectData } from "./types";

export type LibraryFilter = "all" | "used" | "unused" | "detached";
export type LibraryImage = { asset: MediaAsset; number: number; candidateId: string; uses: string[]; locations: string[]; previewUrl?: string };
export type RestoreImageRequest = { projectId: string; sceneId: string; assetId: string; expectedOriginal: string };
export type RestoreImageResult = { sceneId: string; message: string };

export const originalImageIdentity = (asset: MediaAsset) => JSON.stringify([asset.id, asset.kind, asset.path, asset.mime_type, asset.storage_key, asset.preview_storage_key, asset.local_store, asset.local_key]);
export const originalCandidateId = (asset: MediaAsset) => asset.kind === "image" && asset.id.startsWith("candidate:") ? asset.id.slice("candidate:".length) : "";

export function libraryImages(project: ProjectData): { images: LibraryImage[]; warnings: string[] } {
  const images: LibraryImage[] = collectMediaAssets(project).filter(asset => asset.kind === "image").map((asset, index) => ({ asset, number: index + 1, candidateId: originalCandidateId(asset), uses: [], locations: [], previewUrl: asset.preview_url || asset.inline_data }));
  const byId = new Map(images.map(item => [item.asset.id, item]));
  const add = (id: string | undefined, kind: "uses" | "locations", label: string) => { const item = id && byId.get(id); if (item && !item[kind].includes(label)) item[kind].push(label); };
  for (const [asset, label] of [[project.anchor, "인물 기준 이미지"], [project.thumbnail, "썸네일"]] as const) {
    for (const candidate of asset.candidates) { add(candidateAssetId(candidate), "locations", `${label} 후보`); if (candidate.id === asset.selected_candidate_id) add(candidateAssetId(candidate), "uses", label); }
  }
  const warnings: string[] = [];
  for (const scene of orderedScenes(project)) {
    const label = `Scene ${scene.number} · ${scene.title}`;
    for (const candidate of scene.candidates) add(candidateAssetId(candidate), "locations", `${label} · 메인 후보`);
    for (const candidate of scene.support_candidates || []) add(candidateAssetId(candidate), "locations", `${label} · 보조 후보`);
    try {
      for (const section of sceneComposition(scene).visuals) {
        add(section.asset_id, "uses", `${label} · 주 화면`);
        add(section.intro_asset_id, "uses", `${label} · 앞 이미지`);
        add(section.support_asset_id, "uses", `${label} · 보조 화면`);
      }
    } catch { warnings.push(`Scene ${scene.number}의 화면 연결을 읽지 못했습니다.`); }
  }
  for (const candidate of allCandidates(project)) {
    const item = byId.get(candidateAssetId(candidate));
    if (item && !item.previewUrl && candidate.preview_url) item.previewUrl = candidate.preview_url;
  }
  return { images, warnings };
}

export function filterLibraryImages(images: LibraryImage[], filter: LibraryFilter, search: string, complete: boolean): LibraryImage[] {
  const query = search.trim().toLocaleLowerCase();
  return images.filter(item => (filter === "all" || filter === "used" && item.uses.length > 0 || filter === "unused" && complete && !item.uses.length || filter === "detached" && !item.locations.length)
    && (!query || [item.asset.path, item.asset.id, `원본 이미지 ${item.number}`, ...item.uses, ...item.locations].join(" ").toLocaleLowerCase().includes(query)));
}

export function originalImage(project: ProjectData, request: RestoreImageRequest): MediaAsset {
  if (project.id !== request.projectId) throw new Error("원본을 복원할 프로젝트가 다릅니다.");
  if (!project.scenes.some(scene => scene.id === request.sceneId)) throw new Error("후보를 추가할 장면이 없어졌습니다. 장면을 다시 선택해 주세요.");
  const asset = collectMediaAssets(project).find(item => item.id === request.assetId && item.kind === "image");
  if (!asset || originalImageIdentity(asset) !== request.expectedOriginal) throw new Error("원본 이미지 정보가 변경되었습니다. 보관함에서 다시 선택해 주세요.");
  if (!originalCandidateId(asset)) throw new Error("후보 식별 정보가 없는 원본입니다. ZIP에서 원본 파일을 확인해 주세요.");
  return asset;
}

export function restoreImageCandidate(project: ProjectData, request: RestoreImageRequest, candidate: ImageCandidate): ProjectData {
  const asset = originalImage(project, request), scene = project.scenes.find(item => item.id === request.sceneId)!;
  if (candidateAssetId(candidate) !== asset.id || candidate.path !== asset.path || candidate.media_type === "video" || candidate.storage_key !== asset.storage_key) throw new Error("복원할 이미지 원본 연결이 다릅니다.");
  if (scene.candidates.some(item => candidateAssetId(item) === asset.id)) return project;
  const next = { ...scene, candidates: [...scene.candidates, candidate], status: "ready" as const,
    ...(scene.candidates.find(item => item.id === scene.selected_candidate_id)?.media_type === "video" && scene.video_intro_candidate_id === undefined
      ? { video_intro_candidate_id: resolveVideoIntroImage(scene)?.id ?? null } : {}) };
  return prepareMediaProject({ ...project, scenes: project.scenes.map(item => item.id === scene.id ? next : item) }, project);
}
