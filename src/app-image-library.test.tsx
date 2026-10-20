// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import { sceneComposition } from "./media-composition";
import type { ImageCandidate, ProjectData } from "./types";
import App from "./App";
const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), read: vi.fn(), get: vi.fn(), upload: vi.fn(), generate: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./library-image-reader", () => ({ readOriginalImageCandidate: mock.read }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, getMediaAsset: mock.get, importImageCandidates: mock.upload, generateImages: mock.generate, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const image = (id: string): ImageCandidate => ({ id, path: `images/${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" });
const nativeShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:original"); static revokeObjectURL = vi.fn(); });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  project = editorProject(); project.scenes.forEach((scene, i) => { scene.title = `보관함 장면 ${i + 1}`; scene.candidates = [image(`main-${i}`)]; if (!i) scene.selected_candidate_id = `main-${i}`; });
  project.media = { assets: [{ id: "candidate:detached", kind: "image", path: "images/detached.png", mime_type: "image/png", inline_data: image("detached").preview_url }] };
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.read.mockResolvedValue(image("detached")); mock.get.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.overflow = "";
  for (const [method, descriptor] of [["showModal", nativeShow], ["close", nativeClose]] as const) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, method); }
});
const library = () => screen.getByRole("region", { name: "이미지 원본 보관함" });
const filter = (label: string) => within(library()).getByRole("button", { name: new RegExp(`^${label} `) });
const restore = () => within(library()).getByRole("button", { name: "원본 이미지 1 후보로 추가" });
const saved = (): ProjectData => mock.save.mock.calls.at(-1)![0];
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(mock.get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "보관함 열기" }));
}
const target = (id = "scene_02") => fireEvent.change(screen.getByLabelText("원본 후보를 추가할 장면"), { target: { value: id } });

