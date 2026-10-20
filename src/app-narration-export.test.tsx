// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ProjectData } from "./types";
import App from "./App";
const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), copy: vi.fn(), download: vi.fn(), read: vi.fn(), generate: vi.fn(), upload: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, downloadBlob: mock.download, getMediaAsset: mock.read, getSceneNarration: async () => null, generateImages: mock.generate, savePreparedNarration: mock.upload, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mock.copy } }); mock.copy.mockResolvedValue(undefined);
  project = editorProject(); project.scenes.forEach((scene, i) => { scene.title = `낭독 장면 ${i + 1}`; scene.candidates = [{ id: `image-${i}`, path: `image-${i}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" }]; scene.selected_candidate_id = `image-${i}`; });
  project.scenes[0].narration_audio = { id: "old", path: "old.wav", name: "old.wav", mime_type: "audio/wav", duration_sec: 2 };
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard"); });
const panel = () => screen.getByRole("region", { name: "내레이션 대본 묶음" });
const button = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const preview = () => within(panel()).getByLabelText<HTMLTextAreaElement>("내보낼 내레이션 대본 묶음");
async function board() { fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" })); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); }
async function open() { render(<App />); await board(); fireEvent.click(button("대본 모으기")); }

it("starts collapsed and selects only scenes without connected recordings without any file or project writes", async () => {
  render(<App />); await board(); expect(within(panel()).queryByRole("checkbox")).toBeNull(); fireEvent.click(button("대본 모으기")); expect(button("대본 묶음 복사").hasAttribute("disabled")).toBe(true);
  fireEvent.click(button("녹음 없는 장면 선택 · 2개")); expect((screen.getByLabelText("Scene 1 대본 선택") as HTMLInputElement).checked).toBe(false); expect(preview().value).toContain("Scene 2 · 낭독 장면 2"); expect(preview().value).not.toContain("Scene 1 · 낭독 장면 1");
  fireEvent.click(screen.getByLabelText("Scene 1 대본 선택")); expect(panel().textContent).toContain("선택 3/3개 장면"); fireEvent.click(button("대본 선택 해제")); expect(within(panel()).queryByRole("textbox", { name: "내보낼 내레이션 대본 묶음" })).toBeNull();
  for (const fn of [mock.read, mock.generate, mock.upload, mock.save, mock.copy, mock.download]) expect(fn).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
});
it("copies and downloads exactly the displayed script bundle and keeps the filename selectable", async () => {
  await open(); fireEvent.click(button("전체 대본 선택")); const text = preview().value; fireEvent.click(button("대본 묶음 복사")); await waitFor(() => expect(button("대본 묶음 복사됨")).toBeTruthy()); expect(mock.copy).toHaveBeenCalledWith(text);
  fireEvent.click(button("대본 TXT 다운로드")); expect(mock.download).toHaveBeenCalledWith(expect.any(Blob), `${project.folder_name}_narration_scripts.txt`); expect(mock.download.mock.calls[0][0].type).toBe("text/plain;charset=utf-8"); expect(mock.save).not.toHaveBeenCalled();
  const name = within(panel()).getByLabelText<HTMLInputElement>("Scene 2 권장 녹음 파일명"); fireEvent.focus(name); expect(name.selectionEnd).toBe(name.value.length);
});
it("exports edited captions with stable selection after a scene moves and returns from editing", async () => {
  await open(); fireEvent.click(screen.getByLabelText("Scene 3 대본 선택")); fireEvent.click(screen.getByRole("button", { name: "Scene 3 편집" })); fireEvent.change(screen.getByLabelText("Caption 1 텍스트"), { target: { value: "지금 편집한 낭독 문장" } }); fireEvent.click(screen.getByRole("button", { name: "이 장면을 앞으로 이동" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2)); fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" })); expect((screen.getByLabelText("Scene 2 대본 선택") as HTMLInputElement).checked).toBe(true); expect(preview().value).toContain("지금 편집한 낭독 문장"); expect(preview().value).toContain("Scene 2 · 낭독 장면 3"); expect(preview().value).not.toContain("세종의 이야기 3");
});
it("offers manual copy when clipboard access fails and recovers with TXT download", async () => {
  mock.copy.mockRejectedValue(new Error("clipboard denied")); await open(); fireEvent.click(button("전체 대본 선택")); fireEvent.click(button("대본 묶음 복사")); await waitFor(() => expect(within(panel()).getByRole("alert").textContent).toContain("직접 복사")); expect(document.activeElement).toBe(preview()); expect(preview().selectionEnd).toBe(preview().value.length);
  fireEvent.click(button("대본 TXT 다운로드")); expect(within(panel()).queryByRole("alert")).toBeNull(); expect(mock.download).toHaveBeenCalledOnce();
});
it("does not mark a delayed copy as current after changing selected scenes", async () => {
  let finish!: () => void; mock.copy.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); await open(); fireEvent.click(button("전체 대본 선택")); const copied = preview().value; fireEvent.click(button("대본 묶음 복사")); fireEvent.click(button("녹음 없는 장면 선택 · 2개")); await act(async () => finish());
  expect(mock.copy).toHaveBeenCalledWith(copied); expect(preview().value).not.toBe(copied); expect(within(panel()).getByRole("status").textContent).toContain("최신 묶음을 다시"); expect(button("대본 묶음 복사")).toBeTruthy();
});
it("reports TXT failure without recording a successful export", async () => {
  mock.download.mockImplementationOnce(() => { throw new Error("download failed"); }); await open(); fireEvent.click(button("전체 대본 선택")); fireEvent.click(button("대본 TXT 다운로드")); expect(within(panel()).getByRole("alert").textContent).toContain("내려받지 못했습니다"); expect(within(panel()).queryByRole("status")).toBeNull(); expect(mock.save).not.toHaveBeenCalled();
});
it("excludes empty scripts and merged-away selections instead of picking a reused number", async () => {
  await open(); fireEvent.click(screen.getByLabelText("Scene 2 대본 선택")); fireEvent.click(screen.getByRole("button", { name: "Scene 1 편집" })); fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" })); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  expect(within(panel()).getByRole("alert").textContent).toContain("장면 1개가 없어졌거나"); expect(button("대본 묶음 복사").hasAttribute("disabled")).toBe(true); expect((screen.getByLabelText("Scene 2 대본 선택") as HTMLInputElement).checked).toBe(false);
});
it("keeps narration and image selections independent and restores only the current project's choices", async () => {
  const second = structuredClone(project); second.id = "other-project"; second.person = "다른 인물"; mock.list.mockResolvedValue([project, second]); render(<App />); fireEvent.click((await screen.findAllByRole("button", { name: "이어 작업하기" }))[0]); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); fireEvent.click(button("대본 모으기")); fireEvent.click(button("전체 대본 선택"));
  fireEvent.click(screen.getByRole("button", { name: "프롬프트 모으기" })); const imagePanel = screen.getByRole("region", { name: "이미지 제작 프롬프트 묶음" }); expect(within(imagePanel).getAllByRole<HTMLInputElement>("checkbox").every(input => !input.checked)).toBe(true); fireEvent.click(within(imagePanel).getByRole("button", { name: "전체 장면 선택" })); fireEvent.click(button("대본 선택 해제")); expect(within(imagePanel).getAllByRole<HTMLInputElement>("checkbox").every(input => input.checked)).toBe(true); fireEvent.click(button("전체 대본 선택"));
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ })); fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[1]); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); expect(button("대본 모으기")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ })); fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[0]); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); expect(panel().textContent).toContain("선택 3/3개 장면"); expect(mock.save).not.toHaveBeenCalled();
});
