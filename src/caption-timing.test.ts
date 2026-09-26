import { describe, expect, it } from "vitest";
import { moveCaption, redistributeCaptions, resetCaptionTiming } from "./CaptionWaveform";

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

  it("한 자막이 늘면 남은 자막을 기존 길이 비율로 자동 재배분한다", () => {
    const four = [
      { text: "1", start_sec: 0, end_sec: 4 },
      { text: "2", start_sec: 4, end_sec: 8 },
      { text: "3", start_sec: 8, end_sec: 14 },
      { text: "4", start_sec: 14, end_sec: 19 },
    ];
    const result = redistributeCaptions(four, 0, 6, 0, 19);
    expect(result[0]).toMatchObject({ start_sec: 0, end_sec: 6 });
    expect(result[1].end_sec - result[1].start_sec).toBeLessThan(4);
    expect(result[2].end_sec - result[2].start_sec).toBeGreaterThan(result[1].end_sec - result[1].start_sec);
    expect(result.every((block, index) => index === 0 || block.start_sec === result[index - 1].end_sec)).toBe(true);
    expect(result.at(-1)?.end_sec).toBe(19);
    expect(four[0].end_sec).toBe(4);
  });

  it("선택한 자막 이외의 줄에는 최소 0.1초를 남긴다", () => {
    const result = redistributeCaptions(blocks, 0, 99, 10, 8);
    expect(result[0].end_sec).toBe(17.9);
    expect(result[1]).toMatchObject({ start_sec: 17.9, end_sec: 18 });
  });

  it("제작안 시간으로 초기화할 때 수정한 문구는 유지한다", () => {
    const edited = [{ text: "수정한 문구", start_sec: 10.5, end_sec: 12.5 }, blocks[1]];
    expect(resetCaptionTiming(edited, blocks)).toEqual([
      { text: "수정한 문구", start_sec: 10, end_sec: 12 },
      blocks[1],
    ]);
    expect(resetCaptionTiming(edited, undefined)).toBe(edited);
  });
});
