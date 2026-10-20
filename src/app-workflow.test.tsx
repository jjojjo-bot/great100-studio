// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({
  list: vi.fn(), save: vi.fn(), read: vi.fn(), voice: vi.fn(), music: vi.fn(),
  rendered: vi.fn(), upload: vi.fn(), generate: vi.fn(),
}));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
// Preview decoding has its own browser/render coverage. These tests isolate
// navigation and opening preparation tools from actual playback file reads.
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./platform", async original => ({
  ...await original<typeof import("./platform")>(),
  listProjects: mock.list, saveProject: mock.save, getMediaAsset: mock.read,
  getSceneNarration: mock.voice, getBackgroundMusic: mock.music,
  getRenderedVideo: mock.rendered, importImageCandidates: mock.upload,
  generateImages: mock.generate, getNextProjectEpisode: async () => 1,
  isTauri: () => false, getAccessCode: () => "",
}));

let project: ProjectData;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  project = editorProject();
  for (const [index, scene] of project.scenes.entries()) {
    scene.title = `검토 장면 ${index + 1}`;
    scene.candidates = [{
      id: `image-${index}`, path: `images/image-${index}.png`,
      preview_url: `data:image/png;base64,${index}`, mode: "uploaded", created_at: "now",
    }];
    if (index < 2) scene.selected_candidate_id = `image-${index}`;
  }
  project.thumbnail = { ...project.thumbnail, candidates: [project.scenes[0].candidates[0]], selected_candidate_id: "image-0" };
  project = prepareEditorWrite(project);
  mock.list.mockResolvedValue([project]);
  mock.save.mockResolvedValue(undefined);
  mock.read.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  mock.voice.mockResolvedValue(null);
  mock.music.mockResolvedValue(null);
  mock.rendered.mockResolvedValue(null);
  mock.upload.mockResolvedValue([]);
  mock.generate.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const step = (label: string) => within(screen.getByRole("navigation", { name: "제작 단계" }))
  .getByRole("button", { name: new RegExp(`${label}$`) });
async function openProject() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
}
async function openReview() {
  await openProject();
  fireEvent.click(step("전체 검토"));
  await screen.findByRole("region", { name: "영상 제작 현황" });
}

it("explains the starting workflow and marks only the current step while project tools remain unavailable", async () => {
  mock.list.mockResolvedValue([]);
  render(<App />);
  await waitFor(() => expect(mock.list).toHaveBeenCalledOnce());
  expect(screen.getByRole("list", { name: "영상 제작 순서" }).textContent).toContain("MP4 만들기");
  expect(step("대시보드").getAttribute("aria-current")).toBe("step");
  for (const label of ["파싱 확인", "사전 점검", "기준 이미지", "Scene 검토", "썸네일", "전체 검토", "완료"]) {
    expect(step(label).hasAttribute("disabled")).toBe(true);
    expect(step(label).getAttribute("aria-current")).toBeNull();
  }
  fireEvent.click(step("프로젝트"));
  expect(screen.getByRole("heading", { name: "새 이야기를 시작합니다" })).toBeTruthy();
  expect(step("프로젝트").getAttribute("aria-current")).toBe("step");
  expect(step("대시보드").getAttribute("aria-current")).toBeNull();
  expect(mock.save).not.toHaveBeenCalled();
});

it("opens a future editing step directly and allows re-entry after returning to an earlier screen", async () => {
  await openProject();
  fireEvent.click(step("썸네일"));
  expect(screen.getByRole("heading", { name: "썸네일 만들기" })).toBeTruthy();
  expect(step("썸네일").getAttribute("aria-current")).toBe("step");
  fireEvent.click(step("Scene 검토"));
  expect(screen.getByRole("heading", { name: "검토 장면 1" })).toBeTruthy();
  fireEvent.click(step("파싱 확인"));
  expect(screen.getByRole("heading", { name: "제작안의 장면을 확인하세요" })).toBeTruthy();
  expect(step("썸네일").hasAttribute("disabled")).toBe(false);
  fireEvent.click(step("썸네일"));
  expect(screen.getByRole("heading", { name: "썸네일 만들기" })).toBeTruthy();
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.generate).not.toHaveBeenCalled();
});

