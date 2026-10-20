// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import type { ImageCandidate, ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), generate: vi.fn(), reference: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./platform", async original => ({
  ...await original<typeof import("./platform")>(),
  listProjects: mock.list, saveProject: mock.save, generateImages: mock.generate, resolveReferenceImage: mock.reference,
  isTauri: () => false, getAccessCode: () => "", localProjectsForImport: async () => [],
}));

let project: ProjectData;
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/");
  project = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  project.anchor.candidates = [{ id: "anchor", path: "anchor.png", mode: "uploaded", preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now" }];
  project.anchor.selected_candidate_id = "anchor";
  mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined);
  mock.reference.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
  mock.generate.mockResolvedValue([]);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function open() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
}
async function scenes() {
  await open();
  for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(screen.getByRole("heading", { name: "장면을 만들고 고르세요" })).toBeTruthy();
}

it("undoes a continuous text edit, preserves native text shortcuts, and saves redo", async () => {
  await open();
  const caption = screen.getByLabelText("장면 1 영상 자막") as HTMLTextAreaElement;
  const original = caption.value;
  fireEvent.focus(caption);
  fireEvent.compositionStart(caption);
  fireEvent.change(caption, { target: { value: "수정" } });
  fireEvent.change(caption, { target: { value: "수정한 문장" } });
  fireEvent.compositionEnd(caption);
  const saveCount = mock.save.mock.calls.length;
  expect(fireEvent.keyDown(caption, { key: "z", ctrlKey: true })).toBe(true);
  expect(mock.save).toHaveBeenCalledTimes(saveCount);
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  expect(caption.value).toBe(original);
  expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
  expect(caption.value).toBe("수정한 문장");
  await waitFor(() => expect(mock.save.mock.calls.at(-1)![0].scenes[0].caption).toBe("수정한 문장"));
});

it("keeps an unsupported future-format project on the dashboard without mounting its editor", async () => {
  project.editor_version = 3;
  await open();
  expect(screen.queryByLabelText("장면 1 영상 자막")).toBeNull();
  expect(screen.getByText(/더 새로운 편집 형식/)).toBeTruthy();
  expect(mock.save).not.toHaveBeenCalled();
});

it("keeps late generation results when undoing an edit made during generation", async () => {
  let finish!: (candidates: ImageCandidate[]) => void;
  mock.generate.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await scenes();
  const caption = screen.getByLabelText("영상 자막") as HTMLTextAreaElement;
  const original = caption.value;
  fireEvent.click(screen.getByRole("button", { name: "후보 3장 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  expect(mock.generate.mock.calls[0][0].reference_image).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(mock.reference.mock.calls[0][0].anchor.candidates[0].mode).toBe("uploaded");
  fireEvent.focus(caption); fireEvent.change(caption, { target: { value: "생성을 기다리며 수정" } });
  await act(async () => { finish([{ id: "late", path: "late.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "openai", created_at: "now" }]); });
  expect(caption.value).toBe("생성을 기다리며 수정");
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  expect(caption.value).toBe(original);
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].candidates.some((candidate: ImageCandidate) => candidate.id === "late")).toBe(true);
  expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
});

it("uses the same selected uploaded reference for thumbnail generation", async () => {
  await scenes();
  fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  fireEvent.click(screen.getByRole("button", { name: "후보 3장 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  expect(mock.generate.mock.calls[0][0]).toMatchObject({ asset_kind: "thumbnail", reference_image: "data:image/png;base64,iVBORw0KGgo=" });
  expect(within(screen.getByRole("group", { name: "편집 이력" })).getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
});

it("keeps the active project's undo history when a background project finishes generating", async () => {
  const other = structuredClone(project); other.id = "other-project"; other.person = "다른 작업";
  mock.list.mockResolvedValue([project, other]);
  let finish!: (candidates: ImageCandidate[]) => void;
  mock.generate.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  render(<App />);
  fireEvent.click((await screen.findAllByRole("button", { name: "이어 작업하기" }))[0]);
  for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  fireEvent.click(screen.getByRole("button", { name: "후보 3장 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  fireEvent.click(within(screen.getByRole("navigation", { name: "제작 단계" })).getByRole("button", { name: /대시보드$/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[1]);
  const caption = screen.getByLabelText("장면 1 영상 자막") as HTMLTextAreaElement;
  const original = caption.value;
  fireEvent.focus(caption); fireEvent.change(caption, { target: { value: "다른 작업의 편집" } });
  await act(async () => { finish([{ id: "background", path: "generated.png", preview_url: "", mode: "openai", created_at: "now" }]); });
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(caption.value).toBe(original);
  expect(mock.save.mock.calls.at(-1)![0].id).toBe(other.id);
  expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
});
