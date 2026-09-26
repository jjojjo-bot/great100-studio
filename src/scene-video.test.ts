import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ duration: 10, disposed: 0 }));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: {}, BlobSource: class {}, CanvasSink: class {},
  Input: class {
    getPrimaryVideoTrack = async () => ({ canDecode: async () => true, getFirstTimestamp: async () => 0, computeDuration: async () => fake.duration });
    dispose = () => { fake.disposed++; };
  },
}));
import { MAX_SCENE_VIDEO_BYTES, openSceneVideo, validateSceneVideoFile } from "./scene-video";

const header = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

describe("장면 MP4 업로드 검사", () => {
  it("MP4 파일 서명과 용량을 확인한다", () => {
    expect(() => validateSceneVideoFile({ name: "clip.mp4", type: "video/mp4", size: 1024 }, header)).not.toThrow();
    expect(() => validateSceneVideoFile({ name: "clip.png", type: "image/png", size: 1024 }, header)).toThrow("MP4");
    expect(() => validateSceneVideoFile({ name: "clip.mp4", type: "video/mp4", size: MAX_SCENE_VIDEO_BYTES + 1 }, header)).toThrow("50MB");
    expect(() => validateSceneVideoFile({ name: "clip.mp4", type: "video/mp4", size: 1024 }, new Uint8Array(12))).toThrow("올바른 MP4");
  });
  it("10초 초과 영상은 디코더를 닫고 거부한다", async () => {
    fake.duration = 10.2; fake.disposed = 0;
    await expect(openSceneVideo(new Blob([header]))).rejects.toThrow("10초 이하");
    expect(fake.disposed).toBe(1);
    fake.duration = 10;
    const video = await openSceneVideo(new Blob([header]));
    expect(video.duration).toBe(10);
    video.input.dispose();
  });
});
