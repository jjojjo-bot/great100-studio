import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hasTrack: true, disposed: 0 }));

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    getPrimaryAudioTrack = async () => state.hasTrack ? {
      canDecode: async () => true,
      getSampleRate: async () => 4,
      getNumberOfChannels: async () => 1,
    } : null;
    computeDuration = async () => 1;
    dispose = () => { state.disposed++; };
  },
  AudioBufferSink: class {
    async *buffers() {
      yield { timestamp: 0, buffer: { length: 2, getChannelData: () => new Float32Array([1, 2]) } };
      yield { timestamp: 0.5, buffer: { length: 2, getChannelData: () => new Float32Array([3, 4]) } };
    }
  },
}));

import { decodeMpeg4Audio, inspectMpeg4Audio } from "./music";

beforeEach(() => { state.hasTrack = true; state.disposed = 0; });

describe("MPEG-4 background music", () => {
  it("selects and decodes only the audio track", async () => {
    const file = new Blob(["mp4"], { type: "video/mp4" });
    expect(await inspectMpeg4Audio(file)).toBe(1);
    const samples = new Float32Array(1028);
    const context = { createBuffer: () => ({
      length: samples.length,
      copyToChannel: (source: Float32Array, _channel: number, offset: number) => samples.set(source, offset),
    }) } as unknown as AudioContext;
    await decodeMpeg4Audio(file, context);
    expect(Array.from(samples.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(state.disposed).toBe(2);
  });

  it("rejects an MPEG-4 file without audio", async () => {
    state.hasTrack = false;
    await expect(inspectMpeg4Audio(new Blob(["mp4"]))).rejects.toThrow("오디오 트랙이 없습니다");
    expect(state.disposed).toBe(1);
  });
});
