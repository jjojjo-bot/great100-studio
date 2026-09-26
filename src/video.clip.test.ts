import { describe, expect, it, vi } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";

const calls = vi.hoisted(() => ({ timestamps: [] as number[], decodedDraws: 0, introDraws: 0, frames: 0, disposed: 0 }));

vi.mock("./platform", () => ({
  getBackgroundMusic: async () => null,
  getSceneNarration: async () => null,
  getSceneVideo: async () => new Blob(["clip"], { type: "video/mp4" }),
}));
vi.mock("./scene-video", () => ({
  openSceneVideo: async () => ({
    firstTimestamp: 0,
    duration: 1,
    input: { dispose: () => { calls.disposed++; } },
    sink: { canvasesAtTimestamps: async function* (timestamps: number[]) {
      calls.timestamps = timestamps;
      for (const timestamp of timestamps) yield { canvas: { width: 320, height: 180, timestamp } };
    } },
  }),
}));
vi.mock("mediabunny", () => ({
  BufferTarget: class { buffer: Uint8Array | null = null; },
  CanvasSource: class { add = async () => { calls.frames++; }; },
  AudioBufferSource: class {},
  Mp4OutputFormat: class {},
  Output: class {
    state = "pending";
    constructor(private options: { target: { buffer: Uint8Array | null } }) {}
    addVideoTrack = () => {};
    start = async () => { this.state = "started"; };
    finalize = async () => { this.options.target.buffer = new Uint8Array([1]); this.state = "finalized"; };
    cancel = async () => { this.state = "canceled"; };
  },
  Quality: class {},
  canEncodeVideo: async () => true,
  canEncodeAudio: async () => true,
}));

import { renderProjectMp4 } from "./video";

describe("장면 MP4 렌더링", () => {
  it("업로드 클립을 프레임마다 그리고 짧은 클립의 마지막 화면을 유지한다", async () => {
    calls.timestamps = []; calls.decodedDraws = 0; calls.introDraws = 0; calls.frames = 0; calls.disposed = 0;
    vi.stubGlobal("Image", class { naturalWidth = 320; naturalHeight = 180; src = ""; decode = async () => {}; });
    const canvas = { width: 0, height: 0, getContext: () => ({
      canvas, fillStyle: "", font: "", textAlign: "", textBaseline: "",
      fillRect: () => {}, drawImage: (image: { timestamp?: number }) => { if (image.timestamp !== undefined) calls.decodedDraws++; },
      fillText: () => {}, measureText: (text: string) => ({ width: text.length * 10 }),
    }) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 2;
    project.scenes[0].candidates = [{ id: "clip", path: "candidate_clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 1 }];
    project.scenes[0].selected_candidate_id = "clip";
    project.ending_message = "";
    const output = await renderProjectMp4(project);
    expect(output.type).toBe("video/mp4");
    expect(calls.frames).toBe(75); // 3초 오프닝 + 2초 장면
    expect(calls.decodedDraws).toBe(30);
    expect(calls.timestamps).toHaveLength(30);
    expect(calls.timestamps.at(-1)).toBeCloseTo(0.999);
    expect(calls.disposed).toBe(1);
  });

  it("같은 장면에 올린 이미지를 먼저 표시하고 동영상으로 전환한다", async () => {
    calls.timestamps = []; calls.decodedDraws = 0; calls.introDraws = 0; calls.frames = 0; calls.disposed = 0;
    vi.stubGlobal("Image", class { naturalWidth = 320; naturalHeight = 180; src = ""; decode = async () => {}; });
    const canvas = { width: 0, height: 0, getContext: () => ({
      canvas, fillStyle: "", font: "", textAlign: "", textBaseline: "",
      fillRect: () => {}, drawImage: (image: { timestamp?: number; src?: string }) => {
        if (image.timestamp !== undefined) calls.decodedDraws++;
        if (image.src === "intro") calls.introDraws++;
      }, fillText: () => {}, measureText: (text: string) => ({ width: text.length * 10 }),
    }) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 2;
    project.scenes[0].candidates = [
      { id: "intro", path: "intro.png", preview_url: "intro", created_at: "now", mode: "uploaded" },
      { id: "clip", path: "candidate_clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 1 },
    ];
    project.scenes[0].selected_candidate_id = "clip";
    project.ending_message = "";
    await renderProjectMp4(project);
    expect(calls.frames).toBe(75);
    expect(calls.introDraws).toBeGreaterThan(45);
    expect(calls.decodedDraws).toBe(22);
    expect(calls.timestamps).toHaveLength(22);
    expect(calls.timestamps[0]).toBe(0);
    expect(calls.disposed).toBe(1);
  });
});
