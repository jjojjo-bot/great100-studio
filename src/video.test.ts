import { describe, expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { buildVideoPlan, captionParts } from "./video";

describe("MP4 제작 계획", () => {
  it("requires a selected image for every scene", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    expect(() => buildVideoPlan(project)).toThrow("Scene 01");
  });

  it("uses scene captions and durations and adds an ending card", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes.forEach((scene) => {
      scene.candidates = [{ id: scene.id, path: "a.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" }];
      scene.selected_candidate_id = scene.id;
    });
    project.scenes[0].caption = "수정한 자막";
    project.scenes[0].duration = 7;
    const plan = buildVideoPlan(project);
    expect(plan[0]).toMatchObject({ caption: "수정한 자막", duration: 7 });
    expect(plan.at(-1)).toMatchObject({ ending: true, duration: 4 });
  });

  it("긴 내레이션을 빠짐없이 짧은 자막들로 나눈다", () => {
    const original = "이순신은 군사들을 모았습니다. 배와 무기를 점검하고 바닷길을 살폈습니다. 많은 적선이 다가왔지만 동료들과 함께 힘을 모았습니다. 그리고 마지막까지 책임을 다했습니다.";
    const parts = captionParts(original);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(original);
    expect(parts.every((part) => part.length <= 62)).toBe(true);
  });
});
