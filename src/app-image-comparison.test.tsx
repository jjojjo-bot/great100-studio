// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), generate: vi.fn(), upload: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save,
  generateImages: mock.generate, importImageCandidates: mock.upload, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const nativeShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  project = editorProject();
  for (const [i, scene] of project.scenes.entries()) {
    scene.title = `비교 장면 ${i + 1}`;
    scene.candidates = Array.from({ length: 6 }, (_, n) => ({ id: `image-${i}-${n}`, path: `${i}-${n}.png`, preview_url: `data:image/png;base64,${i}${n}`, mode: "uploaded", created_at: "now" }));
    if (i < 2) scene.selected_candidate_id = scene.candidates[0].id;
  }
  project.thumbnail.candidates = [project.scenes[0].candidates[0]]; project.thumbnail.selected_candidate_id = project.scenes[0].candidates[0].id;
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); document.body.style.overflow = "";
  for (const [method, descriptor] of [["showModal", nativeShow], ["close", nativeClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
});
async function openBoard() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  await screen.findByRole("region", { name: "장면 작업 보드" });
}
async function open(number = 1) { await openBoard(); fireEvent.click(screen.getByRole("button", { name: `Scene ${number} 후보 비교` })); }
const dialog = () => screen.getByRole("dialog", { name: "후보 이미지 비교" });
const action = (name: string) => within(dialog()).getByRole("button", { name });
function choose(number: number, load = true) { if (load) fireEvent.load(within(dialog()).getByAltText(`비교 후보 ${number}`)); fireEvent.click(action(`후보 ${number} 검토 선택`)); }
const saved = (): ProjectData => mock.save.mock.calls.at(-1)![0];

