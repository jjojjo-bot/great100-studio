import { allCandidates, candidateAssetId } from "./media-composition";
import { getMediaAsset, isTauri } from "./platform";
import { detectImageFormat } from "./image-format";
import { originalCandidateId } from "./image-library";
import type { ImageCandidate, MediaAsset, ProjectData } from "./types";

async function decodeOriginal(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const timer = window.setTimeout(() => { image.onload = null; image.onerror = null; image.src = ""; reject(new Error("이미지 확인 시간이 초과되었습니다.")); }, 30_000);
      const finish = (valid: boolean) => { window.clearTimeout(timer); image.onload = null; image.onerror = null; valid ? resolve() : reject(new Error("이미지 원본을 읽을 수 없습니다.")); };
      image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
      image.onerror = () => finish(false); image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function readOriginalImageCandidate(project: ProjectData, asset: MediaAsset, decode: (blob: Blob) => Promise<void> = decodeOriginal): Promise<ImageCandidate> {
  const id = originalCandidateId(asset);
  if (!id) throw new Error("복원할 이미지 후보 식별 정보가 없습니다.");
  // An image just saved to the account can still carry its original inline
  // bytes in this tab, before a reload hydrates its storage key. Desktop reads
  // always check the actual retained file at its original path.
  const original = !isTauri() && !asset.storage_key && asset.inline_data ? await (await fetch(asset.inline_data)).blob() : await getMediaAsset(project, asset);
  if (!original?.size) throw new Error("이미지 원본이 없습니다. 원래 작업하던 기기에서 확인해 주세요.");
  if (original.size > 12_000_000) throw new Error("12MB 이하의 이미지 원본만 후보로 복원할 수 있습니다.");
  const format = detectImageFormat(new Uint8Array(await original.slice(0, 12).arrayBuffer()));
  const mime = format?.mime || (asset.mime_type === "image/svg+xml" ? "image/svg+xml" : "");
  if (!mime || mime !== asset.mime_type) throw new Error("이미지 원본의 형식 정보를 확인해 주세요.");
  const blob = new Blob([original], { type: mime });
  await decode(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  const existing = allCandidates(project).find(candidate => candidateAssetId(candidate) === asset.id);
  return { ...existing, id, path: asset.path, preview_url: `data:${mime};base64,${btoa(binary)}`, created_at: existing?.created_at || new Date().toISOString(),
    mode: existing?.mode || (mime === "image/svg+xml" ? "mock" : "uploaded"), media_type: "image", storage_key: asset.storage_key, preview_storage_key: asset.preview_storage_key };
}
