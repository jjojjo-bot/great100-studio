import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { reportForProject, validateAppData } from "./app-data";
import { assertEditorWrite, readEditorProject } from "./editor-format";
import { EditorHistory } from "./editor-history";
import { buildVideoPlan } from "./video";
import { mergeProjectChanges } from "./project-changes";

it.each([1, "2.0", "2.1"] as const)("upgrades %s in memory without changing source, timing, media paths or unknown fields", version => {
  const original = version === 1 ? createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT) : editorProject(version);
  delete original.editor_version; delete original.editor;
  for (const scene of original.scenes) { delete scene.source_scene_ids; for (const block of scene.captions || []) delete block.id; }
  const raw = JSON.parse(JSON.stringify({ ...original, future: { preserved: true } }));
  const before = structuredClone(raw);
  const first = readEditorProject(raw);
  expect(raw).toEqual(before);
  expect(first).toMatchObject({ id: raw.id, schema_version: version, editor_version: 1, future: { preserved: true }, source_text: raw.source_text });
  expect(first.source).toEqual(raw.source);
  expect(first.scenes.map(s => [s.id, s.number, s.duration, s.start_sec, s.end_sec])).toEqual(raw.scenes.map((s: typeof first.scenes[number]) => [s.id, s.number, s.duration, s.start_sec, s.end_sec]));
  expect(first).toEqual(readEditorProject(first));
  expect(reportForProject(first).errors).toEqual([]);
});

it("keeps editor identities independent from import order rules and preserves the core achievement mapping", () => {
  const project = editorProject();
  project.scenes[1].id = "stable-scene-uuid";
  project.editor!.core_scene_ids = ["stable-scene-uuid"];
  project.scenes[1].number = 8;
  expect(reportForProject(project).errors).toEqual([]);
  expect(reportForProject(project).metrics.coreScenes).toBe(1);
  expect(project.source!.core_achievement.scene_id).toBe("scene_02");
  const source = structuredClone(project.source!);
  source.scenes[1].id = "stable-scene-uuid";
  expect(validateAppData(source).errors.some(error => error.includes("누락"))).toBe(true);
  project.editor!.core_scene_ids = ["removed"];
  expect(reportForProject(project).errors.some(error => error.includes("핵심 업적"))).toBe(true);
});

it("still rejects caption overlap, missing narration, duplicate identities and inconsistent durations after editing", () => {
  const project = editorProject();
  const scene = project.scenes[0];
  scene.captions = [{ ...scene.captions![0], end_sec: 8 }, { ...scene.captions![0], text: "다음", start_sec: 7 }];
  scene.duration = 15;
  scene.narration = "";
  project.scenes[1].id = scene.id;
  const errors = reportForProject(project).errors.join("\n");
  expect(errors).toContain("장면 ID"); expect(errors).toContain("자막 ID");
  expect(errors).toContain("겹치거나"); expect(errors).toContain("narration");
  expect(errors).toContain("일치하지 않습니다");
});

it("retains caption IDs across field merges, undo/redo and JSON reopen", () => {
  const original = editorProject();
  const changed = structuredClone(original);
  changed.scenes[0].captions![0].text = "수정한 문구";
  const history = new EditorHistory(); history.record(original, changed);
  const undo = history.undo(changed);
  expect(undo.status).toBe("applied");
  if (undo.status !== "applied") throw new Error("undo failed");
  const redo = history.redo(undo.project);
  if (redo.status !== "applied") throw new Error("redo failed");
  const reopened = readEditorProject(JSON.parse(JSON.stringify(redo.project)));
  expect(reopened.scenes[0].captions![0]).toEqual(changed.scenes[0].captions![0]);
  expect(reopened.source).toEqual(original.source);
});

it("merges a late caption timing change without replacing the user's newer caption text", () => {
  const base = editorProject();
  const current = structuredClone(base);
  current.scenes[0].captions![0].text = "새로 편집한 자막";
  const late = structuredClone(base);
  late.scenes[0].captions![0].end_sec = 8;
  const merged = mergeProjectChanges(base, late, current);
  expect(merged.scenes[0].captions![0]).toMatchObject({
    id: base.scenes[0].captions![0].id, text: "새로 편집한 자막", end_sec: 8,
  });
});

it("blocks future formats, format downgrades and source replacement", () => {
  const project = editorProject();
  const future = { ...project, editor_version: 3 };
  expect(readEditorProject(future)).toBe(future);
  expect(() => assertEditorWrite(future)).toThrow("새로운 편집 형식");
  expect(() => assertEditorWrite({ ...project, editor_version: undefined }, project)).toThrow("더 최신");
  expect(() => assertEditorWrite({ ...project, source_text: "다른 제작안" }, project)).toThrow("원본 제작안");
  expect(reportForProject({ ...project, source: undefined }).errors).toContain("원본 APP_DATA가 없습니다. 원본 제작안으로 새 프로젝트를 만들어 주세요.");
});

it("accepts JSONB object key reordering while rejecting changed source content", () => {
  const project = editorProject();
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const stored = { ...project, source: reorder(project.source) as typeof project.source };
  expect(() => assertEditorWrite(project, stored)).not.toThrow();
  const changed = structuredClone(project); changed.source!.scenes[0].narration = "원문 교체";
  expect(() => assertEditorWrite(changed, stored)).toThrow("원본 제작안");
});

it("preserves the existing render plan when a legacy source has timing gaps", () => {
  const original = editorProject();
  delete original.editor_version; delete original.editor;
  original.scenes.forEach((scene, index) => {
    delete scene.source_scene_ids;
    if (index) { scene.start_sec! += 2; scene.end_sec! += 2; }
    for (const block of scene.captions || []) { delete block.id; if (index) { block.start_sec += 2; block.end_sec += 2; } }
    scene.candidates = [{ id: `image-${index}`, path: "original.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" }];
    scene.selected_candidate_id = `image-${index}`;
  });
  const before = buildVideoPlan(original);
  const upgraded = readEditorProject(original);
  const after = buildVideoPlan(upgraded);
  for (const segment of after) for (const block of segment.timedCaptions || []) delete block.id;
  expect(after).toEqual(before);
  expect(upgraded.scenes[1].start_sec).toBe(12);
  expect(original.source!.scenes[1].start_sec).toBe(10);
});