it("keeps staging read-only, closes on Escape, restores focus and releases the body scroll lock", async () => {
  await open(); expect(document.body.style.overflow).toBe("hidden"); expect(document.activeElement).toBe(action("후보 비교 닫기"));
  choose(2); expect(mock.save).not.toHaveBeenCalled(); expect(action("선택 확정").hasAttribute("disabled")).toBe(false);
  fireEvent(dialog(), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.body.style.overflow).toBe("");
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Scene 1 후보 비교"));
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
});
it("pins the current image in the initial four and lets users replace comparison slots without including video candidates", async () => {
  project.scenes[0].selected_candidate_id = project.scenes[0].candidates[5].id;
  project.scenes[0].candidates[1] = { ...project.scenes[0].candidates[1], id: "video-excluded", path: "video-excluded.mp4", media_type: "video", duration_sec: 10 };
  await open(); expect(within(dialog()).getAllByAltText(/^비교 후보/)).toHaveLength(4);
  expect(within(dialog()).getAllByAltText(/^비교 후보/)[0].getAttribute("alt")).toBe("비교 후보 6");
  expect(within(dialog()).queryByRole("button", { name: "후보 2 비교에 포함" })).toBeNull();
  expect(action("후보 5 비교에 포함").hasAttribute("disabled")).toBe(true);
  fireEvent.click(action("후보 3 비교에 포함")); fireEvent.click(action("후보 5 비교에 포함"));
  expect(within(dialog()).getAllByAltText(/^비교 후보/)).toHaveLength(4); expect(within(dialog()).queryByAltText("비교 후보 3")).toBeNull();
  expect(mock.save).not.toHaveBeenCalled();
});
it("confirms a choice once, updates current markers and supports undo and redo with all originals intact", async () => {
  await open(); choose(2); fireEvent.click(action("선택 확정"));
  await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toContain("선택을 확정"));
  expect(mock.save).toHaveBeenCalledOnce(); expect(saved().scenes[0].selected_candidate_id).toBe("image-0-1");
  expect(action("후보 2 검토 선택").textContent).toContain("현재 선택"); expect(saved().source).toEqual(project.source); expect(saved().scenes[0].candidates).toEqual(project.scenes[0].candidates);
  fireEvent.click(action("후보 비교 닫기")); fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  await waitFor(() => expect(saved().scenes[0].selected_candidate_id).toBe("image-0-0"));
  fireEvent.click(screen.getByRole("button", { name: "다시 실행" })); await waitFor(() => expect(saved().scenes[0].selected_candidate_id).toBe("image-0-1"));
  expect(saved().media?.assets).toEqual(project.media?.assets); expect(mock.generate).not.toHaveBeenCalled();
});
it("continues through the opening filter's scene IDs when confirmation removes cards from that filter", async () => {
  project.scenes[1].selected_candidate_id = undefined;
  await openBoard(); const filters = within(screen.getByRole("group", { name: "장면 상태 필터" }));
  fireEvent.click(filters.getByRole("button", { name: /^화면 미선택/ })); fireEvent.click(screen.getByRole("button", { name: "Scene 2 후보 비교" }));
  choose(1); fireEvent.click(action("선택 확정 후 다음 장면"));
  await waitFor(() => expect(dialog().textContent).toContain("Scene 3 · 비교 장면 3"));
  expect(within(screen.getByRole("region", { name: "장면 작업 보드" })).getAllByRole("article")).toHaveLength(1);
  choose(1); fireEvent.click(action("선택 확정")); await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  fireEvent.click(action("후보 비교 닫기"));
  expect(filters.getByRole("button", { name: /^화면 미선택/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryAllByRole("article")).toHaveLength(0); expect(screen.getByRole("status").textContent).toContain("필터는 유지");
  await waitFor(() => expect(document.activeElement).toBe(filters.getByRole("button", { name: /^화면 미선택/ })));
});
it("discards unconfirmed choices when moving between scenes and disables navigation at either end", async () => {
  await open(); expect(action("이전 비교 장면").hasAttribute("disabled")).toBe(true); choose(2);
  fireEvent.click(action("다음 비교 장면")); expect(dialog().textContent).toContain("Scene 2 · 비교 장면 2");
  fireEvent.click(action("이전 비교 장면")); expect(action("후보 2 검토 선택").getAttribute("aria-pressed")).toBe("false"); expect(action("선택 확정").hasAttribute("disabled")).toBe(true);
  fireEvent.click(action("다음 비교 장면")); fireEvent.click(action("다음 비교 장면")); expect(action("다음 비교 장면").hasAttribute("disabled")).toBe(true);
  expect(mock.save).not.toHaveBeenCalled();
});
it("handles a scene without image candidates while keeping video selection outside this flow", async () => {
  project.scenes[1].candidates = [{ ...project.scenes[1].candidates[0], id: "video-only", path: "video-only.mp4", media_type: "video", duration_sec: 10 }];
  project.scenes[1].selected_candidate_id = "video-only";
  await open(); expect(screen.getByRole("button", { name: "Scene 2 후보 비교" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(action("다음 비교 장면")); expect(dialog().textContent).toContain("이미지 후보가 없습니다");
  expect(action("선택 확정").hasAttribute("disabled")).toBe(true); expect(mock.save).not.toHaveBeenCalled();
});
it("requires a loaded preview and allows retrying a failed image without saving", async () => {
  await open(); choose(2, false); expect(action("선택 확정").hasAttribute("disabled")).toBe(true);
  fireEvent.load(within(dialog()).getByAltText("비교 후보 2")); expect(action("선택 확정").hasAttribute("disabled")).toBe(false);
  fireEvent.error(within(dialog()).getByAltText("비교 후보 2")); expect(action("선택 확정").hasAttribute("disabled")).toBe(true);
  fireEvent.click(action("후보 2 이미지 다시 불러오기")); fireEvent.load(within(dialog()).getByAltText("비교 후보 2"));
  expect(action("선택 확정").hasAttribute("disabled")).toBe(false); expect(mock.save).not.toHaveBeenCalled();
});
it("requires re-review if undo changes the current screen after a candidate was staged", async () => {
  await open(); choose(2); fireEvent.click(action("선택 확정")); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(dialog()).queryByRole("status")).toBeTruthy()); choose(3);
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("현재 화면이 변경"));
  expect(action("선택 확정").hasAttribute("disabled")).toBe(true); expect(saved().scenes[0].selected_candidate_id).toBe("image-0-0");
  choose(3); fireEvent.click(action("선택 확정")); await waitFor(() => expect(saved().scenes[0].selected_candidate_id).toBe("image-0-2"));
});
it("surfaces save failures inside the dialog and does not advance or reupload", async () => {
  mock.save.mockRejectedValueOnce(new Error("저장 실패 검증")); await open(); choose(2); fireEvent.click(action("선택 확정 후 다음 장면"));
  await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("선택은 반영했지만"));
  expect(dialog().textContent).toContain("Scene 1 · 비교 장면 1"); expect(saved().scenes[0].selected_candidate_id).toBe("image-0-1");
  fireEvent.click(action("비교 닫고 작업 보드 확인")); fireEvent.click(screen.getAllByRole("button", { name: "저장 다시 시도" })[0]);
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2)); expect(mock.upload).not.toHaveBeenCalled();
});
it("allows closing during a pending save without navigating the board when the save completes", async () => {
  let finish!: () => void; mock.save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await open(); choose(2); fireEvent.click(action("선택 확정 후 다음 장면"));
  expect(action("다음 비교 장면").hasAttribute("disabled")).toBe(true); fireEvent.click(action("후보 비교 닫기"));
  await act(async () => finish()); expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getAllByRole("article")).toHaveLength(3); expect(mock.save).toHaveBeenCalledOnce();
});
it("does not advance if another edit changes the screen while the confirmed choice is saving", async () => {
  let finish!: () => void; mock.save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await open(); choose(2); fireEvent.click(action("선택 확정 후 다음 장면")); fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2)); await act(async () => finish());
  await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("적용 후 화면이 다시 변경"));
  expect(dialog().textContent).toContain("Scene 1 · 비교 장면 1"); expect(saved().scenes[0].selected_candidate_id).toBe("image-0-0");
});
