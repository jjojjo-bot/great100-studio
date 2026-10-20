import { narrationTimeline } from "./narration-timeline";
import { sceneComposition } from "./media-composition";
import type { ProjectData, Scene } from "./types";

export function hasSceneNarration(scene: Scene): boolean {
  return sceneComposition(scene).narrations.length > 0;
}

// Scene previews and ZIP aliases include silence before a cropped voice. The
// immutable source file stays in the media registry and is used by MP4 export.
export async function sceneNarrationWav(project: ProjectData, scene: Scene, read: (id: string) => Promise<Blob | null>): Promise<Blob | null> {
  const clips = narrationTimeline(project, scene.id);
  if (!clips.length) return null;
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const buffers = new Map<string, AudioBuffer>();
    for (const clip of clips) {
      if (buffers.has(clip.asset_id)) continue;
      const blob = await read(clip.asset_id);
      if (!blob) throw new Error("저장된 녹음 원본을 찾지 못했습니다.");
      const audio = /(?:audio|video)\/mp4/.test(blob.type)
        ? await (await import("./music")).decodeMpeg4Audio(blob, context)
        : await context.decodeAudioData(await blob.arrayBuffer());
      buffers.set(clip.asset_id, audio);
    }
    const rate = 48000; const frames = Math.ceil((scene.duration ?? 10) * rate);
    const channelCount = Math.max(...[...buffers.values()].map(audio => Math.min(2, audio.numberOfChannels)));
    const blockSize = channelCount * 2;
    const data = new ArrayBuffer(44 + frames * blockSize); const view = new DataView(data);
    const tag = (at: number, value: string) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)));
    tag(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channelCount, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * blockSize, true); view.setUint16(32, blockSize, true); view.setUint16(34, 16, true);
    tag(36, "data"); view.setUint32(40, frames * blockSize, true);
    for (const clip of clips) {
      const audio = buffers.get(clip.asset_id)!;
      if (clip.source_end_sec > audio.duration + 0.15) throw new Error("녹음 원본보다 재생 구간이 깁니다.");
      const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
      for (let frame = Math.max(0, Math.ceil(clip.start_sec * rate)); frame < Math.min(frames, Math.ceil(clip.end_sec * rate)); frame++) {
        const source = Math.floor((clip.source_start_sec + frame / rate - clip.start_sec) * audio.sampleRate);
        for (let channel = 0; channel < channelCount; channel++) {
          const sample = channels[Math.min(channel, channels.length - 1)][source] || 0;
          view.setInt16(44 + (frame * channelCount + channel) * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
        }
      }
    }
    return new Blob([data], { type: "audio/wav" });
  } finally { await context.close(); }
}
