import { DEFAULT_STYLE } from "./parser";
import type { ProjectData, Scene } from "./types";

const styleItems = (text: string) => text
  .replace(/^(?:(?:공통\s*)?(?:기본\s*)?(?:이미지\s*)?(?:스타일|조건)|이미지\s*조건)\s*[:：]\s*/i, "")
  .split(/[,，]/)
  .map((item) => item.replace(/^[\s*]+|[\s*.。]+$/g, "").trim())
  .filter(Boolean);

const comparable = (text: string) => text.toLocaleLowerCase().replace(/[\s.!。·-]/g, "");

const SHOT_FRAMING: Record<string, string> = {
  extreme_closeup: "극단적 근접 촬영. 지정한 작은 부분이 화면 대부분을 차지하게 하고 주변은 최소화하세요.",
  closeup: "근접 촬영. 지정한 얼굴·손·사물이 화면의 중심을 크게 차지하게 하세요.",
  medium: "중간 거리 촬영. 대상의 상반신 또는 주요 행동과 주변 일부를 함께 보여 주세요.",
  full_body: "전신 촬영. 인물의 머리부터 발끝까지 잘리지 않게 보여 주세요.",
  wide: "원경 촬영. 인물보다 장소와 인물의 관계가 잘 드러나게 넓게 보여 주세요.",
  extreme_wide: "극단적 원경 촬영. 넓은 풍경이 화면의 대부분을 차지하게 하세요.",
  overhead: "정수리 위에서 바닥을 수직으로 내려다보는 탑다운 구도로 보여 주세요.",
  high_angle: "대상을 위쪽에서 비스듬히 내려다보는 하이 앵글로 보여 주세요.",
  low_angle: "대상을 아래쪽에서 비스듬히 올려다보는 로우 앵글로 보여 주세요.",
  over_the_shoulder: "대상의 어깨 뒤에서 앞쪽의 행동이나 사물을 바라보는 어깨너머 구도로 보여 주세요.",
};

function shotFraming(value: string | undefined): string {
  const shot = value?.trim();
  if (!shot) return "";
  const instruction = SHOT_FRAMING[shot.toLocaleLowerCase().replace(/[\s-]+/g, "_")];
  return `최우선 카메라 구도 (${shot}): ${instruction || `${shot} 구도를 유지하고 장면 내용보다 촬영 거리와 시점을 우선하세요.`}`;
}

export function composeScenePrompt(project: Pick<ProjectData, "person" | "character_profile" | "style_guide"> & Partial<Pick<ProjectData, "schema_version">>, scene: Pick<Scene, "prompt" | "visual_type" | "shot_type" | "location" | "main_action">): string {
  const sceneText = scene.prompt.trim();
  const appearance = project.character_profile.description.trim()
    || `${project.person}의 외형은 선택한 인물 기준 이미지와 일관되게 유지할 것.`;
  const framing = project.schema_version && project.schema_version !== 1 ? shotFraming(scene.shot_type) : "";
  const parts = [...(framing ? [framing] : []), sceneText || "장면의 이미지 내용을 입력하세요."];
  if (project.schema_version && project.schema_version !== 1 && (scene.visual_type || scene.location || scene.main_action)) parts.push(`이 장면의 구성: ${[scene.visual_type, scene.location, scene.main_action].filter(Boolean).join(" · ")}.`);
  if (!sceneText.includes(appearance)) {
    parts.push(`${project.schema_version && project.schema_version !== 1 ? "인물 기준 이미지는 얼굴·복식의 일관성에만 참고하세요. 구도와 피사체는 이 Scene의 지시를 우선하세요. " : ""}주인공이 등장하면 다음 외형을 유지하고, 등장하지 않는 장면에는 새로 추가하지 마세요. ${appearance}`);
  }
  const seen = new Set<string>();
  const styles = [...styleItems(DEFAULT_STYLE), ...styleItems(project.style_guide)].filter((item) => {
    const key = comparable(item);
    if (project.schema_version && project.schema_version !== 1 && ["notext", "noletters", "nocaptions", "nowatermark", "16:9"].includes(key)) return false;
    if (seen.has(key) || comparable(sceneText).includes(key)) return false;
    seen.add(key);
    return true;
  });
  if (styles.length) parts.push(`${styles.join(", ")}.`);
  if (project.schema_version && project.schema_version !== 1) parts.push("no text, no letters, no captions, no watermark. 16:9.");
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
