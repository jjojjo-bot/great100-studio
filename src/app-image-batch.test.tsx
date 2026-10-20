// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ImageCandidate, ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), upload: vi.fn(), inspect: vi.fn(), generate: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./scene-image-batch", async original => ({ ...await original<typeof import("./scene-image-batch")>(), inspectBatchImage: mock.inspect }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, importImageCandidates: mock.upload, generateImages: mock.generate, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const image = (id: string): ImageCandidate => ({ id, path: `${id}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" });
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:image"); static revokeObjectURL = vi.fn(); });
  project = editorProject(); project.scenes[0].candidates = [image("old")]; project.scenes[0].selected_candidate_id = "old";
  project.thumbnail.candidates = [image("thumb")]; project.thumbnail.selected_candidate_id = "thumb";
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.inspect.mockResolvedValue(undefined);
  mock.upload.mockImplementation(async ([file]: File[]) => [image(file.name)]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  fireEvent.click(screen.getByRole("button", { name: "이미지 가져오기" }));
}
const region = () => screen.getByRole("region", { name: "이미지 일괄 배치" });
async function files(...names: string[]) {
  fireEvent.change(screen.getByLabelText("일괄 배치 이미지 파일 선택"), { target: { files: names.map(name => new File(["png"], name, { type: "image/png" })) } });
  await waitFor(() => expect(region().textContent).not.toContain("이미지 확인 중"));
}
const apply = () => within(region()).getByRole("button", { name: /^연결안 적용/ });
const saved = (): ProjectData => mock.save.mock.calls.at(-1)![0];

