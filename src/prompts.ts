import { DEFAULT_STYLE } from "./parser";
import type { ProjectData, Scene } from "./types";

const styleItems = (text: string) => text
  .replace(/^(?:(?:공통\s*)?(?:기본\s*)?(?:이미지\s*)?(?:스타일|조건)|이미지\s*조건)\s*[:：]\s*/i, "")
  .split(/[,，]/)
  .map((item) => item.replace(/^[\s*]+|[\s*.。]+$/g, "").trim())
  .filter(Boolean);

const comparable = (text: string) => text.toLocaleLowerCase().replace(/[\s.!。·-]/g, "");

export function composeScenePrompt(project: Pick<ProjectData, "person" | "character_profile" | "style_guide"> & Partial<Pick<ProjectData, "schema_version">>, scene: Pick<Scene, "prompt" | "visual_type" | "shot_type" | "location" | "main_action">): string {
  const sceneText = scene.prompt.trim();
  const appearance = project.character_profile.description.trim()
    || `${project.person}의 외형은 선택한 인물 기준 이미지와 일관되게 유지할 것.`;
  const parts = [sceneText || "장면의 이미지 내용을 입력하세요."];
  if (project.schema_version === "2.0" && (scene.visual_type || scene.shot_type || scene.location || scene.main_action)) parts.push(`이 장면의 구성 우선: ${[scene.visual_type, scene.shot_type, scene.location, scene.main_action].filter(Boolean).join(" · ")}.`);
  if (!sceneText.includes(appearance)) {
    parts.push(`${project.schema_version === "2.0" ? "인물 기준 이미지는 얼굴·복식의 일관성에만 참고하세요. 구도와 피사체는 이 Scene의 지시를 우선하세요. " : ""}주인공이 등장하면 다음 외형을 유지하고, 등장하지 않는 장면에는 새로 추가하지 마세요. ${appearance}`);
  }
  const seen = new Set<string>();
  const styles = [...styleItems(DEFAULT_STYLE), ...styleItems(project.style_guide)].filter((item) => {
    const key = comparable(item);
    if (project.schema_version === "2.0" && ["notext", "noletters", "nocaptions", "nowatermark", "16:9"].includes(key)) return false;
    if (seen.has(key) || comparable(sceneText).includes(key)) return false;
    seen.add(key);
    return true;
  });
  if (styles.length) parts.push(`${styles.join(", ")}.`);
  if (project.schema_version === "2.0") parts.push("no text, no letters, no captions, no watermark. 16:9.");
  return parts.join("\n\n");
}

export function composeThumbnailPrompt(project: Pick<ProjectData, "person" | "character_profile" | "style_guide" | "thumbnail">): string {
  return composeScenePrompt(project, { prompt: project.thumbnail.prompt });
}

export function withFullImagePrompts(project: ProjectData): ProjectData {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({ ...scene, full_prompt: composeScenePrompt(project, scene) })),
    thumbnail: { ...project.thumbnail, full_prompt: composeThumbnailPrompt(project) },
  };
}
