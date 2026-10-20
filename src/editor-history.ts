import type { ProjectData, Scene } from "./types";
import { mergeSceneChanges } from "./project-changes";
import { bindComposition, compositionSignature, sceneComposition } from "./media-composition";

export interface EditOptions { history?: boolean; base?: ProjectData; label?: string; structure?: boolean }
type Target = { kind: "project" | "anchor" | "thumbnail" | "scene"; id?: string };
type Patch = { target: Target; field: string; before: unknown; after: unknown };
type Structure = { before: string[]; after: string[]; added: Scene[]; removed: Scene[] };
type Entry = { group: number; label: string; patches: Patch[]; structure?: Structure };
export type HistoryResult = { status: "empty" | "conflict" } | { status: "applied"; project: ProjectData };

const sceneFields = ["number", "subtitle", "title", "caption", "captions", "narration", "composition", "split_origin", "merge_origin", "source_scene_ids", "emphasis_offset_sec", "prompt", "duration", "start_sec", "end_sec", "motion", "music_volume", "video_intro_candidate_id", "video_intro_duration_sec", "video_trim_start_sec", "video_trim_end_sec", "support_start_sec", "selected_candidate_id", "support_selected_candidate_id", "support_image_prompt"];
const candidateField = (field: string) => field === "candidates" || field === "support_candidates";
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
const valueAt = (project: ProjectData, patch: Pick<Patch, "target" | "field">) => patch.target.kind === "project" && patch.field === "scene_order" ? sceneOrder(project)
  : patch.target.kind === "project" && patch.field === "core_scene_ids" ? project.editor?.core_scene_ids
    : patch.target.kind === "scene" && patch.field === "visual_composition" ? project.scenes.find(scene => scene.id === patch.target.id)?.composition?.visuals : object(project, patch.target)?.[patch.field];

function patchesBetween(before: ProjectData, after: ProjectData, structure = false): Patch[] {
  const patches: Patch[] = [];
  if (!structure && !same(sceneOrder(before), sceneOrder(after))) patches.push({ target: { kind: "project" }, field: "scene_order", before: sceneOrder(before), after: sceneOrder(after) });
  if (!same(before.editor?.core_scene_ids, after.editor?.core_scene_ids)) patches.push({ target: { kind: "project" }, field: "core_scene_ids", before: before.editor?.core_scene_ids, after: after.editor?.core_scene_ids });
  const collect = (target: Target, fields: string[]) => {
    const left = object(before, target); const right = object(after, target);
    if (!left || !right) return;
    for (const field of fields) if (!same(left[field], right[field])) patches.push({ target, field, before: structuredClone(left[field]), after: structuredClone(right[field]) });
  };
  collect({ kind: "project" }, ["style_guide", "character_profile", "ending_message"]);
  collect({ kind: "anchor" }, ["prompt", "selected_candidate_id"]);
  collect({ kind: "thumbnail" }, ["prompt", "selected_candidate_id"]);
  for (const scene of after.scenes) {
    const fields = structure ? sceneFields : sceneFields.filter(field => field !== "composition");
    collect({ kind: "scene", id: scene.id }, structure ? [...fields, "narration_audio", "candidates", "support_candidates"] : fields);
    if (!structure && scene.composition?.mode === "segments") {
      const target: Target = { kind: "scene", id: scene.id }; const field = "visual_composition";
      const left = valueAt(before, { target, field }); const right = valueAt(after, { target, field });
      if (!same(left, right)) patches.push({ target, field, before: structuredClone(left), after: structuredClone(right) });
    }
  }
  return patches;
}

function referencesExist(project: ProjectData, patch: Patch): boolean {
  if (patch.target.kind === "project" && patch.field === "scene_order") return [patch.before, patch.after].every(value => Array.isArray(value)
    && value.every(id => project.scenes.some(scene => scene.id === id)));
  const target = object(project, patch.target);
  if (!target) return false;
  if (!["selected_candidate_id", "support_selected_candidate_id", "video_intro_candidate_id"].includes(patch.field)) return true;
  const candidates = (patch.field === "support_selected_candidate_id" ? target.support_candidates : target.candidates) as { id: string }[] | undefined;
  return [patch.before, patch.after].every(value => value == null || candidates?.some(candidate => candidate.id === value));
}

function apply(project: ProjectData, patches: Patch[], direction: "before" | "after"): ProjectData {
  const next = { ...project, anchor: { ...project.anchor }, thumbnail: { ...project.thumbnail }, scenes: project.scenes.map(scene => ({ ...scene })) };
  const visuals = new Map<string, NonNullable<Scene["composition"]>["visuals"]>();
  for (const patch of patches) {
    if (patch.target.kind === "scene" && patch.field === "visual_composition") {
      visuals.set(patch.target.id!, structuredClone(patch[direction]) as NonNullable<Scene["composition"]>["visuals"]);
      continue;
    }
    if (patch.target.kind === "project" && patch.field === "core_scene_ids") {
      next.editor = { ...next.editor, core_scene_ids: structuredClone(patch[direction]) as string[] };
      continue;
    }
    if (patch.target.kind === "project" && patch.field === "scene_order") {
      const byId = new Map(next.scenes.map(scene => [scene.id, scene]));
      next.scenes = (patch[direction] as string[]).map(id => byId.get(id)!);
      continue;
    }
    const target = object(next, patch.target)!;
    const value = structuredClone(patch[direction]);
    if (patch.target.kind === "scene" && candidateField(patch.field)) {
      const expected = direction === "before" ? "after" : "before";
      const before = { [patch.field]: patch[expected] || [] } as unknown as Scene;
      const after = { [patch.field]: value || [] } as unknown as Scene;
      const merged = mergeSceneChanges(before, after, target as unknown as Scene)[patch.field as "candidates" | "support_candidates"];
      if (value === undefined && !merged?.length) delete target[patch.field]; else target[patch.field] = merged;
      continue;
    }
    if (value === undefined) delete target[patch.field];
    else target[patch.field] = value;
  }
  for (const scene of next.scenes) if (visuals.has(scene.id)) scene.composition = bindComposition(scene, { ...sceneComposition(scene), visuals: visuals.get(scene.id)! });
  return next;
}

