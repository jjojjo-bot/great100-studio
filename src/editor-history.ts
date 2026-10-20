import type { ProjectData } from "./types";

export interface EditOptions { history?: boolean; base?: ProjectData; label?: string }
type Target = { kind: "project" | "anchor" | "thumbnail" | "scene"; id?: string };
type Patch = { target: Target; field: string; before: unknown; after: unknown };
type Entry = { group: number; label: string; patches: Patch[] };
export type HistoryResult = { status: "empty" | "conflict" } | { status: "applied"; project: ProjectData };

const sceneFields = ["number", "subtitle", "title", "caption", "captions", "prompt", "duration", "start_sec", "end_sec", "motion", "music_volume", "video_intro_candidate_id", "video_intro_duration_sec", "video_trim_start_sec", "video_trim_end_sec", "support_start_sec", "selected_candidate_id", "support_selected_candidate_id", "support_image_prompt"];
const sceneOrder = (project: ProjectData) => project.scenes.map(scene => scene.id);
const labels: Record<string, string> = {
  subtitle: "강조 자막", title: "장면 제목", caption: "영상 자막", captions: "자막 문구·시간", prompt: "이미지 프롬프트",
  duration: "장면 길이", motion: "이미지 효과", music_volume: "음악 볼륨", selected_candidate_id: "후보 선택",
  support_selected_candidate_id: "보조 이미지 선택", video_intro_candidate_id: "동영상 앞 이미지", video_intro_duration_sec: "화면 전환",
  video_trim_start_sec: "동영상 시작", video_trim_end_sec: "동영상 종료", support_start_sec: "보조 이미지 전환",
  support_image_prompt: "보조 이미지 프롬프트", style_guide: "공통 스타일", character_profile: "인물 외형", ending_message: "엔딩 문구",
};
const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const sameScenes = (left: ProjectData, right: ProjectData) => left.scenes.length === right.scenes.length && same([...sceneOrder(left)].sort(), [...sceneOrder(right)].sort());
const object = (project: ProjectData, target: Target): Record<string, unknown> | undefined => {
  const value = target.kind === "project" ? project : target.kind === "scene" ? project.scenes.find(scene => scene.id === target.id) : project[target.kind];
  return value as unknown as Record<string, unknown> | undefined;
};
const valueAt = (project: ProjectData, patch: Pick<Patch, "target" | "field">) => patch.target.kind === "project" && patch.field === "scene_order" ? sceneOrder(project) : object(project, patch.target)?.[patch.field];

function patchesBetween(before: ProjectData, after: ProjectData): Patch[] {
  const patches: Patch[] = [];
  if (!same(sceneOrder(before), sceneOrder(after))) patches.push({ target: { kind: "project" }, field: "scene_order", before: sceneOrder(before), after: sceneOrder(after) });
  const collect = (target: Target, fields: string[]) => {
    const left = object(before, target); const right = object(after, target);
    if (!left || !right) return;
    for (const field of fields) if (!same(left[field], right[field])) patches.push({ target, field, before: structuredClone(left[field]), after: structuredClone(right[field]) });
  };
  collect({ kind: "project" }, ["style_guide", "character_profile", "ending_message"]);
  collect({ kind: "anchor" }, ["prompt", "selected_candidate_id"]);
  collect({ kind: "thumbnail" }, ["prompt", "selected_candidate_id"]);
  for (const scene of after.scenes) collect({ kind: "scene", id: scene.id }, sceneFields);
  return patches;
}

function referencesExist(project: ProjectData, patch: Patch): boolean {
  if (patch.target.kind === "project" && patch.field === "scene_order") return [patch.before, patch.after].every(value => Array.isArray(value)
    && value.length === project.scenes.length && value.every(id => project.scenes.some(scene => scene.id === id)));
  const target = object(project, patch.target);
  if (!target) return false;
  if (!["selected_candidate_id", "support_selected_candidate_id", "video_intro_candidate_id"].includes(patch.field)) return true;
  const candidates = (patch.field === "support_selected_candidate_id" ? target.support_candidates : target.candidates) as { id: string }[] | undefined;
  return [patch.before, patch.after].every(value => value == null || candidates?.some(candidate => candidate.id === value));
}

function apply(project: ProjectData, patches: Patch[], direction: "before" | "after"): ProjectData {
  const next = { ...project, anchor: { ...project.anchor }, thumbnail: { ...project.thumbnail }, scenes: project.scenes.map(scene => ({ ...scene })) };
  for (const patch of patches) {
    if (patch.target.kind === "project" && patch.field === "scene_order") {
      const byId = new Map(next.scenes.map(scene => [scene.id, scene]));
      next.scenes = (patch[direction] as string[]).map(id => byId.get(id)!);
      continue;
    }
    const target = object(next, patch.target)!;
    const value = structuredClone(patch[direction]);
    if (value === undefined) delete target[patch.field];
    else target[patch.field] = value;
  }
  return next;
}

// Only user-editable fields are retained. Uploads, media, signed URLs and cloud
// revisions always come from the current project when applying an inverse edit.
export class EditorHistory {
  private projectId: string | null = null;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private group = 0;
  get undoLabel() { return this.past.at(-1)?.label; }
  get redoLabel() { return this.future.at(-1)?.label; }

  reset(projectId: string | null, force = false) {
    if (!force && this.projectId === projectId) return;
    this.projectId = projectId; this.past = []; this.future = []; this.breakGroup();
  }
  breakGroup() { this.group++; }

  reconcile(project: ProjectData) {
    this.reset(project.id);
    this.past = this.past.filter(entry => entry.patches.every(patch => referencesExist(project, patch)));
    this.future = this.future.filter(entry => entry.patches.every(patch => referencesExist(project, patch)));
  }

  record(before: ProjectData, after: ProjectData, label?: string) {
    if (label) this.breakGroup();
    this.reset(after.id);
    if (!sameScenes(before, after)) { this.reset(after.id, true); return; }
    this.reconcile(after);
    const patches = patchesBetween(before, after);
    if (!patches.length) return;
    this.future = [];
    const previous = this.past.at(-1);
    const canGroup = previous?.group === this.group && previous.patches.length === patches.length
      && previous.patches.every((patch, index) => same(patch.target, patches[index].target) && patch.field === patches[index].field && same(patch.after, patches[index].before));
    if (canGroup) {
      previous.patches = patches.map((patch, index) => ({ ...patch, before: previous.patches[index].before }));
      if (previous.patches.every(patch => same(patch.before, patch.after))) this.past.pop();
    } else {
      this.past.push({ group: this.group, label: label || labels[patches[0].field] || "편집", patches });
      if (this.past.length > 50) this.past.shift();
    }
    if (label) this.breakGroup();
  }

  undo(project: ProjectData) { return this.move(project, "before"); }
  redo(project: ProjectData) { return this.move(project, "after"); }
  private move(project: ProjectData, direction: "before" | "after"): HistoryResult {
    this.reconcile(project); this.breakGroup();
    const from = direction === "before" ? this.past : this.future;
    const to = direction === "before" ? this.future : this.past;
    const entry = from.at(-1);
    if (!entry) return { status: "empty" };
    const expected = direction === "before" ? "after" : "before";
    if (!entry.patches.every(patch => same(valueAt(project, patch), patch[expected]))) {
      this.reset(project.id, true);
      return { status: "conflict" };
    }
    from.pop(); to.push(entry);
    return { status: "applied", project: apply(project, entry.patches, direction) };
  }
}
