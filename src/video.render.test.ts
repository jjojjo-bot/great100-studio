import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";

const calls = vi.hoisted(() => ({ audioBuffers: [] as Float32Array[], audioTracks: 0, videoFrames: 0 }));

vi.mock("./platform", () => ({ getBackgroundMusic: async () => new Blob(["music"]) }));
vi.mock("mediabunny", () => ({
  BufferTarget: class { buffer: Uint8Array | null = null; },
  CanvasSource: class { add = async () => { calls.videoFrames++; }; },
  AudioBufferSource: class {
    add = async (buffer: { getChannelData: (channel: number) => Float32Array }) => { calls.audioBuffers.push(buffer.getChannelData(0)); };
    close = () => {};
  },
  Mp4OutputFormat: class {},
  Output: class {
    state = "pending";
    constructor(private options: { target: { buffer: Uint8Array | null } }) {}
    addVideoTrack = () => {};
    addAudioTrack = () => { calls.audioTracks++; };
    start = async () => { this.state = "started"; };
    finalize = async () => { this.options.target.buffer = new Uint8Array([1, 2, 3]); this.state = "finalized"; };
    cancel = async () => { this.state = "canceled"; };
  },
  Quality: class {},
  canEncodeAudio: async () => true,
  canEncodeVideo: async () => true,
}));

import { renderProjectMp4 } from "./video";

describe("MP4 background music rendering", () => {
  it("adds an audio track and applies per-scene volume to repeated samples", async () => {
    calls.audioBuffers.length = 0;
    calls.audioTracks = 0;
    calls.videoFrames = 0;
    const context = {
      decodeAudioData: async () => ({ length: 5, sampleRate: 10, numberOfChannels: 1, getChannelData: () => new Float32Array([1, 1, 1, 1, 1]) }),
      createBuffer: (_channels: number, length: number) => {
        const samples = new Float32Array(length);
        return { getChannelData: () => samples };
      },
      close: async () => {},
    };
    vi.stubGlobal("AudioContext", class { constructor() { return context; } });
    vi.stubGlobal("Image", class {
      naturalWidth = 1920;
      naturalHeight = 1080;
      src = "";
      decode = async () => {};
    });
    const canvas = { width: 0, height: 0, getContext: () => ({
      canvas,
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      fillRect: () => {},
      drawImage: () => {},
      fillText: () => {},
      measureText: (text: string) => ({ width: text.length * 10 }),
    }) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 1;
    project.scenes[0].music_volume = 50;
    project.scenes[0].candidates = [{ id: "one", path: "image.png", preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "one";
    project.ending_message = "";
    project.background_music = { name: "music.mp3", mime_type: "audio/mpeg", path: "projects/002_이순신/01_source/background_music.mp3" };
    const result = await renderProjectMp4(project);
    expect(result.type).toBe("video/mp4");
    expect(calls.audioTracks).toBe(1);
    expect(calls.videoFrames).toBe(15);
    expect(calls.audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0)).toBe(10);
    expect(calls.audioBuffers.some((buffer) => buffer.some((sample) => sample > 0))).toBe(true);
  });
});

afterEach(() => vi.unstubAllGlobals());
