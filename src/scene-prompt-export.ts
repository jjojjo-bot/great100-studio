import { composeScenePrompt } from "./prompts";
import { sceneComposition } from "./media-composition";
import { orderedScenes } from "./scene-order";
import { sceneImageFilename } from "./scene-image-name";
import type { ProjectData } from "./types";

export function scenePromptRows(project: ProjectData) {
  return orderedScenes(project).map(scene => {
    let hasVisual: boolean | undefined;
    try { hasVisual = sceneComposition(scene).visuals.length > 0; } catch { /* Unknown is not an empty screen. */ }
    const valid = !!scene.prompt.trim();
    return { scene, hasVisual, valid, filename: sceneImageFilename(project.id, scene), prompt: valid ? composeScenePrompt(project, scene) : "" };
  });
}

export function scenePromptBundle(project: ProjectData, selectedIds: string[]) {
  const rows = scenePromptRows(project), selected = rows.filter(row => selectedIds.includes(row.scene.id) && row.valid);
  const excluded = selectedIds.filter(id => !rows.some(row => row.scene.id === id && row.valid));
  const text = selected.length ? [
    "Great100 · 장면 이미지 제작 프롬프트",
    `프로젝트: EP. ${String(project.episode).padStart(3, "0")} · ${project.person}`,
    `현재 장면 순서 기준 · ${selected.length}개 장면`,
    "각 장면의 프롬프트로 이미지를 따로 제작하고 권장 파일명으로 저장하세요.",
    "파일명의 식별 부분을 유지하면 순서가 바뀌어도 같은 프로젝트·장면에 연결합니다.",
    "확장자는 실제 이미지 형식에 맞게 .png, .jpg, .webp 중 하나를 사용하세요.",
    "필요한 인물 기준 이미지는 별도로 함께 첨부하세요.",
    "결과는 전체 검토 → 이미지 일괄 배치에서 연결안을 확인한 뒤 적용하세요.",
    ...selected.map(row => `\n${"=".repeat(48)}\nScene ${row.scene.number} · ${row.scene.title}\n권장 파일명: ${row.filename}\n\n${row.prompt}`),
  ].join("\n") + "\n" : "";
  const base = project.folder_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 150) || "great100";
  return { rows, selected, excluded, text, filename: `${base}_image_prompts.txt` };
}