// Shared scenes use field patches; structural entries retain added/removed
// scenes for redo. The original-media registry and cloud revisions stay current.
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

  reconcile(project: ProjectData, detached: Scene[] = []) {
    this.reset(project.id);
    // A nested split can reference a child temporarily absent after undoing its
    // parent split. Keep that history while an entry can restore the child.
    const scenes = new Map([...detached, ...[...this.past, ...this.future].flatMap(entry => [...(entry.structure?.added || []), ...(entry.structure?.removed || [])])].map(scene => [scene.id, scene]));
    for (const scene of project.scenes) scenes.set(scene.id, scene);
    const available = { ...project, scenes: [...scenes.values()] };
    this.past = this.past.filter(entry => entry.patches.every(patch => referencesExist(available, patch)));
    this.future = this.future.filter(entry => entry.patches.every(patch => referencesExist(available, patch)));
  }

  record(before: ProjectData, after: ProjectData, label?: string, structural = false) {
    if (label) this.breakGroup();
    this.reset(after.id);
    if (!structural && !sameScenes(before, after)) { this.reset(after.id, true); return; }
    const structure: Structure | undefined = structural ? { before: sceneOrder(before), after: sceneOrder(after),
      added: structuredClone(after.scenes.filter(scene => !before.scenes.some(item => item.id === scene.id))),
      removed: structuredClone(before.scenes.filter(scene => !after.scenes.some(item => item.id === scene.id))) } : undefined;
    this.reconcile(after, structure?.removed);
    const patches = patchesBetween(before, after, structural);
    if (!patches.length && !structure) return;
    this.future = [];
    const previous = this.past.at(-1);
    const canGroup = !structure && !previous?.structure && previous?.group === this.group && previous.patches.length === patches.length
      && previous.patches.every((patch, index) => same(patch.target, patches[index].target) && patch.field === patches[index].field && same(patch.after, patches[index].before));
    if (canGroup) {
      previous.patches = patches.map((patch, index) => ({ ...patch, before: previous.patches[index].before }));
      if (previous.patches.every(patch => same(patch.before, patch.after))) this.past.pop();
    } else {
      this.past.push({ group: this.group, label: label || labels[patches[0]?.field] || "편집", patches, structure });
      if (this.past.length > 50) this.past.shift();
    }
    if (label) this.breakGroup();
  }

  undo(project: ProjectData) { return this.move(project, "before"); }
  redo(project: ProjectData) { return this.move(project, "after"); }
  captureDetachedScene(projectId: string, base: Scene | undefined, next: Scene) {
    if (this.projectId !== projectId) return;
    for (const entry of [...this.past, ...this.future]) for (const kind of ["added", "removed"] as const) {
      const scenes = entry.structure?.[kind];
      const index = scenes?.findIndex(scene => scene.id === next.id) ?? -1;
      if (scenes && index >= 0) scenes[index] = mergeSceneChanges(base, next, scenes[index]);
    }
  }
  private move(project: ProjectData, direction: "before" | "after"): HistoryResult {
    this.reconcile(project); this.breakGroup();
    const from = direction === "before" ? this.past : this.future;
    const to = direction === "before" ? this.future : this.past;
    const entry = from.at(-1);
    if (!entry) return { status: "empty" };
    const expected = direction === "before" ? "after" : "before";
    const matches = (patch: Patch) => {
      if (patch.target.kind === "scene" && candidateField(patch.field)) return ((patch[expected] || []) as { id: string }[]).every(item => ((valueAt(project, patch) || []) as { id: string }[]).some(current => current.id === item.id));
      if (patch.target.kind === "scene" && patch.field === "composition") {
        const scene = project.scenes.find(item => item.id === patch.target.id)!;
        const current = scene?.composition; const previous = patch[expected] as Scene["composition"];
        // A retained upload can change the legacy automatic intro image after
        // undo. Its derived single-section composition is not an independent edit.
        if (current && previous && !current.mode && !previous.mode && current.visuals.length <= 1 && previous.visuals.length <= 1 && current.narrations.length <= 1 && previous.narrations.length <= 1
          && current.source_signature !== previous.source_signature && current.source_signature === compositionSignature(scene)) return true;
      }
      return same(valueAt(project, patch), patch[expected]);
    };
    if ((entry.structure && !same(sceneOrder(project), entry.structure[expected])) || !entry.patches.every(matches)) {
      this.reset(project.id, true);
      return { status: "conflict" };
    }
    let current = project;
    if (entry.structure) {
      const departing = direction === "before" ? "added" : "removed";
      entry.structure[departing] = entry.structure[departing].map(scene => structuredClone(project.scenes.find(item => item.id === scene.id) || scene));
      const available = new Map([...entry.structure.added, ...entry.structure.removed, ...project.scenes].map(scene => [scene.id, scene]));
      current = { ...project, scenes: entry.structure[direction].map(id => structuredClone(available.get(id)!)) };
    }
    from.pop(); to.push(entry);
    return { status: "applied", project: apply(current, entry.patches, direction) };
  }
}
