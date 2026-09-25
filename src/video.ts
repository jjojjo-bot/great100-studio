import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } from "mediabunny";
import { getBackgroundMusic } from "./platform";
import type { ImageMotion, ProjectData } from "./types";

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 15;

export interface VideoSegment {
  title: string;
  caption: string;
  imageUrl?: string;
  duration: number;
  motion: Exclude<ImageMotion, "auto">;
  musicVolume: number;
  ending?: boolean;
}

const AUTO_MOTIONS: VideoSegment["motion"][] = ["zoom-in", "pan-left", "zoom-out", "pan-right", "pan-up", "pan-down"];

export function resolveImageMotion(motion: ImageMotion | undefined, index: number): VideoSegment["motion"] {
  return motion && motion !== "auto" ? motion : AUTO_MOTIONS[index % AUTO_MOTIONS.length];
}

export function sceneMusicVolume(volume: number | undefined): number {
  return volume === undefined ? 45 : Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 45;
}

export function buildVideoPlan(project: ProjectData): VideoSegment[] {
  if (!project.scenes.length) throw new Error("영상으로 만들 Scene이 없습니다.");
  const scenes: VideoSegment[] = [...project.scenes].sort((a, b) => a.number - b.number).map((scene, index) => {
    const image = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
    if (!image) throw new Error(`Scene ${String(scene.number).padStart(2, "0")}의 이미지를 선택해 주세요.`);
    const duration = scene.duration ?? 10;
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error(`Scene ${scene.number}의 길이는 1~120초여야 합니다.`);
    return { title: scene.title, caption: scene.caption ?? scene.title, imageUrl: image.preview_url, duration, motion: resolveImageMotion(scene.motion, index), musicVolume: sceneMusicVolume(scene.music_volume) };
  });
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0) + (project.ending_message.trim() ? 4 : 0);
  if (total > 900) throw new Error("영상 길이는 15분 이하로 설정해 주세요.");
  if (project.ending_message.trim()) scenes.push({ title: "엔딩", caption: project.ending_message.trim(), duration: 4, motion: "none", musicVolume: scenes.at(-1)?.musicVolume ?? 45, ending: true });
  return scenes;
}

type MusicSection = Pick<VideoSegment, "duration" | "musicVolume">;
type MusicInterval = { start: number; end: number; volume: number; nextVolume?: number };

function musicTimeline(sections: MusicSection[]): MusicInterval[] {
  let start = 0;
  return sections.map((section, index) => {
    const interval = { start, end: start + section.duration, volume: section.musicVolume / 100, nextVolume: sections[index + 1]?.musicVolume === undefined ? undefined : sections[index + 1].musicVolume / 100 };
    start = interval.end;
    return interval;
  });
}

function gainAtTime(timeline: MusicInterval[], time: number): number {
  const total = timeline.at(-1)?.end ?? 0;
  if (time < 0 || time >= total) return 0;
  let low = 0;
  let high = timeline.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (time < timeline[middle].end) high = middle;
    else low = middle + 1;
  }
  const current = timeline[low];
  const blend = current.nextVolume === undefined || time <= current.end - 0.2
    ? current.volume
    : current.volume + (current.nextVolume - current.volume) * ((time - (current.end - 0.2)) / 0.2);
  return blend * Math.min(1, time / 0.5, (total - time) / 1.5);
}

export function musicGainAtTime(sections: MusicSection[], time: number): number {
  return gainAtTime(musicTimeline(sections), time);
}

function makeMusicChunk(context: AudioContext, music: AudioBuffer, timeline: MusicInterval[], startSample: number, sampleCount: number): AudioBuffer {
  const channelCount = Math.min(2, music.numberOfChannels);
  const chunk = context.createBuffer(channelCount, sampleCount, music.sampleRate);
  const sources = Array.from({ length: channelCount }, (_, channel) => music.getChannelData(channel));
  const targets = Array.from({ length: channelCount }, (_, channel) => chunk.getChannelData(channel));
  for (let index = 0; index < sampleCount; index++) {
    const gain = gainAtTime(timeline, (startSample + index) / music.sampleRate);
    const loopIndex = (startSample + index) % music.length;
    for (let channel = 0; channel < channelCount; channel++) targets[channel][index] = sources[channel][loopIndex] * gain;
  }
  return chunk;
}

