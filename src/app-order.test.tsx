// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ImageCandidate, ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), generate: vi.fn(), inspect: vi.fn(), store: vi.fn(), discard: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save,
  generateImages: mock.generate, inspectSceneNarration: mock.inspect, savePreparedNarration: mock.store, discardSceneNarration: mock.discard,
  getSceneNarration: async () => new Blob(["voice"]), isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const lastSaved = (): ProjectData => mock.save.mock.calls.at(-1)![0];
const moveBack = () => fireEvent.click(screen.getByRole("button", { name: "이 장면을 뒤로 이동" }));
const undo = () => fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
const redo = () => fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:voice"; static revokeObjectURL = () => {}; });
  const draft = editorProject();
  for (const [index, scene] of draft.scenes.entries()) {
    scene.title = `이야기 ${index + 1}`;
    scene.candidates = [{ id: `image-${index}`, path: `projects/original/03_images/scene0${index + 1}/image.png`, preview_url: "data:image/png;base64,a", mode: "uploaded", created_at: "now" }];
    scene.selected_candidate_id = `image-${index}`;
  }
  project = prepareEditorWrite(draft); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined);
  mock.generate.mockResolvedValue([]); mock.inspect.mockImplementation(async file => ({ file, duration: 14, extension: "wav", mime: "audio/wav" }));
  mock.discard.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
}
function tabTitles() { return [...screen.getByRole("navigation", { name: "장면 이동" }).querySelectorAll(".scene-tabs button")].map(button => button.textContent); }

function addBoundary() {
  project.scenes[0].captions = [{ id: "first", text: "앞 문구", start_sec: 0, end_sec: 3 }, { id: "second", text: "뒤 문구", start_sec: 3.1, end_sec: 10 }];
  project.scenes[0].narration = "앞 문구 뒤 문구";
}

it("merges the active scene with the next and restores the original candidate palettes, captions and core link", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" }));
  expect(tabTitles()).toEqual(["1이야기 1 · 이야기 2", "2이야기 3"]);
  expect(lastSaved().editor_version).toBe(5); expect(lastSaved().scenes[0].composition!.visuals).toHaveLength(2);
  expect(lastSaved().scenes[0].captions!.map(block => block.id)).toEqual([project.scenes[0].captions![0].id, project.scenes[1].captions![0].id]);
  expect(lastSaved().editor?.core_scene_ids).toEqual(["scene_01"]);
  undo(); expect(tabTitles()).toEqual(["1이야기 1", "2이야기 2", "3이야기 3"]);
  expect(lastSaved().scenes[0].candidates).toEqual(project.scenes[0].candidates); expect(lastSaved().scenes[1].candidates).toEqual(project.scenes[1].candidates);
  expect(lastSaved().editor?.core_scene_ids).toEqual(project.editor?.core_scene_ids);
  redo(); expect(tabTitles()).toHaveLength(2);
});

