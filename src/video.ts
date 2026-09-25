import { getBackgroundMusic, getSceneNarration } from "./platform";
import { reportForProject } from "./app-data";
import type { CaptionBlock, ImageMotion, ProjectData } from "./types";

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 15;
export const OPENING_DURATION = 3;

export interface VideoSegment {
  title: string;
  sceneId?: string;
  caption: string;
  timedCaptions?: CaptionBlock[];
  emphasisSubtitle?: string;
  imageUrl?: string;
  supportImageUrl?: string;
  supportStartsAt?: number;
  duration: number;
  motion: Exclude<ImageMotion, "auto">;
  motionStart?: number;
  motionEnd?: number;
  musicVolume: number;
  opening?: boolean;
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
  if (project.schema_version === "2.1") {
    const errors = reportForProject(project).errors;
    if (errors.length) throw new Error(errors[0]);
  }
  const scenes: VideoSegment[] = [...project.scenes].sort((a, b) => a.number - b.number).map((scene, index) => {
    const image = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
    if (!image) throw new Error(`Scene ${String(scene.number).padStart(2, "0")}의 이미지를 선택해 주세요.`);
    const support = scene.support_candidates?.find((candidate) => candidate.id === scene.support_selected_candidate_id);
    if (scene.support_selected_candidate_id && !support) throw new Error(`Scene ${String(scene.number).padStart(2, "0")}의 선택한 보조 이미지를 찾지 못했습니다.`);
    const duration = scene.duration ?? 10;
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error(`Scene ${scene.number}의 길이는 1~120초여야 합니다.`);
    return { title: scene.title, sceneId: scene.id, caption: project.schema_version === "2.1" ? scene.narration || "" : scene.caption ?? scene.title,
      timedCaptions: project.schema_version === "2.1" ? scene.captions?.map((block) => ({ ...block, start_sec: block.start_sec - (scene.start_sec || 0), end_sec: block.end_sec - (scene.start_sec || 0) })) : undefined,
      emphasisSubtitle: project.schema_version === "2.1" ? scene.subtitle : undefined,
      imageUrl: image.preview_url, supportImageUrl: support?.preview_url, supportStartsAt: support ? duration / 2 : undefined,
      duration, motion: resolveImageMotion(scene.motion, index), musicVolume: sceneMusicVolume(scene.music_volume) };
  });
  const thumbnail = project.thumbnail.candidates.find((candidate) => candidate.id === project.thumbnail.selected_candidate_id);
  if (project.thumbnail.selected_candidate_id && !thumbnail) throw new Error("선택한 썸네일 이미지를 찾지 못했습니다.");
  const hasEnding = !!project.ending_message.trim() || !!thumbnail;
  const total = OPENING_DURATION + scenes.reduce((sum, scene) => sum + scene.duration, 0) + (hasEnding ? 4 : 0);
  if (total > 900) throw new Error("영상 길이는 15분 이하로 설정해 주세요.");
  const openingShare = OPENING_DURATION / (OPENING_DURATION + scenes[0].duration);
  scenes[0].motionStart = openingShare;
  const opening: VideoSegment = { title: "오프닝", caption: "", imageUrl: scenes[0].imageUrl, duration: OPENING_DURATION,
    motion: scenes[0].motion, motionEnd: openingShare, musicVolume: scenes[0].musicVolume, opening: true };
  if (hasEnding) scenes.push({ title: "엔딩", caption: project.ending_message.trim(), imageUrl: thumbnail?.preview_url, duration: 4, motion: "none", musicVolume: scenes.at(-1)?.musicVolume ?? 45, ending: true });
  return [opening, ...scenes];
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

type DecodedAudio = { sampleRate: number; duration: number; channels: Float32Array[] };
type NarrationClip = { start: number; end: number; audio: DecodedAudio };

function decodedAudio(buffer: AudioBuffer): DecodedAudio {
  return { sampleRate: buffer.sampleRate, duration: buffer.duration || buffer.length / buffer.sampleRate,
    channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) => buffer.getChannelData(channel)) };
}

