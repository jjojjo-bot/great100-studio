import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";
import type { ProjectData } from "./types";

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 15;

export interface VideoSegment {
  title: string;
  caption: string;
  imageUrl?: string;
  duration: number;
  ending?: boolean;
}

export function buildVideoPlan(project: ProjectData): VideoSegment[] {
  if (!project.scenes.length) throw new Error("영상으로 만들 Scene이 없습니다.");
  const scenes: VideoSegment[] = [...project.scenes].sort((a, b) => a.number - b.number).map((scene) => {
    const image = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
    if (!image) throw new Error(`Scene ${String(scene.number).padStart(2, "0")}의 이미지를 선택해 주세요.`);
    const duration = scene.duration ?? 10;
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error(`Scene ${scene.number}의 길이는 1~120초여야 합니다.`);
    return { title: scene.title, caption: scene.caption ?? scene.title, imageUrl: image.preview_url, duration };
  });
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0) + (project.ending_message.trim() ? 4 : 0);
  if (total > 900) throw new Error("영상 길이는 15분 이하로 설정해 주세요.");
  if (project.ending_message.trim()) scenes.push({ title: "엔딩", caption: project.ending_message.trim(), duration: 4, ending: true });
  return scenes;
}

function wrapCaption(ctx: CanvasRenderingContext2D, caption: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of caption.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function captionParts(caption: string): string[] {
  const words = caption.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const parts: string[] = [];
  let part = "";
  for (const word of words) {
    const next = part ? `${part} ${word}` : word;
    if (part && next.length > 62) { parts.push(part); part = word; }
    else part = next;
  }
  if (part) parts.push(part);
  return parts;
}

function drawFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, caption: string, progress: number, person: string) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#172b29";
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * (1.02 + progress * 0.045);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const drift = (progress - 0.5) * 18;
    ctx.drawImage(image, (width - drawWidth) / 2 + drift, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#173f39");
    gradient.addColorStop(1, "#a96943");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f4dfbd";
    ctx.textAlign = "center";
    ctx.font = "bold 55px sans-serif";
    ctx.fillText(person, width / 2, height / 2 - 50);
  }

  if (!caption.trim()) return;
  ctx.font = "bold 43px sans-serif";
  const lines = wrapCaption(ctx, caption, width - 130);
  if (!lines.length) return;
  const lineHeight = 58;
  const bandHeight = Math.max(120, lines.length * lineHeight + 52);
  ctx.fillStyle = "rgba(10, 24, 23, 0.79)";
  ctx.fillRect(0, height - bandHeight, width, bandHeight);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  lines.forEach((line, index) => ctx.fillText(line, width / 2, height - bandHeight / 2 + (index - (lines.length - 1) / 2) * lineHeight));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function renderProjectMp4(project: ProjectData, onProgress: (percent: number) => void = () => {}): Promise<Blob> {
  const plan = buildVideoPlan(project);
  if (!(await canEncodeVideo("avc", { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, frameRate: VIDEO_FPS }))) {
    throw new Error("이 브라우저는 MP4 인코딩을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("영상용 캔버스를 만들 수 없습니다.");
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: "avc", quality: new Quality("medium") });
  output.addVideoTrack(source);
  await output.start();
  const frameCounts = plan.map((segment) => Math.max(1, Math.round(segment.duration * VIDEO_FPS)));
  const captions = plan.map((segment) => captionParts(segment.caption));
  const totalFrames = frameCounts.reduce((sum, count) => sum + count, 0);
  let frame = 0;
  for (let segmentIndex = 0; segmentIndex < plan.length; segmentIndex++) {
    const segment = plan[segmentIndex];
    let image: HTMLImageElement | null = null;
    if (segment.imageUrl) {
      try { image = await loadImage(segment.imageUrl); }
      catch { throw new Error(`${segment.title} 이미지를 읽지 못했습니다. 다시 업로드하거나 생성해 주세요.`); }
    }
    for (let localFrame = 0; localFrame < frameCounts[segmentIndex]; localFrame++) {
      const progress = localFrame / frameCounts[segmentIndex];
      const part = captions[segmentIndex][Math.min(captions[segmentIndex].length - 1, Math.floor(progress * captions[segmentIndex].length))];
      drawFrame(ctx, image, part, progress, project.person);
      await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS);
      frame++;
      if (frame % 15 === 0 || frame === totalFrames) {
        onProgress(Math.round((frame / totalFrames) * 100));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  await output.finalize();
  if (!target.buffer) throw new Error("MP4 파일을 완성하지 못했습니다.");
  return new Blob([target.buffer], { type: "video/mp4" });
}
