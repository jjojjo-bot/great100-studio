import { describe, expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { buildVideoPlan } from "./video";

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
});
