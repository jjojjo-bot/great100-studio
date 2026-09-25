import { describe, expect, it } from "vitest";
import { createProjectDraft, DEFAULT_STYLE } from "./parser";
import { composeScenePrompt } from "./prompts";
import { SAMPLE_WORK_TEXT } from "./sample";

describe("copy-ready scene prompt", () => {
  it("always combines scene content, character appearance and the default style", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.style_guide = "피와 시신 없음, 조선시대 복식 존중";
    const prompt = composeScenePrompt(project, project.scenes[0]);
    expect(prompt).toContain(project.scenes[0].prompt);
    expect(prompt).toContain(project.character_profile.description);
    expect(prompt).toContain(DEFAULT_STYLE);
    expect(prompt).toContain(project.style_guide);
    expect(prompt).toContain("주인공이 등장하는 장면에만 적용");
  });

  it("uses the current profile and style after edits without duplicating exact content", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.character_profile.description = "붉은 관복과 짧은 수염";
    project.style_guide = "흐린 새벽 분위기";
    project.scenes[0].prompt = `조선의 바다. ${project.character_profile.description}`;
    const prompt = composeScenePrompt(project, project.scenes[0]);
    expect(prompt.match(/붉은 관복과 짧은 수염/g)).toHaveLength(1);
    expect(prompt).toContain("흐린 새벽 분위기");
  });
});
