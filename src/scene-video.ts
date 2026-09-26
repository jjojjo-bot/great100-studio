import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

export const MAX_SCENE_VIDEO_SECONDS = 10;
export const MAX_SCENE_VIDEO_BYTES = 50_000_000;

export function validateSceneVideoFile(file: Pick<File, "name" | "type" | "size">, header: Uint8Array): void {
  if (!file.name.toLowerCase().endsWith(".mp4") || (file.type && file.type !== "video/mp4")) {
    throw new Error("MP4 동영상 파일만 업로드할 수 있습니다.");
  }
  if (!file.size || file.size > MAX_SCENE_VIDEO_BYTES) throw new Error("동영상은 50MB 이하 파일만 업로드할 수 있습니다.");
  if (header.length < 12 || String.fromCharCode(...header.slice(4, 8)) !== "ftyp") throw new Error("올바른 MP4 파일이 아닙니다.");
}

export async function openSceneVideo(blob: Blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error("이 브라우저에서 재생할 수 있는 MP4 영상 트랙이 없습니다.");
    const firstTimestamp = await track.getFirstTimestamp();
    const endTimestamp = await track.computeDuration();
    const duration = endTimestamp - firstTimestamp;
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SCENE_VIDEO_SECONDS) {
      throw new Error("MP4 동영상은 10초 이하여야 합니다.");
    }
    return { input, sink: new CanvasSink(track), firstTimestamp, duration };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export async function inspectSceneVideo(blob: Blob): Promise<{ duration: number; poster: string }> {
  const video = await openSceneVideo(blob);
  try {
    const first = await video.sink.getCanvas(video.firstTimestamp);
    if (!first) throw new Error("MP4 동영상의 첫 화면을 읽지 못했습니다.");
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = Math.max(1, Math.round(640 * first.canvas.height / first.canvas.width));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("동영상 미리보기를 만들 수 없습니다.");
    context.drawImage(first.canvas, 0, 0, canvas.width, canvas.height);
    return { duration: video.duration, poster: canvas.toDataURL("image/jpeg", 0.8) };
  } finally {
    video.input.dispose();
  }
}