export function imagePlacement(imageWidth: number, imageHeight: number, frameWidth: number, frameHeight: number, motion: VideoSegment["motion"], progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  const cover = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  const zoom = motion === "zoom-in" ? 1.03 + eased * 0.1 : motion === "zoom-out" ? 1.13 - eased * 0.1 : motion === "none" ? 1 : 1.12;
  const width = imageWidth * cover * zoom;
  const height = imageHeight * cover * zoom;
  const maxX = (width - frameWidth) / 2;
  const maxY = (height - frameHeight) / 2;
  const travel = 1 - 2 * eased;
  const shiftX = Math.min(maxX * 0.9, frameWidth * 0.08) * travel;
  const shiftY = Math.min(maxY * 0.9, frameHeight * 0.08) * travel;
  const x = (frameWidth - width) / 2 + (motion === "pan-left" ? shiftX : motion === "pan-right" ? -shiftX : 0);
  const y = (frameHeight - height) / 2 + (motion === "pan-up" ? shiftY : motion === "pan-down" ? -shiftY : 0);
  return { x, y, width, height };
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

function drawFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, caption: string, progress: number, person: string, motion: VideoSegment["motion"]) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#172b29";
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const placement = imagePlacement(image.naturalWidth, image.naturalHeight, width, height, motion, progress);
    ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
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
  const frameCounts = plan.map((segment) => Math.max(1, Math.round(segment.duration * VIDEO_FPS)));
  const captions = plan.map((segment) => captionParts(segment.caption));
  const totalFrames = frameCounts.reduce((sum, count) => sum + count, 0);
  const timeline = musicTimeline(plan);
  let audioContext: AudioContext | null = null;
  let audioSource: AudioBufferSource | null = null;
  let decodedMusic: AudioBuffer | null = null;
  if (project.background_music) {
    const musicBlob = await getBackgroundMusic(project);
    if (!musicBlob) throw new Error("배경음악 파일을 찾지 못했습니다. 다시 업로드해 주세요.");
    audioContext = new AudioContext();
    try { decodedMusic = await audioContext.decodeAudioData(await musicBlob.arrayBuffer()); }
    catch { await audioContext.close(); throw new Error("배경음악을 읽지 못했습니다. 다른 파일로 다시 업로드해 주세요."); }
    if (!decodedMusic.length || !(await canEncodeAudio("aac", { numberOfChannels: Math.min(2, decodedMusic.numberOfChannels), sampleRate: decodedMusic.sampleRate }))) {
      await audioContext.close();
      throw new Error("이 브라우저는 음악이 포함된 MP4 인코딩을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.");
    }
    audioSource = new AudioBufferSource({ codec: "aac", quality: new Quality("medium") });
    output.addAudioTrack(audioSource);
  }
  try {
    await output.start();
    let audioSample = 0;
    const feedAudioUntil = async (seconds: number) => {
      if (!audioContext || !audioSource || !decodedMusic) return;
      const target = Math.min(Math.round((totalFrames / VIDEO_FPS) * decodedMusic.sampleRate), Math.round(seconds * decodedMusic.sampleRate));
      const chunkSize = Math.max(1, Math.round(decodedMusic.sampleRate / 2));
      while (audioSample < target) {
        const count = Math.min(chunkSize, target - audioSample);
        await audioSource.add(makeMusicChunk(audioContext, decodedMusic, timeline, audioSample, count));
        audioSample += count;
      }
    };
    await feedAudioUntil(0.5);
    let frame = 0;
    for (let segmentIndex = 0; segmentIndex < plan.length; segmentIndex++) {
      const segment = plan[segmentIndex];
      let image: HTMLImageElement | null = null;
      if (segment.imageUrl) {
        try { image = await loadImage(segment.imageUrl); }
        catch { throw new Error(`${segment.title} 이미지를 읽지 못했습니다. 다시 업로드하거나 생성해 주세요.`); }
      }
      for (let localFrame = 0; localFrame < frameCounts[segmentIndex]; localFrame++) {
        const progress = frameCounts[segmentIndex] === 1 ? 0 : localFrame / (frameCounts[segmentIndex] - 1);
        const part = captions[segmentIndex][Math.min(captions[segmentIndex].length - 1, Math.floor(progress * captions[segmentIndex].length))];
        drawFrame(ctx, image, part, progress, project.person, segment.motion);
        await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS);
        frame++;
        if (frame % 7 === 0 || frame === totalFrames) await feedAudioUntil(Math.min(totalFrames / VIDEO_FPS, frame / VIDEO_FPS + 0.5));
        if (frame % 15 === 0 || frame === totalFrames) {
          onProgress(Math.round((frame / totalFrames) * 100));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    await feedAudioUntil(totalFrames / VIDEO_FPS);
    audioSource?.close();
    await output.finalize();
    if (!target.buffer) throw new Error("MP4 파일을 완성하지 못했습니다.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  } finally {
    if (audioContext) await audioContext.close();
  }
}
