import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { buildProjectZip, deleteProject, listProjects, saveProject } from "./platform";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => { vi.stubGlobal("window", {}); vi.stubGlobal("indexedDB", new IDBFactory()); native.invoke.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function legacy() {
  const project = editorProject();
  delete project.editor_version; delete project.editor;
  for (const scene of project.scenes) { delete scene.source_scene_ids; for (const block of scene.captions || []) delete block.id; }
  return { ...project, extra: { retained: "future field" } };
}

it("backs up a legacy project on first save, preserves editor fields on reopen/ZIP, and rejects obsolete local readers", async () => {
  const original = legacy();
  const old = await openDB("great100-studio", 5, { upgrade(db) {
    for (const name of ["projects", "videos", "audio", "media"]) db.createObjectStore(name, { keyPath: "id" });
    db.createObjectStore("settings");
  } });
  await old.put("projects", original); old.close();
  const [project] = await listProjects();
  const db = await openDB("great100-studio", 6);
  expect(await db.get("projects", original.id)).toEqual(original);
  expect(await db.get("settings", `editor-backup:${original.id}:0`)).toBeUndefined();
  const captionId = project.scenes[0].captions![0].id;
  project.scenes[0].captions![0].text = "앱에서 편집";
  await saveProject(project);
  await saveProject({ ...project, ending_message: "편집한 엔딩" });
  expect(await db.get("settings", `editor-backup:${original.id}:0`)).toEqual(original);
  const [reopened] = await listProjects();
  expect(reopened.scenes[0].captions![0]).toMatchObject({ id: captionId, text: "앱에서 편집" });
  expect(reopened.source).toEqual(original.source);
  expect(reopened).toMatchObject({ editor_version: 1, extra: original.extra });
  const zip = await JSZip.loadAsync(await (await buildProjectZip(reopened)).arrayBuffer());
  const data = JSON.parse(await zip.file(`${project.folder_name}/project_data.json`)!.async("string"));
  const source = JSON.parse(await zip.file(`${project.folder_name}/01_source/app_data.json`)!.async("string"));
  expect(source).toEqual(original.source);
  expect(data.scenes[0].captions[0]).toEqual(reopened.scenes[0].captions![0]);
  expect(data).toMatchObject({ editor_version: 1, extra: original.extra, editor: project.editor });
  await expect(openDB("great100-studio", 5)).rejects.toMatchObject({ name: "VersionError" });
  await expect(saveProject(original)).rejects.toThrow("더 최신");
  await expect(saveProject({ ...reopened, source_text: "원문 교체" })).rejects.toThrow("원본 제작안");
  expect((await db.get("projects", original.id)).source_text).toBe(original.source_text);
  await deleteProject(reopened);
  expect(await db.get("settings", `editor-backup:${original.id}:0`)).toBeUndefined();
  db.close();
});

it("retains newer projects in the list but refuses to overwrite their format", async () => {
  const project = { ...editorProject(), editor_version: 3 };
  await listProjects();
  const db = await openDB("great100-studio", 6);
  await db.put("projects", project);
  expect((await listProjects())[0]).toEqual(project);
  await expect(saveProject(project)).rejects.toThrow("새로운 편집 형식");
  expect(await db.get("projects", project.id)).toEqual(project);
  db.close();
});

it("passes editor identities, original source and unknown fields through Tauri JSON commands", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  const original = legacy();
  native.invoke.mockResolvedValueOnce([original]).mockResolvedValueOnce(undefined);
  const [project] = await listProjects();
  await saveProject(project);
  const [command, args] = native.invoke.mock.calls[1];
  expect(command).toBe("save_project");
  expect(args.project).toMatchObject({ editor_version: 1, extra: original.extra, source: original.source, editor: project.editor });
  expect(args.project.scenes[0].captions[0].id).toBe(project.scenes[0].captions![0].id);
});
