// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), generate: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save,
  getSceneNarration: async () => new Blob(["voice"]), generateImages: mock.generate, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:voice"; static revokeObjectURL = () => {}; });
  project = editorProject();
  for (const [index, scene] of project.scenes.entries()) {
    scene.title = `검토 장면 ${index + 1}`;
    scene.candidates = [{ id: `image-${index}`, path: `image-${index}.png`, preview_url: `data:image/png;base64,${index}`, mode: "uploaded", created_at: "now" }];
    if (index < 2) scene.selected_candidate_id = `image-${index}`;
  }
  project.scenes[0].narration_audio = { id: "voice", name: "voice.wav", path: "voice.wav", mime_type: "audio/wav", duration_sec: 2 };
  project.thumbnail = { ...project.thumbnail, candidates: [project.scenes[0].candidates[0]], selected_candidate_id: "image-0" };
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const filter = (name: string) => within(screen.getByRole("group", { name: "장면 상태 필터" })).getByRole("button", { name: new RegExp(`^${name}`) });
async function openBoard() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  await screen.findByRole("region", { name: "장면 작업 보드" });
}
it("filters current media status without saving or generating and treats narration as optional", async () => {
  await openBoard(); expect(screen.getAllByRole("article")).toHaveLength(3);
  fireEvent.click(filter("화면 미선택")); expect(screen.getAllByRole("article")).toHaveLength(1); expect(screen.getByRole("button", { name: "Scene 3 편집" })).toBeTruthy();
  fireEvent.click(filter("녹음 없음")); expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.click(filter("시간 오류")); expect(screen.queryAllByRole("article")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "모든 장면 보기" })); expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
});
it("opens the exact scene and retains the board filter when fixing it removes it from the results", async () => {
  await openBoard(); fireEvent.click(filter("화면 미선택")); fireEvent.click(screen.getByRole("button", { name: "Scene 3 편집" }));
  expect(screen.getByRole("heading", { name: "검토 장면 3" })).toBeTruthy();
  const candidate = document.querySelector<HTMLButtonElement>(".candidate:not(.selected)")!; fireEvent.click(candidate);
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  expect(filter("화면 미선택").getAttribute("aria-pressed")).toBe("true"); expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toContain("수정한 장면이");
  expect(mock.save.mock.calls.at(-1)![0].source).toEqual(project.source);
  expect(screen.getByRole("button", { name: "다음 단계" }).hasAttribute("disabled")).toBe(false);
});
it("restores the board scroll anchor and focus when returning to an unchanged filtered result", async () => {
  let scrollY = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
  vi.mocked(window.scrollTo).mockImplementation((...args: unknown[]) => { const value = args[0]; if (value && typeof value === "object" && "top" in value) scrollY = Number(value.top) || 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: 1000 - scrollY, bottom: 1100 - scrollY, left: 0, right: 100, x: 0, y: 1000 - scrollY, width: 100, height: 100, toJSON: () => ({}) }));
  await openBoard(); fireEvent.click(filter("녹음 없음"));
  scrollY = 650; fireEvent.scroll(window);
  fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" })); expect(scrollY).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  await waitFor(() => expect(scrollY).toBe(650));
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Scene 2 편집");
});
it("uses browser back and forward without losing the filter or selected stable scene ID", async () => {
  await openBoard(); fireEvent.click(filter("녹음 없음")); fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" }));
  await waitFor(() => expect(window.history.state.great100.sceneId).toBe(project.scenes[1].id));
  await act(async () => window.history.back());
  await screen.findByRole("region", { name: "장면 작업 보드" }); expect(filter("녹음 없음").getAttribute("aria-pressed")).toBe("true");
  await act(async () => window.history.forward());
  expect(await screen.findByRole("heading", { name: "검토 장면 2" })).toBeTruthy();
  expect(mock.save).not.toHaveBeenCalled();
});
it("keeps filters separate between projects", async () => {
  const second = structuredClone(project); second.id = "another-project"; second.person = "다른 인물"; mock.list.mockResolvedValue([project, second]);
  render(<App />); fireEvent.click((await screen.findAllByRole("button", { name: "이어 작업하기" }))[0]);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  fireEvent.click(filter("녹음 없음")); fireEvent.click(screen.getByRole("button", { name: /대시보드$/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[1]);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(filter("모든 장면").getAttribute("aria-pressed")).toBe("true");
});
it("returns safely when the originating scene is merged away while editing a neighbor", async () => {
  await openBoard(); fireEvent.click(filter("녹음 없음")); fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "이전 Scene" })); fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  expect(filter("녹음 없음").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("다른 장면과 합쳐졌습니다");
  expect(screen.getAllByRole("article")).toHaveLength(1); expect(screen.getByRole("article").textContent).toContain("검토 장면 3");
});
