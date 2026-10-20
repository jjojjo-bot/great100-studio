// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { MediaCheckItem } from "./export-media-check";
import type { ProjectData } from "./types";
import App from "./App";
const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), inspect: vi.fn(), generate: vi.fn(), upload: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./export-media-reader", () => ({ inspectExportMedia: mock.inspect }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, generateImages: mock.generate, importImageCandidates: mock.upload, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  project = editorProject(); project.scenes.forEach((scene, i) => { scene.title = `점검 장면 ${i + 1}`; scene.candidates = [0, 1].map(n => ({ id: `image-${i}-${n}`, path: `image-${i}-${n}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" })); scene.selected_candidate_id = `image-${i}-0`; });
  project.thumbnail.candidates = [{ id: "thumb", path: "thumb.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" }]; project.thumbnail.selected_candidate_id = "thumb";
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.inspect.mockResolvedValue("원본 확인");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const panel = () => screen.getByRole("region", { name: "MP4 출력 전 자료 점검" });
const start = () => fireEvent.click(within(panel()).getByRole("button", { name: "전체 출력 자료 점검" }));
const result = () => within(panel()).getByRole("status").textContent;
const failSecond = () => mock.inspect.mockImplementation(async (_p: ProjectData, item: MediaCheckItem) => { if (item.asset.id === "candidate:image-1-0") throw new Error("원본 읽기 실패"); return "원본 확인"; });
async function open() { render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" })); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); }
async function checked() { await waitFor(() => expect(result()).toContain("점검 완료")); }

it("does not read or save files until requested, checks only active files and treats narration as optional", async () => {
  await open(); expect(mock.inspect).not.toHaveBeenCalled(); expect(panel().textContent).toContain("아직 점검하지 않았습니다"); start(); await checked();
  expect(result()).toContain("통과 4 · 파일 문제 0 · 연결·설정 문제 0"); expect(mock.inspect).toHaveBeenCalledTimes(4); expect(mock.inspect.mock.calls.some(c => c[1].asset.id.endsWith("-1"))).toBe(false);
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
});
it("collects every failure and retries only the failed file without writing the project", async () => {
  failSecond(); await open(); start(); await checked(); expect(result()).toContain("파일 문제 1"); expect(within(panel()).getByRole("alert").textContent).toContain("원본 읽기 실패");
  mock.inspect.mockResolvedValue("원본 확인"); fireEvent.click(within(panel()).getByRole("button", { name: "실패한 자료만 재검사" })); await waitFor(() => expect(result()).toContain("파일 문제 0"));
  expect(mock.inspect).toHaveBeenCalledTimes(5); expect(mock.inspect.mock.calls[4][1].asset.id).toBe("candidate:image-1-0"); expect(mock.save).not.toHaveBeenCalled();
});
it("opens the exact failed scene, retains results on return and invalidates a changed visual", async () => {
  failSecond(); await open(); start(); await checked(); fireEvent.click(within(panel()).getByRole("button", { name: "Scene 2 · 점검 장면 2 편집" }));
  expect(screen.getByRole("heading", { name: "점검 장면 2" })).toBeTruthy(); fireEvent.click(document.querySelector<HTMLButtonElement>(".candidate:not(.selected)")!);
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole("button", { name: "자료 점검으로 돌아가기" }));
  await waitFor(() => expect(result()).toContain("다시 점검해 주세요")); expect(mock.inspect).toHaveBeenCalledTimes(4); expect(panel().textContent).not.toContain("원본 읽기 실패");
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("전체 출력 자료 점검")); mock.inspect.mockResolvedValue("원본 확인"); start(); await checked(); expect(result()).toContain("파일 문제 0");
});
it("opens thumbnail and music editors from failures and returns without downloading again", async () => {
  project.background_music = { id: "music", path: "music.wav", name: "music.wav", mime_type: "audio/wav" }; project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]);
  mock.inspect.mockRejectedValue(new Error("자료 누락")); await open(); start(); await checked(); fireEvent.click(within(panel()).getByRole("button", { name: "썸네일 편집" }));
  expect(screen.getByRole("heading", { name: "썸네일 만들기" })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "자료 점검으로 돌아가기" })); await checked();
  fireEvent.click(within(panel()).getByRole("button", { name: "배경음악 편집" })); expect(screen.getByText("영상 배경음악")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "자료 점검으로 돌아가기" })); await checked(); expect(mock.inspect).toHaveBeenCalledTimes(5);
});
it("stops pending checks and ignores late responses", async () => {
  let finish!: (message: string) => void;
  mock.inspect.mockImplementationOnce((_p: ProjectData, _item: MediaCheckItem, signal: AbortSignal) => new Promise<string>((resolve, reject) => { finish = resolve; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }));
  await open(); start(); await waitFor(() => expect(mock.inspect).toHaveBeenCalledOnce()); fireEvent.click(within(panel()).getByRole("button", { name: "점검 중단" }));
  await waitFor(() => expect(result()).toContain("중단했습니다")); await act(async () => finish("늦은 성공")); expect(result()).not.toContain("점검 완료"); expect(mock.inspect).toHaveBeenCalledOnce();
  start(); await checked(); expect(result()).toContain("통과 4");
});
it("keeps project diagnoses isolated when switching projects", async () => {
  const second = structuredClone(project); second.id = "another-project"; second.person = "다른 인물"; mock.list.mockResolvedValue([project, second]);
  render(<App />); fireEvent.click((await screen.findAllByRole("button", { name: "이어 작업하기" }))[0]); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); start(); await checked();
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ })); fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[1]); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(panel().textContent).toContain("아직 점검하지 않았습니다"); expect(mock.inspect).toHaveBeenCalledTimes(4); expect(mock.save).not.toHaveBeenCalled();
});

it("discards an in-flight diagnosis when editing changes the export plan", async () => {
  mock.inspect.mockImplementationOnce((_p: ProjectData, _item: MediaCheckItem, signal: AbortSignal) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  await open(); start(); await waitFor(() => expect(mock.inspect).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" })); fireEvent.click(screen.getByRole("button", { name: "이 장면을 뒤로 이동" })); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" })); await waitFor(() => expect(result()).toContain("중단했습니다")); expect(mock.inspect).toHaveBeenCalledOnce();
  start(); await checked(); expect(result()).toContain("통과 4 · 파일 문제 0"); expect(mock.inspect.mock.calls.at(-2)![1].locations[0].sceneId).toBe("scene_02");
});
