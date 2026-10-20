import { createV2ProjectDraft, validateAppData } from "../../src/app-data";
import type { AppDataV2 } from "../../src/types";

export function editorProject(version: "2.0" | "2.1" = "2.1") {
  const data: AppDataV2 = {
    schema_version: version,
    person: { name: "세종", one_line_intro: "새 글자", period: "조선" },
    video: { target_duration_sec: 30, concept: "글자의 탄생" },
    core_achievement: { title: "훈민정음", must_visualize: true, scene_id: "scene_02", visual_subject: "글자" },
    character_profile: { age: "40", face: "온화함", eyes: "차분함", hair: "묶음", beard: "수염", body: "단정함", outfit: "왕복", impression: "임금" },
    scenes: Array.from({ length: 3 }, (_, index) => ({
      id: `scene_0${index + 1}`, order: index + 1, start_sec: index * 10, end_sec: (index + 1) * 10,
      narration: `세종의 이야기 ${index + 1}`, scene_description: "새 글자를 만드는 모습", visual_type: "행동", shot_type: "미디엄", location: "서재",
      main_subject: "세종", main_action: "집필", image_prompt: "세종이 집필한다", support_image_prompt: null, subtitle: "새 글자", motion: "none",
      ...(version === "2.1" ? { captions: [{ text: `세종의 이야기 ${index + 1}`, start_sec: index * 10, end_sec: (index + 1) * 10 }] } : {}),
    })),
    ending: { title: "기억", message: "고맙습니다" },
    thumbnail: { phrases: ["세종"], prompts: ["세종의 얼굴"], recommended_index: 0 },
    youtube: { titles: ["세종"], recommended_title_index: 0, description: "글자의 탄생", hashtags: ["역사"] },
  };
  return createV2ProjectDraft(1, "왕", JSON.stringify(data), data, validateAppData(data));
}
