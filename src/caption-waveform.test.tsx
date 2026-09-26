// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptionWaveform } from "./CaptionWaveform";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";

describe("자막 시간 막대", () => {
  it("녹음이 없어도 표시하고 드래그로 자막 시간을 변경한다", () => {
    const scene = createProjectDraft(1, "세종대왕", "왕", SAMPLE_WORK_TEXT).scenes[0];
    scene.start_sec = 0;
    scene.duration = 10;
    scene.captions = [
      { text: "첫 자막", start_sec: 0, end_sec: 3 },
      { text: "두 번째", start_sec: 5, end_sec: 8 },
    ];
    const onChange = vi.fn();
    const { container } = render(<CaptionWaveform scene={scene} onChange={onChange} />);
    expect(screen.getByText("자막 시간 막대")).toBeTruthy();
    const track = container.querySelector(".waveform-track") as HTMLDivElement;
    track.setPointerCapture = vi.fn();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);
    const caption = container.querySelector(".waveform-caption") as HTMLDivElement;
    fireEvent(caption, new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    fireEvent(track, new MouseEvent("pointermove", { bubbles: true, clientX: 140 }));
    fireEvent(track, new MouseEvent("pointerup", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ captions: [
      expect.objectContaining({ start_sec: 1, end_sec: 4 }),
      expect.objectContaining({ start_sec: 5, end_sec: 8 }),
    ] }));
  });

  it("끝 손잡이를 늘리면 나머지 자막도 자동으로 조절된다", () => {
    const scene = createProjectDraft(1, "세종대왕", "왕", SAMPLE_WORK_TEXT).scenes[0];
    scene.start_sec = 0; scene.duration = 10;
    scene.captions = [{ text: "첫 자막", start_sec: 0, end_sec: 3 }, { text: "두 번째", start_sec: 3, end_sec: 10 }];
    const onChange = vi.fn();
    const { container } = render(<CaptionWaveform scene={scene} onChange={onChange} />);
    const track = container.querySelector(".waveform-track") as HTMLDivElement;
    track.setPointerCapture = vi.fn();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);
    const handle = within(container).getByRole("slider", { name: "자막 1 종료 손잡이" });
    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientX: 120 }));
    fireEvent(track, new MouseEvent("pointermove", { bubbles: true, clientX: 160 }));
    fireEvent(track, new MouseEvent("pointerup", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ captions: [
      expect.objectContaining({ start_sec: 0, end_sec: 4 }),
      expect.objectContaining({ start_sec: 4, end_sec: 10 }),
    ] }));
  });

  it("초기화 버튼은 변경한 시간을 원래 값으로 되돌린다", () => {
    const scene = createProjectDraft(1, "세종대왕", "왕", SAMPLE_WORK_TEXT).scenes[0];
    scene.start_sec = 0; scene.duration = 10;
    scene.captions = [{ text: "바뀐 문구", start_sec: 0, end_sec: 4 }, { text: "둘째", start_sec: 4, end_sec: 10 }];
    const original = [{ text: "원래 문구", start_sec: 0, end_sec: 3 }, { text: "둘째", start_sec: 3, end_sec: 10 }];
    const onChange = vi.fn();
    const { container } = render(<CaptionWaveform scene={scene} originalCaptions={original} onChange={onChange} />);
    fireEvent.click(within(container).getByRole("button", { name: "제작안 시간으로 초기화" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ captions: [
      { text: "바뀐 문구", start_sec: 0, end_sec: 3 },
      { text: "둘째", start_sec: 3, end_sec: 10 },
    ] }));
  });

  it("통합 시간축에서 자막을 누르면 해당 자막의 시작 위치를 알린다", () => {
    const scene = createProjectDraft(1, "세종대왕", "왕", SAMPLE_WORK_TEXT).scenes[0];
    scene.start_sec = 20; scene.duration = 10;
    scene.captions = [{ text: "첫 자막", start_sec: 20, end_sec: 23 }, { text: "두 번째", start_sec: 23, end_sec: 30 }];
    const onSelectCaption = vi.fn();
    const { container } = render(<CaptionWaveform embedded scene={scene} onChange={vi.fn()} onSelectCaption={onSelectCaption} />);
    const track = container.querySelector(".waveform-track") as HTMLDivElement;
    track.setPointerCapture = vi.fn();
    fireEvent((container.querySelectorAll(".waveform-caption")[1]), new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    expect(onSelectCaption).toHaveBeenCalledWith(3);
  });
});
