import { beforeEach, afterEach, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { createProjectDraft } from "./parser";
import { createNumberedProject, deleteProject, getNextProjectEpisode, listProjects } from "./platform";
import { SAMPLE_WORK_TEXT } from "./sample";

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => vi.unstubAllGlobals());
const draft = () => createProjectDraft(1, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);

it("reserves distinct consecutive numbers for concurrent project creation", async () => {
  expect(await getNextProjectEpisode()).toBe(1);
  const projects = await Promise.all([createNumberedProject(draft()), createNumberedProject(draft())]);
  expect(projects.map((project) => project.episode).sort()).toEqual([1, 2]);
  expect(new Set(projects.map((project) => project.project_path)).size).toBe(2);
  expect((await listProjects()).length).toBe(2);
  expect(await getNextProjectEpisode()).toBe(3);
});

it("does not reuse an issued number after its project is deleted", async () => {
  const project = await createNumberedProject(draft());
  await deleteProject(project);
  expect(await getNextProjectEpisode()).toBe(2);
  expect((await createNumberedProject(draft())).episode).toBe(2);
});

it("continues after the highest existing number when upgrading older stored projects", async () => {
  const db = await openDB("great100-studio", 4, { upgrade(db) {
    for (const name of ["projects", "videos", "audio", "media"]) db.createObjectStore(name, { keyPath: "id" });
  } });
  const existing = { ...draft(), episode: 7, folder_name: "007_이순신", project_path: "projects/007_이순신" };
  await db.put("projects", existing);
  db.close();
  expect(await getNextProjectEpisode()).toBe(8);
  const created = await createNumberedProject(draft());
  expect(created.episode).toBe(8);
  expect(created.folder_name).toBe("008_이순신");
  expect((await listProjects()).find((project) => project.id === existing.id)?.episode).toBe(7);
});

it("explains a blocked upgrade instead of leaving numbering pending behind an older tab", async () => {
  const oldTab = await openDB("great100-studio", 4);
  try {
    await expect(getNextProjectEpisode()).rejects.toThrow("다른 탭");
  } finally {
    oldTab.close();
  }
});
