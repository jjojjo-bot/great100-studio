import { assertEditorReadable, readEditorProject } from "./editor-format";
import { milliseconds, projectTimeline } from "./timeline";
import type { ProjectData, Scene } from "./types";

export const orderedScenes = (project: ProjectData): Scene[] => [...project.scenes].sort((left, right) => left.number - right.number);

// Reorder the current edit, preserving all scene/media identities and each
// caption's position within its own scene. The original source stays intact.
export function moveScene(project: ProjectData, sceneId: string, direction: -1 | 1): ProjectData {
  assertEditorReadable(project);
  if (direction !== -1 && direction !== 1) throw new Error("장면 이동 방향이 올바르지 않습니다.");
  const ordered = orderedScenes(project);
  const index = ordered.findIndex(scene => scene.id === sceneId);
  if (index < 0) throw new Error("이동할 장면을 찾지 못했습니다.");
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return project;
  const identities = new Set<string>(); const numbers = new Set<number>();
  for (const scene of ordered) {
    if (!scene.id || identities.has(scene.id) || !Number.isSafeInteger(scene.number) || scene.number < 1 || numbers.has(scene.number)) throw new Error("장면 ID나 순서가 잘못되었습니다. 최신 작업을 다시 열어 주세요.");
    identities.add(scene.id); numbers.add(scene.number);
    if (!Number.isFinite(scene.duration ?? 10) || (scene.duration ?? 10) < 1 || (scene.duration ?? 10) > 120) throw new Error("장면 길이는 1~120초여야 합니다.");
  }
  const entries = new Map(projectTimeline(project).scenes.map(entry => [entry.scene.id, entry]));
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  let cursor = 0;
  const scenes = ordered.map((scene, position) => {
    const entry = entries.get(scene.id)!;
    const start = cursor; const end = start + entry.durationMs;
    if (!Number.isFinite(entry.sourceStartMs)) throw new Error("장면의 시작 시간을 확인한 뒤 다시 이동해 주세요.");
    const captions = scene.captions?.map(block => {
      const relativeStart = milliseconds(block.start_sec) - entry.sourceStartMs;
      const relativeEnd = milliseconds(block.end_sec) - entry.sourceStartMs;
      if (!Number.isFinite(relativeStart) || !Number.isFinite(relativeEnd) || relativeStart < 0 || relativeEnd <= relativeStart || relativeEnd > entry.durationMs) throw new Error("자막이 장면 범위를 벗어났습니다. 자막 시간을 확인한 뒤 다시 이동해 주세요.");
      return { ...block, start_sec: (start + relativeStart) / 1000, end_sec: (start + relativeEnd) / 1000 };
    });
    cursor = end;
    return { ...scene, number: position + 1, start_sec: start / 1000, end_sec: end / 1000, captions };
  });
  return readEditorProject({ ...project, scenes });
}