function audioSample(audio: DecodedAudio, channel: number, seconds: number, loop = false): number {
  const samples = audio.channels[Math.min(channel, audio.channels.length - 1)];
  if (!samples?.length) return 0;
  const position = seconds * audio.sampleRate;
  const index = Math.floor(position);
  const left = loop ? ((index % samples.length) + samples.length) % samples.length : index;
  if (!loop && (left < 0 || left >= samples.length)) return 0;
  const right = loop ? (left + 1) % samples.length : Math.min(left + 1, samples.length - 1);
  return samples[left] + (samples[right] - samples[left]) * (position - index);
}

function makeAudioChunk(context: AudioContext, music: DecodedAudio | null, narrations: NarrationClip[], timeline: MusicInterval[], startSample: number, sampleCount: number, sampleRate: number, channelCount: number): AudioBuffer {
  const chunk = context.createBuffer(channelCount, sampleCount, sampleRate);
  const targets = Array.from({ length: channelCount }, (_, channel) => chunk.getChannelData(channel));
  let narrationIndex = narrations.findIndex((clip) => clip.end > startSample / sampleRate);
  if (narrationIndex < 0) narrationIndex = narrations.length;
  for (let index = 0; index < sampleCount; index++) {
    const time = (startSample + index) / sampleRate;
    while (narrationIndex < narrations.length && time >= narrations[narrationIndex].end) narrationIndex++;
    const clip = narrations[narrationIndex];
    const voiceTime = clip ? time - clip.start : -1;
    const voiceDuration = clip ? Math.min(clip.audio.duration, clip.end - clip.start) : 0;
    const voiceActive = clip && voiceTime >= 0 && voiceTime < voiceDuration;
    const voiceFade = voiceActive ? Math.min(1, voiceTime / 0.04, (voiceDuration - voiceTime) / 0.04) : 0;
    const duck = voiceActive ? Math.min(1, voiceTime / 0.18, (voiceDuration - voiceTime) / 0.18) : 0;
    const musicGain = music ? gainAtTime(timeline, time) * (1 - 0.78 * duck) : 0;
    for (let channel = 0; channel < channelCount; channel++) {
      const background = music ? audioSample(music, channel, time, true) * musicGain : 0;
      const voice = voiceActive ? audioSample(clip.audio, channel, voiceTime) * voiceFade : 0;
      targets[channel][index] = Math.max(-1, Math.min(1, background + voice));
    }
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

export function activeTimedCaption(blocks: CaptionBlock[], seconds: number): string {
  return blocks.find((block) => seconds >= block.start_sec && seconds < block.end_sec)?.text || "";
}

function drawFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, caption: string, progress: number, person: string, motion: VideoSegment["motion"], emphasis = "", emphasisAge = 0, supportImage: HTMLImageElement | null = null, supportOpacity = 0, supportProgress = 0, openingOpacity = 0, ending = false, captionOpacity = 1) {
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
  }

  if (supportImage && supportOpacity > 0) {
    const placement = imagePlacement(supportImage.naturalWidth, supportImage.naturalHeight, width, height, motion, supportProgress);
    ctx.globalAlpha = supportOpacity;
    ctx.drawImage(supportImage, placement.x, placement.y, placement.width, placement.height);
    ctx.globalAlpha = 1;
  }

  if (openingOpacity > 0) {
    ctx.globalAlpha = openingOpacity;
    ctx.fillStyle = "rgba(18, 41, 36, 0.53)";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(13, 32, 27, 0.8)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#f4dfbd";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("오늘의 인물", width / 2, height / 2 - 70);
    ctx.font = "bold 76px sans-serif";
    ctx.fillText(person, width / 2, height / 2 + 30, width - 160);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  if (ending) {
    if (image) { ctx.fillStyle = "rgba(18, 41, 36, 0.27)"; ctx.fillRect(0, 0, width, height); }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 55px sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(22, 43, 37, 0.9)";
    ctx.shadowColor = "rgba(13, 32, 27, 0.8)";
    ctx.shadowBlur = 16;
    ctx.strokeText?.(person, width / 2, height / 2 - 50, width - 160);
    ctx.fillStyle = "#f4dfbd";
    ctx.fillText(person, width / 2, height / 2 - 50, width - 160);
    ctx.shadowBlur = 0;
  }

  if (emphasis.trim()) {
    let size = 50;
    let lines: string[] = [];
    do {
      ctx.font = `bold ${size}px sans-serif`;
      lines = wrapCaption(ctx, emphasis, width * 0.63);
      if (lines.length <= 2 || size <= 30) break;
      size -= 3;
    } while (true);
    if (lines.length > 2) lines = [lines[0], lines.slice(1).join(" ")];
    const opacity = Math.max(0, Math.min(1, emphasisAge / 0.3, (3 - emphasisAge) / 0.45));
    ctx.globalAlpha = opacity;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(31, 48, 42, 0.88)";
    ctx.shadowColor = "rgba(20, 35, 31, 0.68)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 3;
    const top = 90 + (1 - opacity) * 8;
    lines.forEach((line, index) => {
      const y = top + index * (size + 12);
      ctx.strokeText?.(line, 100, y, width * 0.7);
      ctx.fillStyle = "#ffe7aa";
      ctx.fillText(line, 100, y, width * 0.7);
    });
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
  }
  if (!caption.trim()) return;
  let fontSize = 43;
  let lines: string[] = [];
  do {
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = wrapCaption(ctx, caption, width - 130);
    if (lines.length <= 2 || fontSize <= 24) break;
    fontSize -= 3;
  } while (true);
  if (!lines.length) return;
  if (lines.length > 2) lines = [lines[0], lines.slice(1).join(" ")];
  const lineHeight = fontSize + 15;
  ctx.globalAlpha = captionOpacity;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(17, 36, 32, 0.9)";
  ctx.shadowColor = "rgba(12, 28, 26, 0.8)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  lines.forEach((line, index) => {
    const y = height - 62 - (lines.length - 1 - index) * lineHeight;
    ctx.strokeText?.(line, width / 2, y, width - 130);
    ctx.fillStyle = "#fff9ed";
    ctx.fillText(line, width / 2, y, width - 130);
  });
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha = 1;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function renderProjectMp4(project: ProjectData, onProgress: (percent: number) => void = () => {}): Promise<Blob> {
  const plan = buildVideoPlan(project);
  const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } = await import("mediabunny");
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
  let audioSource: import("mediabunny").AudioBufferSource | null = null;
  let music: DecodedAudio | null = null;
  const narrations: NarrationClip[] = [];
  let audioSampleRate = 0;
  let audioChannels = 0;
  if (project.background_music || project.scenes.some((scene) => scene.narration_audio)) {
    audioContext = new AudioContext();
    try {
      if (project.background_music) {
        const musicBlob = await getBackgroundMusic(project);
        if (!musicBlob) throw new Error("배경음악 파일을 찾지 못했습니다. 다시 업로드해 주세요.");
        const buffer = project.background_music.mime_type === "video/mp4"
          ? await (await import("./music")).decodeMpeg4Audio(musicBlob, audioContext)
          : await audioContext.decodeAudioData(await musicBlob.arrayBuffer());
        music = decodedAudio(buffer);
      }
      let start = 0;
      for (const segment of plan) {
        const scene = segment.sceneId ? project.scenes.find((item) => item.id === segment.sceneId) : undefined;
        if (scene?.narration_audio) {
          const blob = await getSceneNarration(project, scene);
          if (!blob) throw new Error(`Scene ${scene.number} 녹음 파일을 찾지 못했습니다. 다시 녹음하거나 업로드해 주세요.`);
          const buffer = ["audio/mp4", "video/mp4"].includes(scene.narration_audio.mime_type)
            ? await (await import("./music")).decodeMpeg4Audio(blob, audioContext)
            : await audioContext.decodeAudioData(await blob.arrayBuffer());
          const audio = decodedAudio(buffer);
          if (audio.duration > segment.duration + 0.15) throw new Error(`Scene ${scene.number} 녹음이 장면 길이보다 깁니다. 다시 녹음해 주세요.`);
          narrations.push({ start, end: start + segment.duration, audio });
        }
        start += segment.duration;
      }
    }
    catch (error) { await audioContext.close(); throw error; }
    audioSampleRate = audioContext.sampleRate || music?.sampleRate || narrations[0]?.audio.sampleRate || 48_000;
    audioChannels = Math.max(music?.channels.length || 0, ...narrations.map((clip) => clip.audio.channels.length));
    if (!audioChannels || !(await canEncodeAudio("aac", { numberOfChannels: audioChannels, sampleRate: audioSampleRate }))) {
      await audioContext.close();
      throw new Error("이 브라우저는 오디오가 포함된 MP4 인코딩을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.");
    }
    audioSource = new AudioBufferSource({ codec: "aac", quality: new Quality("medium") });
    output.addAudioTrack(audioSource);
  }
  try {
    await output.start();
    let audioSample = 0;
    const feedAudioUntil = async (seconds: number) => {
      if (!audioContext || !audioSource) return;
      const target = Math.min(Math.round((totalFrames / VIDEO_FPS) * audioSampleRate), Math.round(seconds * audioSampleRate));
      const chunkSize = Math.max(1, Math.round(audioSampleRate / 2));
      while (audioSample < target) {
        const count = Math.min(chunkSize, target - audioSample);
        await audioSource.add(makeAudioChunk(audioContext, music, narrations, timeline, audioSample, count, audioSampleRate, audioChannels));
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
      let supportImage: HTMLImageElement | null = null;
      if (segment.supportImageUrl) {
        try { supportImage = await loadImage(segment.supportImageUrl); }
        catch { throw new Error(`${segment.title} 보조 이미지를 읽지 못했습니다. 다시 업로드하거나 선택해 주세요.`); }
      }
      for (let localFrame = 0; localFrame < frameCounts[segmentIndex]; localFrame++) {
        const progress = frameCounts[segmentIndex] === 1 ? 0 : localFrame / (frameCounts[segmentIndex] - 1);
        const seconds = localFrame / VIDEO_FPS;
        const part = segment.timedCaptions ? activeTimedCaption(segment.timedCaptions, seconds) : captions[segmentIndex][Math.min(captions[segmentIndex].length - 1, Math.floor(progress * captions[segmentIndex].length))];
        const supportStart = segment.supportStartsAt ?? Infinity;
        const fadeDuration = Math.min(0.6, segment.duration / 8);
        const supportOpacity = supportImage ? Math.max(0, Math.min(1, (seconds - supportStart) / fadeDuration)) : 0;
        const supportProgress = supportImage ? Math.max(0, Math.min(1, (seconds - supportStart) / Math.max(0.01, segment.duration - supportStart))) : 0;
        const motionProgress = (segment.motionStart ?? 0) + progress * ((segment.motionEnd ?? 1) - (segment.motionStart ?? 0));
        const openingOpacity = segment.opening ? Math.min(1, (1 - progress) * segment.duration / 0.8) : 0;
        const captionOpacity = segmentIndex === 1 ? Math.min(1, seconds / 0.5) : 1;
        drawFrame(ctx, image, part, motionProgress, project.person, segment.motion, segment.emphasisSubtitle && seconds < 3 ? segment.emphasisSubtitle : "", seconds, supportImage, supportOpacity, supportProgress, openingOpacity, !!segment.ending, captionOpacity);
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