it("retains the merged-away scene's late generation in the merged palette and restores it on undo", async () => {
  let finish!: (candidates: ImageCandidate[]) => void;
  mock.generate.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "다음 Scene" }));
  fireEvent.click(screen.getByRole("button", { name: "예시 2장 만들기" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "이전 Scene" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" }));
  const expected = structuredClone(lastSaved().scenes[0].composition);
  const candidate: ImageCandidate = { id: "merged-late", path: "projects/original/scene02/late.png", preview_url: "data:image/png;base64,a", mode: "openai", created_at: "now" };
  await act(async () => finish([candidate]));
  expect(lastSaved().scenes).toHaveLength(2); expect(lastSaved().scenes[0].candidates).toContainEqual(candidate);
  expect(lastSaved().scenes[0].composition).toEqual(expected);
  undo(); expect(lastSaved().scenes).toHaveLength(3); expect(lastSaved().scenes[1].candidates).toContainEqual(candidate);
  redo(); expect(lastSaved().scenes[0].composition).toEqual(expected);
});

it("disables merging at the last scene and above 120 seconds", async () => {
  project.scenes[0].duration = 120; project.scenes[0].end_sec = 120; project.scenes[0].captions![0].end_sec = 120;
  for (const scene of project.scenes.slice(1)) { scene.start_sec! += 110; scene.end_sec! += 110; scene.captions!.forEach(block => { block.start_sec += 110; block.end_sec += 110; }); }
  await open();
  expect(screen.getByRole("button", { name: "다음 장면과 합치기" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다음 Scene" })); fireEvent.click(screen.getByRole("button", { name: "다음 Scene" }));
  expect(screen.getByRole("button", { name: "다음 장면과 합치기" }).hasAttribute("disabled")).toBe(true);
});

it("splits at the selected caption, retains the active left scene, and restores both sides in one undo/redo", async () => {
  addBoundary(); await open();
  expect(screen.getByLabelText("장면을 나눌 자막 경계")).toHaveProperty("value", "second");
  fireEvent.click(screen.getByRole("button", { name: "장면 나누기" }));
  expect(tabTitles()).toEqual(["1이야기 1", "2이야기 1 · 이어짐", "3이야기 2", "4이야기 3"]);
  expect(screen.getByRole("heading", { name: "이야기 1" })).toBeTruthy();
  expect(lastSaved().scenes[0].captions?.map(block => block.id)).toEqual(["first"]);
  expect(lastSaved().scenes[1].captions?.map(block => block.id)).toEqual(["second"]);
  expect(lastSaved().editor_version).toBe(4); expect(lastSaved().source).toEqual(project.source);
  undo(); expect(tabTitles()).toEqual(["1이야기 1", "2이야기 2", "3이야기 3"]);
  expect(lastSaved().scenes[0].captions).toEqual(project.scenes[0].captions);
  redo(); expect(tabTitles()).toHaveLength(4);
});

it("retains late generation on an undone child for redo without resurrecting that scene", async () => {
  addBoundary(); let finish!: (candidates: ImageCandidate[]) => void;
  mock.generate.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "장면 나누기" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 Scene" }));
  fireEvent.click(screen.getByRole("button", { name: "예시 2장 만들기" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  undo(); expect(tabTitles()).toHaveLength(3);
  const candidate: ImageCandidate = { id: "detached", path: "projects/original/detached.png", preview_url: "data:image/png;base64,a", mode: "openai", created_at: "now" };
  await act(async () => finish([candidate]));
  expect(lastSaved().scenes).toHaveLength(3);
  expect(lastSaved().media?.assets.some(asset => asset.id === "candidate:detached")).toBe(true);
  redo(); expect(lastSaved().scenes).toHaveLength(4);
  expect(lastSaved().scenes[1].candidates).toContainEqual(candidate);
});

it("disables splitting when there is no usable caption boundary", async () => {
  await open(); expect(screen.getByRole("button", { name: "장면 나누기" }).hasAttribute("disabled")).toBe(true);
});

it("moves the active scene, retains a previous caption edit and undoes each operation separately", async () => {
  await open();
  expect(screen.getByRole("button", { name: "이 장면을 앞으로 이동" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Caption 1 텍스트"), { target: { value: "이동 전에 편집한 문구" } });
  moveBack();
  expect(tabTitles()).toEqual(["1이야기 2", "2이야기 1", "3이야기 3"]);
  expect(screen.getByRole("heading", { name: "이야기 1" })).toBeTruthy();
  expect(screen.getByLabelText("Caption 1 시작")).toHaveProperty("value", "10");
  expect(lastSaved().scenes[1].captions![0].text).toBe("이동 전에 편집한 문구");
  expect(lastSaved().source).toEqual(project.source);
  expect(lastSaved().media).toEqual(project.media);
  undo(); expect(tabTitles()).toEqual(["1이야기 1", "2이야기 2", "3이야기 3"]);
  expect(screen.getByLabelText("Caption 1 시작")).toHaveProperty("value", "0");
  expect(screen.getByLabelText("Caption 1 텍스트")).toHaveProperty("value", "이동 전에 편집한 문구");
  undo(); expect(screen.getByLabelText("Caption 1 텍스트")).toHaveProperty("value", project.scenes[0].captions![0].text);
  redo(); redo(); expect(tabTitles()).toEqual(["1이야기 2", "2이야기 1", "3이야기 3"]);
  moveBack(); expect(screen.getByRole("button", { name: "이 장면을 뒤로 이동" }).hasAttribute("disabled")).toBe(true);
  await waitFor(() => expect(lastSaved().scenes[2].id).toBe(project.scenes[0].id));
});

it("keeps a generation result started before the move on the same scene through undo and redo", async () => {
  let finish!: (candidates: ImageCandidate[]) => void;
  mock.generate.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "예시 2장 만들기" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  moveBack();
  const candidate: ImageCandidate = { id: "late", path: "projects/original/03_images/scene01/late.png", preview_url: "data:image/png;base64,a", mode: "openai", created_at: "now" };
  await act(async () => finish([candidate]));
  expect(lastSaved().scenes.map(scene => scene.id)).toEqual(["scene_02", "scene_01", "scene_03"]);
  expect(lastSaved().scenes[1].candidates).toContainEqual(candidate);
  expect(lastSaved().scenes[1].captions![0]).toMatchObject({ start_sec: 10, end_sec: 20 });
  expect(mock.generate.mock.calls[0][0].scene_number).toBe(1);
  undo(); expect(lastSaved().scenes[0].candidates).toContainEqual(candidate);
  expect(lastSaved().scenes[0].captions![0]).toMatchObject({ start_sec: 0, end_sec: 10 });
  redo(); expect(lastSaved().scenes[1].candidates).toContainEqual(candidate);
});

it("keeps a failed move visible and retries the new order without losing its undo", async () => {
  mock.save.mockRejectedValueOnce(new Error("connection lost"));
  await open(); moveBack();
  await screen.findByRole("alert");
  expect(tabTitles()[0]).toBe("1이야기 2");
  fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "저장 다시 시도" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(lastSaved().scenes[0].id).toBe("scene_02");
  undo(); expect(lastSaved().scenes[0].id).toBe("scene_01");
});

it("rechecks a pending audio apply when scene order changes during file storage", async () => {
  let finish!: (value: object) => void;
  mock.store.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await open();
  fireEvent.change(screen.getByLabelText("Scene 1 내레이션 파일 선택"), { target: { files: [new File(["voice"], "voice.wav", { type: "audio/wav" })] } });
  await screen.findByRole("region", { name: "녹음 길이 조정안" });
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(mock.store).toHaveBeenCalledOnce());
  moveBack();
  await act(async () => finish({ id: "voice", name: "voice.wav", path: "projects/original/01_source/media/voice.wav", mime_type: "audio/wav", duration_sec: 14 }));
  expect(screen.getByText(/시간이나 녹음이 변경되었습니다/)).toBeTruthy();
  expect(lastSaved().scenes[1].narration_audio).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(lastSaved().scenes[1].duration).toBe(14));
  expect(lastSaved().scenes.map(scene => scene.id)).toEqual(["scene_02", "scene_01", "scene_03"]);
  expect(lastSaved().scenes.map(scene => scene.start_sec)).toEqual([0, 10, 24]);
  expect(mock.store).toHaveBeenCalledOnce(); expect(mock.discard).not.toHaveBeenCalled();
});
