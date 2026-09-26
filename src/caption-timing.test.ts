import { describe, expect, it } from "vitest";
import { moveCaption } from "./CaptionWaveform";

describe("녹음 파형 자막 이동", () => {
  const blocks = [
    { text: "첫째", start_sec: 10, end_sec: 12 },
    { text: "둘째", start_sec: 12, end_sec: 14 },
  ];
  it("씬 시작 기준으로 이동하고 이웃 자막과 겹치지 않는다", () => {
    expect(moveCaption(blocks, 0, "move", -5, 10, 8)[0]).toMatchObject({ start_sec: 10, end_sec: 12 });
    expect(moveCaption(blocks, 1, "move", 10, 10, 8)[1]).toMatchObject({ start_sec: 16, end_sec: 18 });
  });
  it("양끝 조절은 최소 0.1초와 인접 경계를 유지한다", () => {
    expect(moveCaption(blocks, 0, "end", 10, 10, 8)[0].end_sec).toBe(12);
    expect(moveCaption(blocks, 1, "start", 10, 10, 8)[1].start_sec).toBe(13.9);
  });
});
