// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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
});