it("blocks both export routes while a required visual is missing and connects the footer to an actionable explanation", async () => {
  await openReview();
  const next = screen.getByRole("button", { name: "다음 단계" });
  expect(next.hasAttribute("disabled")).toBe(true);
  expect(step("완료").hasAttribute("disabled")).toBe(true);
  const description = document.getElementById(next.getAttribute("aria-describedby")!);
  expect(description?.textContent).toContain("출력 전에 확인할 항목");
  expect(screen.getByRole("button", { name: "첫 미선택 장면 열기" })).toBeTruthy();
  fireEvent.click(step("완료"));
  expect(screen.getByRole("region", { name: "영상 제작 현황" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "세종 편 영상 만들기" })).toBeNull();
  expect(mock.save).not.toHaveBeenCalled();
});

it("opens the first missing scene from the overview and restores the board filter and focus on return", async () => {
  await openReview();
  const filters = screen.getByRole("group", { name: "장면 상태 필터" });
  fireEvent.click(within(filters).getByRole("button", { name: /^화면 미선택/ }));
  fireEvent.click(screen.getByRole("button", { name: "첫 미선택 장면 열기" }));
  expect(screen.getByRole("heading", { name: "검토 장면 3" })).toBeTruthy();
  expect(window.history.state.great100.sceneId).toBe(project.scenes[2].id);
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  expect(within(screen.getByRole("group", { name: "장면 상태 필터" }))
    .getByRole("button", { name: /^화면 미선택/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Scene 3 편집"));
  expect(mock.save).not.toHaveBeenCalled();
});

it("enables export after the missing visual is selected without requiring any narration or changing the source", async () => {
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "첫 미선택 장면 열기" }));
  fireEvent.click(document.querySelector<HTMLButtonElement>(".candidate:not(.selected)")!);
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  expect(mock.save.mock.calls[0][0].source).toEqual(project.source);
  expect(mock.save.mock.calls[0][0].scenes.every((scene: ProjectData["scenes"][number]) => !scene.narration_audio)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  const next = screen.getByRole("button", { name: "다음 단계" });
  expect(next.hasAttribute("disabled")).toBe(false);
  expect(next.getAttribute("aria-describedby")).toBeNull();
  expect(step("완료").hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("region", { name: "영상 제작 현황" }).textContent).toContain("녹음 없이도 영상을 만들 수 있습니다");
  fireEvent.click(next);
  expect(await screen.findByRole("heading", { name: "세종 편 영상 만들기" })).toBeTruthy();
  expect(step("완료").getAttribute("aria-current")).toBe("step");
  expect(mock.voice).not.toHaveBeenCalled();
});

it("opens and focuses preparation tools from shortcuts without reading files or saving a project", async () => {
  await openReview();
  const board = screen.getByRole("region", { name: "장면 작업 보드" });
  const imageTools = screen.getByRole("region", { name: "이미지 준비 도구" });
  expect(board.compareDocumentPosition(imageTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const shortcuts = within(screen.getByRole("navigation", { name: "전체 검토 바로가기" }));
  fireEvent.click(shortcuts.getByRole("button", { name: /^이미지 준비로 이동/ }));
  expect(document.querySelector("button[aria-controls='batch-image-content']")?.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByLabelText("일괄 배치 이미지 파일 선택")).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(imageTools));
  fireEvent.click(shortcuts.getByRole("button", { name: /^녹음 준비로 이동/ }));
  expect(document.querySelector("button[aria-controls='scene-narration-export-content']")?.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("group", { name: "대본을 내보낼 장면" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "녹음 준비 도구" })));
  fireEvent.click(shortcuts.getByRole("button", { name: /^자료 점검으로 이동/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "원본과 자료 점검" })));
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.read).not.toHaveBeenCalled();
  expect(mock.voice).not.toHaveBeenCalled();
  expect(mock.music).not.toHaveBeenCalled();
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.generate).not.toHaveBeenCalled();
});

it("presents image upload as the primary API-free action and clearly labels layout examples as secondary", async () => {
  await openProject();
  fireEvent.click(step("Scene 검토"));
  const upload = screen.getByRole("button", { name: "이미지 업로드" });
  const example = screen.getByRole("button", { name: "예시 2장 만들기" });
  expect(upload.classList.contains("primary")).toBe(true);
  expect(example.classList.contains("ghost")).toBe(true);
  expect(screen.queryByRole("button", { name: "후보 2장 생성" })).toBeNull();
  expect(screen.getByText(/예시 만들기는 레이아웃 확인용 이미지를 만듭니다/)).toBeTruthy();
  const chooser = vi.spyOn(screen.getByLabelText("후보 이미지 파일 선택") as HTMLInputElement, "click").mockImplementation(() => {});
  fireEvent.click(upload);
  expect(chooser).toHaveBeenCalledOnce();
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.generate).not.toHaveBeenCalled();
});
