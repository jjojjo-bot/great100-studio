import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { MAX_MUSIC_SECONDS } from "./music-limits";

async function openMpeg4Audio(blob: Blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("MPEG-4 파일에 오디오 트랙이 없습니다.");
    if (!(await track.canDecode())) throw new Error("이 브라우저에서 MPEG-4 오디오를 읽을 수 없습니다. AAC 오디오가 포함된 MP4를 사용해 주세요.");
    const duration = await input.computeDuration([track]);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MUSIC_SECONDS) {
      throw new Error("배경음악은 15분 이하 파일만 사용할 수 있습니다.");
    }
    return { input, track, duration };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export async function inspectMpeg4Audio(blob: Blob): Promise<number> {
  const { input, duration } = await openMpeg4Audio(blob);
  input.dispose();
  return duration;
}

export async function decodeMpeg4Audio(blob: Blob, context: AudioContext): Promise<AudioBuffer> {
  const { input, track, duration } = await openMpeg4Audio(blob);
  try {
    const sampleRate = await track.getSampleRate();
    const channels = Math.min(2, await track.getNumberOfChannels());
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channels < 1) throw new Error("MPEG-4 오디오 형식을 읽을 수 없습니다.");
    const result = context.createBuffer(channels, Math.ceil(duration * sampleRate) + 1024, sampleRate);
    let firstTimestamp: number | undefined;
    let written = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      firstTimestamp ??= timestamp;
      const offset = Math.max(0, Math.round((timestamp - firstTimestamp) * sampleRate));
      const count = Math.min(buffer.length, result.length - offset);
      if (count <= 0) break;
      for (let channel = 0; channel < channels; channel++) {
        result.copyToChannel(buffer.getChannelData(channel).subarray(0, count), channel, offset);
      }
      written = Math.max(written, offset + count);
    }
    if (!written) throw new Error("MPEG-4 파일에서 음악을 읽지 못했습니다.");
    return result;
  } finally {
    input.dispose();
  }
}
