import { detectImageFormat } from "./image-format";
import { collectMediaAssets, resolveVideoIntroImage, sceneComposition, visualSelectionFingerprint as batchVisualFingerprint } from "./media-composition";
import type { ImageCandidate, ProjectData, Scene } from "./types";

export const MAX_BATCH_IMAGES = 40;
export const MAX_BATCH_BYTES = 120_000_000;
export type BatchSelection = "keep" | "replace";
export type BatchImageRequest = { projectId: string; sceneId: string; file: File; selection: "fill" | "replace" | "candidate"; expectedVisual: string };

// Only explicit scene labels or a leading number qualify. Dates, episode
// numbers, and conflicting scene labels never silently become assignments.
export function suggestedSceneId(name: string, scenes: Scene[]): string {
  const stem = name.replace(/\.[^.]+$/, "");
  const labels = [...stem.matchAll(/(?:(?:^|[^a-z0-9])scene|장면)[\s_.-]*0*(\d+)(?=$|[\s_.-])/gi)].map(match => Number(match[1]));
  const numbers = new Set(labels.length ? labels : [/^0*(\d+)(?=$|[\s_.-])/.exec(stem)?.[1]].filter(Boolean).map(Number));
  if (numbers.size !== 1) return "";
  const matches = scenes.filter(scene => scene.number === [...numbers][0]);
  return matches.length === 1 ? matches[0].id : "";
}

export { batchVisualFingerprint };

export async function inspectBatchImage(file: File, decode: (file: File) => Promise<void> = decodeImage): Promise<void> {
  if (!file.size || file.size > 12_000_000) throw new Error("12MB 이하의 비어 있지 않은 이미지를 선택해 주세요.");
  const format = detectImageFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!format) throw new Error("PNG·JPEG·WebP 이미지만 사용할 수 있습니다.");
  if (file.type && file.type !== format.mime) throw new Error("파일 내용과 이미지 형식이 맞지 않습니다.");
  try { await decode(file); }
  catch { throw new Error("이미지를 읽을 수 없습니다. 다른 파일을 선택해 주세요."); }
}

async function decodeImage(file: File): Promise<void> {
  if (typeof createImageBitmap === "function") { const bitmap = await createImageBitmap(file); bitmap.close(); return; }
  const url = URL.createObjectURL(file);
  try { await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = reject; image.src = url; }); }
  finally { URL.revokeObjectURL(url); }
}

export function attachBatchImage(project: ProjectData, request: BatchImageRequest, candidate: ImageCandidate): { project: ProjectData; note: string; selected: boolean } {
  if (project.id !== request.projectId) throw new Error("이미지를 연결할 프로젝트가 다릅니다.");
  const scene = project.scenes.find(item => item.id === request.sceneId);
  if (!scene) {
    // A split/merge/undo can remove the target during an upload. Retain the
    // successful original without guessing a different scene from its number.
    const assets = collectMediaAssets({ ...project, anchor: { ...project.anchor, candidates: [...project.anchor.candidates, candidate] } });
    return { project: { ...project, media: { assets } }, note: "장면이 없어 원본 자료에 보관했습니다. ZIP에서 확인할 수 있습니다.", selected: false };
  }
  const changed = batchVisualFingerprint(scene) !== request.expectedVisual;
  const hasVisual = sceneComposition(scene).visuals.length > 0;
  const select = !changed && (request.selection === "replace" || request.selection === "fill" && !hasVisual);
  const next = { ...scene, candidates: [...scene.candidates.filter(item => item.id !== candidate.id), candidate],
    // Legacy videos automatically use the last uploaded image as an intro.
    // Pin the existing choice (including no intro) before adding a candidate.
    ...(!select && scene.candidates.find(item => item.id === scene.selected_candidate_id)?.media_type === "video" && scene.video_intro_candidate_id === undefined
      ? { video_intro_candidate_id: resolveVideoIntroImage(scene)?.id ?? null } : {}),
    selected_candidate_id: select ? candidate.id : scene.selected_candidate_id, status: "ready" as const };
  return { project: { ...project, scenes: project.scenes.map(item => item.id === scene.id ? next : item) },
    selected: select, note: select ? "화면으로 선택했습니다." : changed && request.selection !== "candidate" ? "화면이 변경되어 후보로만 추가했습니다." : "기존 화면을 유지하고 후보로 추가했습니다." };
}
