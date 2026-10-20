import type { ProjectData, Scene } from "./types";
import { mediaCompositionErrors, prepareMediaProject } from "./media-composition";

export const EDITOR_VERSION = 4;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const sourceJson = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function assertEditorReadable(project: ProjectData): void {
  const version = project.editor_version === undefined ? 0 : project.editor_version;
  if (!Number.isSafeInteger(version) || version < 0 || version > EDITOR_VERSION) {
    throw new Error("이 프로젝트는 더 새로운 편집 형식을 사용합니다. 앱을 업데이트하거나 새로고침해 주세요.");
  }
}

export function assertEditorWrite(project: ProjectData, stored?: ProjectData): void {
  assertEditorReadable(project);
  if (!stored) return;
  assertEditorReadable(stored);
  if ((stored.editor_version ?? 0) > (project.editor_version ?? 0)) {
    throw new Error("저장된 프로젝트의 편집 형식이 더 최신입니다. 최신 작업을 다시 열어 주세요.");
  }
  for (const asset of stored.media?.assets || []) {
    const next = project.media?.assets.find(item => item.id === asset.id);
    if (!next || next.path !== asset.path || next.kind !== asset.kind || next.local_key !== asset.local_key || next.local_store !== asset.local_store
      || next.mime_type !== asset.mime_type || next.duration_sec !== asset.duration_sec || (asset.storage_key && next.storage_key !== asset.storage_key)
      || (asset.preview_storage_key && next.preview_storage_key !== asset.preview_storage_key)
      || (asset.inline_data && !next.storage_key && next.inline_data !== asset.inline_data)) throw new Error("보관 중인 원본 자료는 제거하거나 교체할 수 없습니다. 최신 작업을 다시 열어 주세요.");
  }
  if (Math.max(stored.editor_version ?? 0, project.editor_version ?? 0) >= 1 && (
    stored.source_text !== project.source_text || sourceJson(stored.source) !== sourceJson(project.source)
  )) throw new Error("원본 제작안은 변경할 수 없습니다. 수정한 제작안은 새 프로젝트로 만들어 주세요.");
}

// Loading adds editor metadata in memory only. Existing timing, scene IDs, media
// paths, source JSON and fields unknown to this client are retained verbatim.
export function readEditorProject(project: ProjectData): ProjectData {
  try { assertEditorReadable(project); } catch { return project; }
  if ((project.editor_version ?? 0) >= 1) return project;
  const next = structuredClone(project);
  const used = new Set(next.scenes.flatMap(scene => scene.captions || []).map(block => block.id).filter(nonempty));
  for (const scene of next.scenes) {
    scene.source_scene_ids ??= scene.source_scene_id ? [scene.source_scene_id] : next.source?.scenes.some(source => source.id === scene.id) ? [scene.id] : [];
    scene.captions = scene.captions?.map((block, index) => {
      if (nonempty(block.id)) return block;
      const base = `${scene.id}:caption:${index + 1}`;
      let id = base;
      for (let suffix = 2; used.has(id); suffix++) id = `${base}:${suffix}`;
      used.add(id);
      return { ...block, id };
    });
  }
  const sourceCore = next.source?.core_achievement.scene_id;
  next.editor ??= { core_scene_ids: sourceCore ? next.scenes.filter(scene => scene.source_scene_ids?.includes(sourceCore)).map(scene => scene.id) : [] };
  next.editor_version = 1;
  return next;
}

export function isCoreScene(project: ProjectData, scene: Scene): boolean {
  return project.editor ? Array.isArray(project.editor.core_scene_ids) && project.editor.core_scene_ids.includes(scene.id)
    : !!project.source && project.source.core_achievement.scene_id === (scene.source_scene_id || scene.id);
}

export function prepareEditorWrite(project: ProjectData): ProjectData {
  assertEditorReadable(project);
  const next = (project.editor_version ?? 0) < 2 && project.scenes.some(scene => scene.narration_audio?.id)
    ? { ...readEditorProject(project), editor_version: 2 } : project;
  const prepared = prepareMediaProject(readEditorProject(next));
  return prepared.scenes.some(scene => scene.split_origin || scene.composition?.mode === "segments")
    ? { ...prepared, editor_version: Math.max(4, prepared.editor_version ?? 0), media: prepared.media || { assets: [] } } : prepared;
}

export function editorIdentityErrors(project: ProjectData): string[] {
  const errors: string[] = [];
  try { assertEditorReadable(project); } catch (error) { errors.push((error as Error).message); }
  const scenes = new Set<string>();
  const captions = new Set<string>();
  const numbers = new Set<number>();
  if ((project.editor_version ?? 0) >= 1 && (!Array.isArray(project.editor?.core_scene_ids)
    || new Set(project.editor.core_scene_ids).size !== project.editor.core_scene_ids.length)) errors.push("핵심 업적의 편집 장면 연결이 잘못되었습니다.");
  for (const scene of project.scenes) {
    if (!nonempty(scene.id) || scenes.has(scene.id)) errors.push("장면 ID가 없거나 중복되었습니다.");
    scenes.add(scene.id);
    if (!Number.isSafeInteger(scene.number) || scene.number < 1 || numbers.has(scene.number)) errors.push("장면 표시 번호가 잘못되었거나 중복되었습니다.");
    numbers.add(scene.number);
    const duration = scene.duration ?? 10;
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) errors.push(`Scene ${scene.number}의 길이는 1~120초여야 합니다.`);
    if (scene.narration_audio && (!Number.isFinite(scene.narration_audio.duration_sec) || scene.narration_audio.duration_sec > duration + 0.15)) errors.push(`Scene ${scene.number}의 녹음이 장면보다 깁니다. 녹음 길이에 맞추기를 적용해 주세요.`);
    if ((project.editor_version ?? 0) >= 1) {
      if (!Array.isArray(scene.source_scene_ids) || scene.source_scene_ids.some(id => !nonempty(id) || !project.source?.scenes.some(source => source.id === id))) errors.push(`Scene ${scene.number}의 원본 장면 연결이 잘못되었습니다.`);
      for (const block of scene.captions || []) {
        if (!nonempty(block.id) || captions.has(block.id)) errors.push(`Scene ${scene.number}의 자막 ID가 없거나 중복되었습니다.`);
        if (block.id) captions.add(block.id);
      }
    }
  }
  return [...errors, ...mediaCompositionErrors(project)];
}
