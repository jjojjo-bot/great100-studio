import { getMediaAsset, isTauri } from "./platform";
import { cloudContext, downloadCloudFile } from "./cloud";
import { openSceneVideo } from "./scene-video";
import type { MediaCheckItem } from "./export-media-check";
import type { ProjectData } from "./types";

export function abortable<T>(promise: Promise<T>, signal: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let stopped = signal.aborted;
    const abort = () => { stopped = true; reject(signal.reason || new DOMException("점검 중단", "AbortError")); };
    if (stopped) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); if (stopped) disposeLate?.(value); else resolve(value); }, cause => { signal.removeEventListener("abort", abort); if (!stopped) reject(cause); });
  });
}

async function checkImage(blob: Blob, signal: AbortSignal) {
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    image.src = url;
    await abortable(image.decode(), signal);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("이미지를 읽을 수 없습니다.");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 검사 화면을 만들 수 없습니다.");
    context.drawImage(image, 0, 0, 1, 1); context.getImageData(0, 0, 1, 1);
  } finally { image.src = ""; URL.revokeObjectURL(url); }
}

async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("이미지 파일을 불러오지 못했습니다.");
  return response.blob();
}

// Reads one retained original at a time. No upload, project write or media
// re-encoding occurs. The caller owns cancellation and the per-file timeout.
export async function inspectExportMedia(project: ProjectData, item: MediaCheckItem, signal: AbortSignal): Promise<string> {
  const asset = item.asset, cloud = !isTauri() && cloudContext(project);
  const read = async () => {
    if (item.kind === "poster") {
      if (cloud && asset.preview_storage_key) return downloadCloudFile(project, asset.preview_storage_key);
      const url = item.previewUrl || asset.preview_inline_data || asset.preview_url;
      if (!url) throw new Error("동영상 대표 이미지가 없습니다.");
      return fetchBlob(url, signal);
    }
    if (!isTauri() && !asset.storage_key && asset.inline_data) return fetchBlob(asset.inline_data, signal);
    return getMediaAsset(project, asset);
  };
  const original = await abortable(read(), signal);
  if (!original?.size) throw new Error("원본 파일이 없습니다. 원래 작업하던 기기에서 확인하거나 다시 업로드해 주세요.");
  const blob = new Blob([original], { type: item.kind === "poster" ? original.type : asset.mime_type });
  if (item.kind === "image" || item.kind === "poster") {
    await checkImage(blob, signal);
    if (item.kind === "image" && !item.previewUrl && !(cloud && asset.storage_key)) throw new Error("출력에 사용할 이미지 연결이 없습니다. 이미지를 다시 선택하거나 업로드해 주세요.");
    if (item.kind === "image" && item.previewUrl && !asset.storage_key && item.previewUrl !== asset.inline_data) await checkImage(await fetchBlob(item.previewUrl, signal), signal);
    return item.kind === "poster" ? "대표 이미지 확인" : "이미지 원본 확인";
  }
  if (item.kind === "video") {
    const video = await abortable(openSceneVideo(blob), signal, value => value.input.dispose());
    try {
      if (item.requiredEnd > video.duration + 0.05) throw new Error("동영상 원본이 사용할 구간보다 짧습니다. 트림을 확인해 주세요.");
      for (const time of item.times) {
        const frame = await abortable(video.sink.getCanvas(video.firstTimestamp + Math.min(time, video.duration - 0.001)), signal);
        if (!frame) throw new Error("사용할 구간의 동영상 프레임을 읽지 못했습니다.");
      }
      return "동영상 원본·사용 구간의 대표 프레임 확인";
    } finally { video.input.dispose(); }
  }
  const context = new AudioContext();
  try {
    const decoded = ["audio/mp4", "video/mp4"].includes(asset.mime_type)
      ? await abortable((await import("./music")).decodeMpeg4Audio(blob, context, signal), signal)
      : await abortable(context.decodeAudioData(await blob.arrayBuffer()), signal);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || !decoded.numberOfChannels || !decoded.length) throw new Error("오디오 원본을 읽을 수 없습니다.");
    if (item.requiredEnd > decoded.duration + 0.05) throw new Error("녹음 원본이 사용할 구간보다 짧습니다. 녹음과 장면 시간을 확인해 주세요.");
    return "오디오 원본·사용 구간 확인";
  } finally { await context.close(); }
}