it("previews assignments without saving, leaves unknown files unassigned, and preserves existing screens", async () => {
  await open(); await files("scene_01.png", "02.png", "portrait.png");
  expect((screen.getByLabelText("파일 1 연결 장면") as HTMLSelectElement).value).toBe("scene_01");
  expect((screen.getByLabelText("파일 3 연결 장면") as HTMLSelectElement).value).toBe(""); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("파일 3 연결 장면"), { target: { value: "scene_02" } }); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 3/3"));
  expect(mock.upload).toHaveBeenCalledTimes(3); expect(saved().scenes[0].selected_candidate_id).toBe("old");
  expect(saved().scenes[1].selected_candidate_id).toBe("02.png"); expect(saved().scenes[1].candidates).toHaveLength(2);
  expect(saved().source).toEqual(project.source); expect(mock.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  await waitFor(() => expect(saved().scenes[1].selected_candidate_id).toBeUndefined()); expect(saved().scenes[1].candidates).toHaveLength(2);
});
it("keeps partial success, retries only failures, and never reuploads completed files", async () => {
  let fail = true; mock.upload.mockImplementation(async ([file]: File[]) => { if (file.name === "02.png" && fail) throw new Error("네트워크 실패"); return [image(file.name)]; });
  await open(); await files("01.png", "02.png", "03.png"); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 2/3")); expect(mock.upload).toHaveBeenCalledTimes(3);
  fail = false; fireEvent.click(screen.getByRole("button", { name: "실패한 파일만 재시도" }));
  await waitFor(() => expect(region().textContent).toContain("연결 완료 3/3")); expect(mock.upload).toHaveBeenCalledTimes(4);
  expect(mock.upload.mock.calls.at(-1)![0][0].name).toBe("02.png"); expect(apply().hasAttribute("disabled")).toBe(true);
});
it("preserves a video with no intro and does not record a reversible automatic-intro change", async () => {
  project.scenes[0].candidates = [{ ...image("video"), media_type: "video", duration_sec: 20 }]; project.scenes[0].selected_candidate_id = "video";
  project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]);
  await open(); await files("01.png"); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/1"));
  expect(saved().scenes[0].selected_candidate_id).toBe("video"); expect(saved().scenes[0].video_intro_candidate_id).toBeNull();
  expect(saved().scenes[0].composition!.visuals).toEqual(project.scenes[0].composition!.visuals);
  expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
});
it("retains the draft through scene navigation, uses stable IDs after a move, and supports reversible replacement", async () => {
  await open(); await files("01.png"); fireEvent.click(screen.getByLabelText("새 이미지로 교체"));
  fireEvent.click(screen.getByRole("button", { name: "Scene 1 편집" })); fireEvent.click(screen.getByRole("button", { name: "이 장면을 뒤로 이동" }));
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  expect((screen.getByLabelText("파일 1 연결 장면") as HTMLSelectElement).value).toBe("scene_01"); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/1"));
  expect(saved().scenes[1].id).toBe("scene_01"); expect(saved().scenes[1].selected_candidate_id).toBe("01.png");
  expect(mock.upload.mock.calls[0][1].scene_number).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" })); await waitFor(() => expect(saved().scenes[1].selected_candidate_id).toBe("old"));
  expect(saved().scenes[1].candidates.some(candidate => candidate.id === "01.png")).toBe(true);
});
it("preserves a manual screen selection made while uploading and returns safely to the draft", async () => {
  let finish!: (value: ImageCandidate[]) => void; mock.upload.mockReturnValue(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  project.scenes[1].candidates = [image("manual")];
  await open(); await files("02.png"); fireEvent.click(screen.getByLabelText("새 이미지로 교체")); fireEvent.click(apply());
  fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" }));
  fireEvent.click(document.querySelector<HTMLButtonElement>(".candidate:not(.selected)")!);
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  await act(async () => { finish([image("late")]); });
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/1")); expect(saved().scenes[1].selected_candidate_id).toBe("manual");
  expect(region().textContent).toContain("변경되어 후보로만");
  expect(mock.upload).toHaveBeenCalledOnce();
});
it("stops after the current file and preserves remaining files for a later apply", async () => {
  let finish!: (value: ImageCandidate[]) => void; mock.upload.mockReturnValueOnce(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await open(); await files("01.png", "02.png"); fireEvent.click(apply());
  fireEvent.click(screen.getByRole("button", { name: "현재 파일 완료 후 중단" }));
  await act(async () => finish([image("one")]));
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/2")); expect(mock.upload).toHaveBeenCalledOnce();
  expect(apply().textContent).toContain("1개"); expect(apply().hasAttribute("disabled")).toBe(false);
});
it("keeps the first image as representative when resuming several files for the same scene", async () => {
  let finish!: (value: ImageCandidate[]) => void; mock.upload.mockReturnValueOnce(new Promise<ImageCandidate[]>(resolve => { finish = resolve; }));
  await open(); await files("01_first.png", "01_second.png"); fireEvent.click(screen.getByLabelText("새 이미지로 교체")); fireEvent.click(apply());
  fireEvent.click(screen.getByRole("button", { name: "현재 파일 완료 후 중단" }));
  await act(async () => finish([image("first")])); await waitFor(() => expect(region().textContent).toContain("연결 완료 1/2"));
  fireEvent.click(apply()); await waitFor(() => expect(region().textContent).toContain("연결 완료 2/2"));
  expect(saved().scenes[0].selected_candidate_id).toBe("first"); expect(saved().scenes[0].candidates).toHaveLength(3);
});
it("keeps drafts isolated between projects and releases preview URLs when clearing a list", async () => {
  const second = structuredClone(project); second.id = "other-project"; second.person = "다른 인물"; mock.list.mockResolvedValue([project, second]);
  render(<App />); fireEvent.click((await screen.findAllByRole("button", { name: "이어 작업하기" }))[0]);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  fireEvent.click(screen.getByRole("button", { name: "이미지 가져오기" })); await files("01.png");
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ })); fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[1]);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(screen.queryByLabelText("파일 1 연결 장면")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ })); fireEvent.click(screen.getAllByRole("button", { name: "이어 작업하기" })[0]);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(screen.getByLabelText("파일 1 연결 장면")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "목록 비우기" }));
  expect(screen.queryByLabelText("파일 1 연결 장면")).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image"); expect(mock.upload).not.toHaveBeenCalled();
});
it("rejects invalid images and oversized batches before uploading", async () => {
  mock.inspect.mockRejectedValueOnce(new Error("손상된 이미지")); await open(); await files("broken.png", "02.png");
  expect(region().textContent).toContain("손상된 이미지"); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/2")); expect(mock.upload).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("일괄 배치 이미지 파일 선택"), { target: { files: Array.from({ length: 40 }, (_, i) => new File(["png"], `${i}.png`)) } });
  expect(screen.getByRole("alert").textContent).toContain("최대 40장"); expect(mock.upload).toHaveBeenCalledOnce();
});
it("does not repeat a successful upload when only project saving failed", async () => {
  mock.save.mockRejectedValue(new Error("저장 연결 실패")); await open(); await files("02.png"); fireEvent.click(apply());
  await waitFor(() => expect(region().textContent).toContain("연결 완료 1/1")); expect(region().textContent).toContain("프로젝트 저장은 상단에서");
  expect(mock.upload).toHaveBeenCalledOnce(); expect(within(region()).queryByRole("button", { name: "실패한 파일만 재시도" })).toBeNull();
  mock.save.mockResolvedValue(undefined); fireEvent.click(screen.getAllByRole("button", { name: "저장 다시 시도" })[0]);
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2)); expect(mock.upload).toHaveBeenCalledOnce(); expect(saved().scenes[1].selected_candidate_id).toBe("02.png");
});
