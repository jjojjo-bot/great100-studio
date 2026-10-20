import { narrationScript } from "./narration-generation";
import { sceneComposition } from "./media-composition";
import { orderedScenes } from "./scene-order";
import { sceneImageFilename } from "./scene-image-name";
import type { ProjectData } from "./types";

export function sceneNarrationRows(project: ProjectData) {
  return orderedScenes(project).map(scene => {
    const script = narrationScript(scene), length = scene.duration ?? 10;
    const duration = Number.isFinite(length) && length >= 1 && length <= 120 ? length : undefined;
    let narrationCount: number | undefined;
    try { narrationCount = sceneComposition(scene).narrations.length; } catch { /* Unknown is not a scene without narration. */ }
    return { scene, script, valid: !!script, duration, characters: Array.from(script).length, narrationCount,
      hasNarration: narrationCount === undefined ? undefined : narrationCount > 0,
      filename: sceneImageFilename(project.id, scene).replace(/\.png$/, ".wav") };
  });
}

export const narrationDurationLabel = (duration: number | undefined) => duration === undefined ? "길이 확인 필요" : `${Number(duration.toFixed(3))}초`;
export const narrationConnectionLabel = (count: number | undefined) => count === undefined ? "녹음 연결 확인 필요" : count ? `녹음 연결 있음 · ${count}구간` : "녹음 연결 없음";

export function sceneNarrationBundle(project: ProjectData, selectedIds: string[]) {
  const rows = sceneNarrationRows(project), selected = rows.filter(row => selectedIds.includes(row.scene.id) && row.valid);
  const excluded = [...new Set(selectedIds)].filter(id => !rows.some(row => row.scene.id === id && row.valid));
  const text = selected.length ? [
    "Great100 · 내레이션 대본 묶음",
    `프로젝트: EP. ${String(project.episode).padStart(3, "0")} · ${project.person}`,
    `현재 장면 순서 기준 · ${selected.length}개 장면`,
    "각 장면의 ‘낭독할 대본’만 녹음하고 권장 파일명으로 저장하세요.",
    "장면 길이는 현재 영상의 길이이며 실제 낭독 시간의 예측값이 아닙니다.",
    "파일명의 식별 부분을 유지하면 순서가 바뀌어도 같은 프로젝트·장면에 연결합니다.",
    "확장자는 실제 녹음 형식에 맞게 .wav, .mp3, .m4a, .mp4, .webm 중 하나를 사용하세요.",
    "각 파일은 30MB·120초 이하로 준비하세요. 장면보다 긴 녹음은 적용할 때 시간 조정안을 검토합니다.",
    "결과는 전체 검토 → 내레이션 일괄 배치에서 연결안을 확인한 뒤 적용하세요.",
    ...selected.map(row => `\n${"=".repeat(48)}\nScene ${row.scene.number} · ${row.scene.title}\n권장 녹음 파일명: ${row.filename}\n현재 장면 길이: ${narrationDurationLabel(row.duration)}\n${narrationConnectionLabel(row.narrationCount)}\n\n낭독할 대본:\n${row.script}`),
  ].join("\n") + "\n" : "";
  const base = project.folder_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 150) || "great100";
  return { rows, selected, excluded, text, filename: `${base}_narration_scripts.txt` };
}
