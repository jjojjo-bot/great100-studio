// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { ScenePreviewPane } from "./SceneTimeline";

describe("장면 시간축 드래그", () => {
  it("눈금을 누른 채 움직이면 재생 위치가 연속해서 바뀐다", () => {
    const project = createProjectDraft(1, "세종대왕", "왕", SAMPLE_WORK_TEXT);
    const scene = project.scenes[0];
    scene.duration = 10;
    const { container } = render(<ScenePreviewPane project={project} scene={scene} onChange={vi.fn()} />);
    const ruler = container.querySelector('.scene-timeline-ruler [role="slider"]') as HTMLDivElement;
    ruler.setPointerCapture = vi.fn();
    ruler.hasPointerCapture = vi.fn(() => true);
    ruler.releasePointerCapture = vi.fn();
    vi.spyOn(ruler, "getBoundingClientRect").mockReturnValue({ left: 100, width: 400 } as DOMRect);
    const displayedTime = () => container.querySelector(".scene-timeline-head > span")?.textContent;
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(ruler, event);
    };

    pointer("pointerdown", 200);
    expect(displayedTime()).toContain("2.5 / 10.0");
    pointer("pointermove", 380);
    expect(displayedTime()).toContain("7.0 / 10.0");
    pointer("pointerup", 420);
    expect(displayedTime()).toContain("8.0 / 10.0");
    expect(ruler.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
