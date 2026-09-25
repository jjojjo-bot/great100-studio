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
    expect(calls.videoFrames).toBe(60);
    expect(calls.audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0)).toBe(40);
    expect(calls.audioBuffers.some((buffer) => buffer.some((sample) => sample > 0))).toBe(true);
  });

  it("v2.1 MP4는 강조 문구와 시간별 전체 자막을 별도로 그린다", async () => {
    const drawn: string[] = [];
    const rectangles: Array<[number, number, number, number]> = [];
    vi.stubGlobal("Image", class { naturalWidth = 1920; naturalHeight = 1080; src = ""; decode = async () => {}; });
    const canvas = { width: 0, height: 0, getContext: () => ({
      canvas, fillStyle: "", font: "", textAlign: "", textBaseline: "",
      fillRect: (x: number, y: number, width: number, height: number) => { rectangles.push([x, y, width, height]); }, drawImage: () => {}, fillText: (text: string) => { drawn.push(text); },
      measureText: (text: string) => ({ width: text.length * 10 }),
    }) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.schema_version = "2.1";
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 1;
    project.scenes[0].start_sec = 0;
    project.scenes[0].end_sec = 1;
    project.scenes[0].narration = "앞문장 뒷문장";
    project.scenes[0].subtitle = "강조 문구";
    project.scenes[0].captions = [
      { text: "앞문장", start_sec: 0, end_sec: 0.5 },
      { text: "뒷문장", start_sec: 0.5, end_sec: 1 },
    ];
    project.scenes[0].candidates = [{ id: "one", path: "image.png", preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "one";
    project.ending_message = "";
    await renderProjectMp4(project);
    expect(drawn).toContain("오늘의 인물");
    expect(drawn).toContain("이순신");
    expect(drawn).toContain("강조 문구");
    expect(drawn).toContain("앞문장");
    expect(drawn).toContain("뒷문장");
    expect(drawn).not.toContain(project.scenes[0].caption);
    expect(rectangles.every(([, , width, height]) => width === 1280 && height === 720)).toBe(true);
    drawn.length = 0;
    project.scenes[0].subtitle = "";
    await renderProjectMp4(project);
    expect(drawn).not.toContain("강조 문구");
    expect(drawn).toContain("앞문장");
    expect(drawn).toContain("뒷문장");
  });

  it("선택한 보조 이미지와 썸네일을 실제 MP4 프레임에 그린다", async () => {
    const images: string[] = [];
    const text: string[] = [];
    vi.stubGlobal("Image", class { naturalWidth = 1920; naturalHeight = 1080; src = ""; decode = async () => {}; });
    const canvas = { width: 0, height: 0, getContext: () => ({
      canvas, fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
      fillRect: () => {}, drawImage: (image: { src: string }) => { images.push(image.src); },
      fillText: (value: string) => { text.push(value); }, measureText: (value: string) => ({ width: value.length * 10 }),
    }) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 2;
    project.scenes[0].candidates = [{ id: "main", path: "main.png", preview_url: "main-url", created_at: "now", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "main";
    project.scenes[0].support_candidates = [{ id: "support", path: "support.png", preview_url: "support-url", created_at: "now", mode: "uploaded" }];
    project.scenes[0].support_selected_candidate_id = "support";
    project.thumbnail.candidates = [{ id: "thumb", path: "thumb.png", preview_url: "thumbnail-url", created_at: "now", mode: "uploaded" }];
    project.thumbnail.selected_candidate_id = "thumb";
    project.ending_message = "고맙습니다";
    await renderProjectMp4(project);
    expect(images).toContain("main-url");
    expect(images).toContain("support-url");
    expect(images).toContain("thumbnail-url");
    expect(text).toContain("이순신");
  });
});

afterEach(() => vi.unstubAllGlobals());
