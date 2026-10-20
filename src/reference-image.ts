import { detectImageFormat } from "./image-format";

export const MAX_REFERENCE_BYTES = 3_000_000;
const MAX_REFERENCE_EDGE = 1536;

async function dataUrl(blob: Blob, mime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return `data:${mime};base64,${btoa(binary)}`;
}

async function decode(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("기준 이미지를 읽지 못했습니다. 다른 이미지를 선택해 주세요."));
      image.src = url;
    });
    return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

// Prepare a request-sized copy; the project's original asset stays intact.
export async function prepareReferenceImage(blob: Blob): Promise<string> {
  const format = detectImageFormat(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!format || !blob.size || blob.size > 12_000_000) throw new Error("기준 이미지는 12MB 이하 PNG, JPEG, WebP 파일이어야 합니다.");
  let image: Awaited<ReturnType<typeof decode>>;
  try { image = await decode(new Blob([blob], { type: format.mime })); }
  catch { throw new Error("기준 이미지를 읽지 못했습니다. 이미지를 다시 업로드해 주세요."); }
  try {
    if (!image.width || !image.height) throw new Error("기준 이미지의 크기를 확인하지 못했습니다.");
    if (blob.size <= MAX_REFERENCE_BYTES && Math.max(image.width, image.height) <= MAX_REFERENCE_EDGE) return dataUrl(blob, format.mime);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("기준 이미지를 준비하지 못했습니다. 브라우저를 다시 열어 주세요.");
    let scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9 - attempt * 0.1));
      if (result?.size && result.size <= MAX_REFERENCE_BYTES) return dataUrl(result, "image/jpeg");
      scale *= 0.75;
    }
    throw new Error("기준 이미지가 너무 큽니다. 더 작은 이미지를 선택해 주세요.");
  } finally { image.dispose(); }
}
