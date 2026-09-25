import { DEFAULT_STYLE } from "./parser";
import type { ProjectData, Scene } from "./types";

const styleItems = (text: string) => text
  .replace(/^(?:(?:공통\s*)?(?:기본\s*)?(?:이미지\s*)?(?:스타일|조건)|이미지\s*조건)\s*[:：]\s*/i, "")
  .split(/[,，]/)
  .map((item) => item.replace(/^[\s*]+|[\s*.。]+$/g, "").trim())
  .filter(Boolean);

const comparable = (text: string) => text.toLocaleLowerCase().replace(/[\s.!。·-]/g, "");

export function composeScenePrompt(project: Pick<ProjectData, "person" | "character_profile" | "style_guide">, scene: Pick<Scene, "prompt">): string {
  const sceneText = scene.prompt.trim();
  const appearance = project.character_profile.description.trim()
    || `${project.person}의 외형은 선택한 인물 기준 이미지와 일관되게 유지할 것.`;
  const parts = [sceneText || "장면의 이미지 내용을 입력하세요."];
  if (!sceneText.includes(appearance)) {
    parts.push(`주인공이 등장하면 다음 외형을 유지하고, 등장하지 않는 장면에는 새로 추가하지 마세요. ${appearance}`);
  }
  const seen = new Set<string>();
  const styles = [...styleItems(DEFAULT_STYLE), ...styleItems(project.style_guide)].filter((item) => {
    const key = comparable(item);
    if (seen.has(key) || comparable(sceneText).includes(key)) return false;
    seen.add(key);
    return true;
  });
  if (styles.length) parts.push(`${styles.join(", ")}.`);
  return parts.join("\n\n");
}

export function withFullScenePrompts(project: ProjectData): ProjectData {
  return { ...project, scenes: project.scenes.map((scene) => ({ ...scene, full_prompt: composeScenePrompt(project, scene) })) };
}
