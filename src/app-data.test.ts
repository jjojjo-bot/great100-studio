import { describe, expect, it } from "vitest";
import { completionErrors, createV2ProjectDraft, parseAppData, reportForProject, validateAppData } from "./app-data";
import { buildVideoPlan } from "./video";
import type { AppDataV2, ImageCandidate } from "./types";

function fixture(): AppDataV2 {
  return {
    schema_version: "2.0", person: { name: "세종", one_line_intro: "새 글자를 만든 임금", period: "조선 전기" },
    video: { target_duration_sec: 285, concept: "글자의 탄생" },
    core_achievement: { title: "훈민정음 창제", must_visualize: true, scene_id: "scene_08", visual_subject: "훈민정음" },
    character_profile: { age: "40대", face: "둥근 얼굴", eyes: "차분한 눈", hair: "묶은 머리", beard: "짧은 수염", body: "단정함", outfit: "왕복", impression: "온화함" },
    scenes: Array.from({ length: 15 }, (_, index) => ({
      id: `scene_${String(index + 1).padStart(2, "0")}`, order: index + 1, start_sec: index * 19, end_sec: (index + 1) * 19,
      narration: `내레이션 ${index + 1}`, scene_description: `설명 ${index + 1}`, visual_type: `유형 ${index % 6}`,
      shot_type: `구도 ${index % 5}`, location: `장소 ${index % 4}`, main_subject: index % 3 === 0 ? "백성" : "세종",
      main_action: `행동 ${index + 1}`, image_prompt: `장면 ${index + 1}의 이미지`, support_image_prompt: null,
      subtitle: `자막 ${index + 1}`, motion: "zoom-in",
    })),
    ending: { title: "오늘의 우리가 당신에게", message: "고맙습니다" },
    thumbnail: { phrases: ["새 글자"], prompts: ["첫 번째 썸네일", "두 번째 썸네일"], recommended_index: 0 },
    youtube: { titles: ["세종 이야기"], recommended_title_index: 0, description: "설명", hashtags: ["세종"] },
  };
}

describe("APP_DATA v2", () => {
  it("extracts only the APP_DATA JSON from a Work response", () => {
    const data = fixture();
    const result = parseAppData(`# 자유형 본문\n어떤 Scene 텍스트\n\n## APP_DATA\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``);
    expect(result.data).toEqual(data);
    expect(result.report.errors).toEqual([]);
    expect(result.report.warnings).toEqual([]);
  });

  it("does not guess missing fields or missing scene IDs", () => {
    const data = fixture();
    data.scenes[6].id = "scene_08";
    data.scenes[4].subtitle = "";
    data.scenes[9].start_sec = 300;
    const report = validateAppData(data);
    expect(report.errors).toContain("scene_07이 누락되었거나 순서가 잘못되었습니다.");
    expect(report.errors).toContain("scene_05.subtitle 값이 없습니다.");
    expect(report.errors).toContain("scene_10의 start_sec/end_sec가 잘못되었습니다.");
  });

  it("blocks a missing core achievement but keeps diversity issues as warnings", () => {
    const data = fixture();
    data.core_achievement.scene_id = "scene_99";
    data.scenes.forEach((scene) => { scene.visual_type = "인물"; scene.shot_type = "미디엄"; scene.location = "서재"; scene.main_subject = "세종"; });
    const report = validateAppData(data);
    expect(report.errors.some((item) => item.includes("핵심 업적"))).toBe(true);
    expect(report.warnings.some((item) => item.includes("시각적으로 유사"))).toBe(true);
    expect(report.metrics.withoutProtagonist).toBe(0);
  });

  it("preserves the Work source and checks final image selections", () => {
    const data = fixture();
    const report = validateAppData(data);
    const project = createV2ProjectDraft(3, "사상 · 교육", "원문", data, report);
    project.scenes[0].prompt = "앱에서 수정한 프롬프트";
    expect(project.source?.scenes[0].image_prompt).toBe("장면 1의 이미지");
    expect(reportForProject(project).errors).toEqual([]);
    expect(completionErrors(project)).toHaveLength(16);
    const candidate: ImageCandidate = { id: "choice", path: "mock", preview_url: "data:image/svg+xml;base64,AA==", created_at: "now", mode: "mock" };
    project.scenes.forEach((scene) => { scene.candidates = [candidate]; scene.selected_candidate_id = "choice"; });
    project.thumbnail.candidates = [candidate]; project.thumbnail.selected_candidate_id = "choice";
    expect(completionErrors(project)).toEqual([]);
    expect(buildVideoPlan(project).reduce((sum, item) => sum + item.duration, 0)).toBe(289);
  });
});