it("browses usage, candidate retention and search without saving, downloading originals or generating", async () => {
  await open(); expect(library().querySelectorAll(".library-card")).toHaveLength(4); expect(restore().hasAttribute("disabled")).toBe(true);
  fireEvent.click(filter("화면 연결됨")); expect(library().querySelectorAll(".library-card")).toHaveLength(1);
  fireEvent.click(filter("화면 연결 없음")); expect(library().querySelectorAll(".library-card")).toHaveLength(3);
  fireEvent.click(filter("후보 목록에서 빠짐")); expect(library().querySelectorAll(".library-card")).toHaveLength(1);
  fireEvent.click(filter("모든 이미지")); fireEvent.change(screen.getByLabelText("원본 이미지 검색"), { target: { value: "main-2" } });
  expect(library().querySelectorAll(".library-card")).toHaveLength(1); expect(within(library()).getByText("원본 이미지 4")).toBeTruthy();
  expect(mock.get).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
});
it("restores the same original into an empty scene without selecting it, duplicating it, or recording a selection edit", async () => {
  await open(); target(); fireEvent.click(restore());
  await waitFor(() => expect(library().textContent).toContain("Scene 2 후보에 추가했습니다"));
  expect(mock.read).toHaveBeenCalledOnce(); expect(mock.save).toHaveBeenCalledOnce(); expect(saved().scenes[1].selected_candidate_id).toBeUndefined();
  expect(saved().scenes[1].candidates.at(-1)!.id).toBe("detached"); expect(saved().media!.assets.map(a => a.id)).toEqual(project.media!.assets.map(a => a.id));
  expect(saved().source).toEqual(project.source); expect(restore().hasAttribute("disabled")).toBe(true); expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(restore()); expect(mock.read).toHaveBeenCalledOnce(); expect(mock.upload).not.toHaveBeenCalled();
});
it("keeps success and H3 comparison available when a restored image leaves the detached filter, and undo retains the candidate", async () => {
  await open(); target(); fireEvent.click(filter("후보 목록에서 빠짐")); fireEvent.click(restore());
  await waitFor(() => expect(library().textContent).toContain("Scene 2 후보에 추가했습니다")); expect(library().querySelectorAll(".library-card")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "복원한 장면 후보 비교" })); const dialog = screen.getByRole("dialog", { name: "후보 이미지 비교" });
  expect(dialog.textContent).toContain("Scene 2 · 보관함 장면 2"); expect(dialog.textContent).toContain("프로젝트의 모든 장면");
  fireEvent.load(within(dialog).getByAltText("비교 후보 2")); fireEvent.click(within(dialog).getByRole("button", { name: "후보 2 검토 선택" })); fireEvent.click(within(dialog).getByRole("button", { name: "선택 확정" }));
  await waitFor(() => expect(saved().scenes[1].selected_candidate_id).toBe("detached"));
  fireEvent.click(within(dialog).getByRole("button", { name: "후보 비교 닫기" })); await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("복원한 장면 후보 비교"));
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" })); await waitFor(() => expect(saved().scenes[1].selected_candidate_id).toBeUndefined());
  expect(saved().scenes[1].candidates.at(-1)!.id).toBe("detached"); expect(mock.read).toHaveBeenCalledOnce();
});
it("keeps a selected video's current visual and automatic no-intro choice unchanged", async () => {
  project.scenes[0].candidates = [{ ...image("video"), path: "video.mp4", media_type: "video", duration_sec: 10 }]; project.scenes[0].selected_candidate_id = "video";
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); const visuals = sceneComposition(project.scenes[0]).visuals;
  await open(); target("scene_01"); fireEvent.click(restore()); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  expect(saved().scenes[0].selected_candidate_id).toBe("video"); expect(saved().scenes[0].video_intro_candidate_id).toBeNull(); expect(sceneComposition(saved().scenes[0]).visuals).toEqual(visuals);
});
it("reports a missing original without changing the project and allows retrying", async () => {
  mock.read.mockRejectedValueOnce(new Error("이미지 원본이 없습니다")); await open(); target(); fireEvent.click(restore());
  await waitFor(() => expect(within(library()).getByRole("alert").textContent).toContain("원본이 없습니다")); expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(restore()); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); expect(mock.read).toHaveBeenCalledTimes(2);
});
it("recovers a project save failure through the existing retry without reading or uploading the original again", async () => {
  mock.save.mockRejectedValueOnce(new Error("저장 실패 검증")); await open(); target(); fireEvent.click(restore());
  await waitFor(() => expect(library().textContent).toContain("프로젝트 저장은 상단에서")); expect(restore().hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "저장 다시 시도" })[0]); await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  expect(mock.read).toHaveBeenCalledOnce(); expect(mock.upload).not.toHaveBeenCalled(); expect(saved().scenes[1].candidates.at(-1)!.id).toBe("detached");
});
it("finishes against the same scene ID after navigating away and reordering while reading the original", async () => {
  let finish!: (candidate: ImageCandidate) => void; mock.read.mockReturnValueOnce(new Promise<ImageCandidate>(resolve => { finish = resolve; }));
  await open(); target(); fireEvent.click(restore()); fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "이 장면을 뒤로 이동" })); await act(async () => finish(image("detached")));
  await waitFor(() => expect(saved().scenes[2].candidates.at(-1)!.id).toBe("detached")); expect(saved().scenes[2].id).toBe("scene_02"); expect(saved().scenes[1].candidates.some(c => c.id === "detached")).toBe(false);
});
it("keeps the original without assigning it to a reused number if the target is merged away while reading", async () => {
  project.scenes[1].selected_candidate_id = "main-1";
  let finish!: (candidate: ImageCandidate) => void; mock.read.mockReturnValueOnce(new Promise<ImageCandidate>(resolve => { finish = resolve; }));
  await open(); target(); fireEvent.click(restore()); fireEvent.click(screen.getByRole("button", { name: "Scene 1 편집" })); fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); await act(async () => finish(image("detached")));
  await waitFor(() => expect(document.querySelector(".toast")?.textContent).toContain("장면이 없어졌습니다"));
  expect(mock.save).toHaveBeenCalledOnce(); expect(saved().media!.assets.some(a => a.id === "candidate:detached")).toBe(true); expect(saved().scenes.some(s => s.candidates.some(c => c.id === "detached"))).toBe(false);
});
it("paginates, refreshes a failed preview, and revokes temporary URLs without writing project data", async () => {
  for (let i = 0; i < 10; i++) project.media!.assets.push({ id: `candidate:extra-${i}`, kind: "image", path: `extra-${i}.png`, mime_type: "image/png", inline_data: image("extra").preview_url });
  await open(); expect(library().querySelectorAll(".library-card")).toHaveLength(9);
  fireEvent.error(within(library()).getByAltText("원본 이미지 1")); fireEvent.click(within(library()).getByRole("button", { name: "미리보기 다시 불러오기" }));
  await waitFor(() => expect(within(library()).getByAltText("원본 이미지 1").getAttribute("src")).toBe("blob:original"));
  fireEvent.click(within(library()).getByRole("button", { name: "다음 원본 페이지" })); expect(library().querySelectorAll(".library-card")).toHaveLength(5); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original");
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
});
