import { DEFAULT_STYLE } from "./parser";
import type { ProjectData, Scene } from "./types";

export function composeScenePrompt(project: Pick<ProjectData, "person" | "character_profile" | "style_guide">, scene: Pick<Scene, "prompt">): string {
  const sceneText = scene.prompt.trim();
  const appearance = project.character_profile.description.trim()
    || `${project.person}의 외형은 선택한 인물 기준 이미지와 일관되게 유지할 것.`;
  const sourceStyle = project.style_guide.trim();
  const parts = [sceneText || "장면의 이미지 내용을 입력하세요."];
  if (!sceneText.includes(appearance)) parts.push(`인물 외형 기준 (주인공이 등장하는 장면에만 적용, 등장하지 않는 장면에 새로 추가하지 말 것): ${appearance}`);
  if (!sceneText.includes(DEFAULT_STYLE)) parts.push(`공통 기본 스타일: ${DEFAULT_STYLE}`);
  if (sourceStyle && sourceStyle !== DEFAULT_STYLE && !sceneText.includes(sourceStyle)) {
    parts.push(`제작안 추가 이미지 조건: ${sourceStyle}`);
  }
  return parts.join("\n\n");
}

export function withFullScenePrompts(project: ProjectData): ProjectData {
  return { ...project, scenes: project.scenes.map((scene) => ({ ...scene, full_prompt: composeScenePrompt(project, scene) })) };
}
