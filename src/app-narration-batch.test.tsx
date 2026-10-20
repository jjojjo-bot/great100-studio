// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import type { ProjectData, Scene, SceneNarrationAudio } from "./types";
import type { PreparedNarration } from "./platform";
import App from "./App";
const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), store: vi.fn(), inspect: vi.fn(), read: vi.fn(), generate: vi.fn(), discard: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./FullVideoPreview", () => ({ FullVideoPreview: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, savePreparedNarration: mock.store, inspectSceneNarration: mock.inspect, getSceneNarration: mock.read, discardSceneNarration: mock.discard, generateImages: mock.generate, isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData, urlNumber = 0;
const audio = (id: string, duration = 2): SceneNarrationAudio => ({ id, name: `${id}.wav`, path: `${id}.wav`, mime_type: "audio/wav", duration_sec: duration });
beforeEach(() => {
  vi.clearAllMocks(); urlNumber = 0; window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => `blob:voice-${++urlNumber}`); static revokeObjectURL = vi.fn(); });
  project = editorProject(); project.scenes.forEach((scene, i) => { scene.title = `녹음 장면 ${i + 1}`; scene.candidates = [{ id: `image-${i}`, path: `image-${i}.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" }]; scene.selected_candidate_id = `image-${i}`; });
  project.scenes[0].narration_audio = audio("old"); project = prepareEditorWrite(project); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.read.mockResolvedValue(new Blob(["old voice"]));
  mock.inspect.mockImplementation(async (file: File) => ({ file, duration: file.name.includes("long") ? 12.3 : 2, extension: "wav", mime: "audio/wav" }));
  mock.store.mockImplementation(async (_p: ProjectData, _s: Scene, prepared: PreparedNarration) => audio(prepared.file.name, prepared.duration));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const panel = () => screen.getByRole("region", { name: "내레이션 일괄 배치" });
const button = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const saved = (): ProjectData => mock.save.mock.calls.at(-1)![0];
const result = () => within(panel()).getByRole("status").textContent;
async function open() { render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" })); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" })); fireEvent.click(button("녹음 가져오기")); }
async function files(...names: string[]) { fireEvent.change(screen.getByLabelText("일괄 내레이션 파일 선택"), { target: { files: names.map(name => new File(["wave"], name, { type: "audio/wav" })) } }); await waitFor(() => expect(panel().textContent).not.toContain("녹음 확인 중")); }
const apply = () => fireEvent.click(button(/^녹음 연결안 적용/));

it("previews files and mappings without saving, keeps old narration and applies only fitting empty scenes", async () => {
  await open(); const previousReads = mock.read.mock.calls.length; await files("scene_01.wav", "scene_02.wav", "portrait.wav"); expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.read).toHaveBeenCalledTimes(previousReads);
  expect((screen.getByLabelText("녹음 파일 3 연결 장면") as HTMLSelectElement).value).toBe(""); fireEvent.click(button("기존 녹음 듣기")); await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(previousReads + 1)); apply();
  await waitFor(() => expect(result()).toContain("녹음 적용 1/3")); expect(mock.store).toHaveBeenCalledOnce(); expect(saved().scenes[0].narration_audio?.id).toBe("old"); expect(saved().scenes[1].narration_audio?.id).toBe("scene_02.wav"); expect(saved().source).toEqual(project.source); expect(mock.generate).not.toHaveBeenCalled();
});
it("replaces only after explicit selection, supports undo and retains both originals", async () => {
  await open(); await files("scene_01.wav"); fireEvent.click(screen.getByLabelText("새 녹음으로 교체")); apply(); await waitFor(() => expect(result()).toContain("녹음 적용 1/1"));
  expect(saved().scenes[0].narration_audio?.id).toBe("scene_01.wav"); fireEvent.click(screen.getByRole("button", { name: "실행 취소" })); await waitFor(() => expect(saved().scenes[0].narration_audio?.id).toBe("old"));
  expect(saved().media!.assets.some(asset => asset.id === "narration:scene_01.wav")).toBe(true); fireEvent.click(screen.getByRole("button", { name: "다시 실행" })); await waitFor(() => expect(saved().scenes[0].narration_audio?.id).toBe("scene_01.wav"));
});
it("shows explicit long-file review, applies timing and narration together and undoes them together", async () => {
  await open(); await files("scene_02_long.wav"); expect(button(/^녹음 연결안 적용/).hasAttribute("disabled")).toBe(true); expect(mock.store).not.toHaveBeenCalled(); fireEvent.click(button("녹음 파일 1 시간 조정 검토"));
  const review = screen.getByRole("region", { name: "일괄 녹음 시간 조정 검토" }); fireEvent.click(within(review).getByLabelText("자막 비율 재배치")); fireEvent.click(within(review).getByRole("button", { name: "시간 조정·녹음 적용" }));
  await waitFor(() => expect(result()).toContain("녹음 적용 1/1")); expect(saved().scenes[1].duration).toBe(12.3); expect(saved().scenes[2].start_sec).toBe(22.3); expect(saved().scenes[1].captions![0].end_sec).toBe(22.3);
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" })); await waitFor(() => expect(saved().scenes[1].duration).toBe(10)); expect(saved().scenes[1].narration_audio).toBeUndefined(); expect(saved().media!.assets.some(asset => asset.id === "narration:scene_02_long.wav")).toBe(true);
});
it("does not silently overwrite a scene with a second file and retries only upload failures", async () => {
  mock.store.mockRejectedValueOnce(new Error("업로드 실패")); await open(); await files("scene_02.wav", "scene_02_second.wav", "scene_03.wav"); apply();
  await waitFor(() => expect(result()).toContain("녹음 적용 1/3")); expect(mock.store).toHaveBeenCalledTimes(2); fireEvent.click(button("실패한 녹음만 재시도")); await waitFor(() => expect(result()).toContain("녹음 적용 2/3")); expect(mock.store).toHaveBeenCalledTimes(3); expect(saved().scenes[1].narration_audio?.id).toBe("scene_02.wav");
});
it("recovers a project save failure without storing the successfully uploaded file again", async () => {
  mock.save.mockRejectedValueOnce(new Error("프로젝트 저장 실패")); await open(); await files("scene_02.wav"); apply(); await waitFor(() => expect(result()).toContain("녹음 적용 1/1")); expect(panel().textContent).toContain("상단에서 다시 시도");
  fireEvent.click(screen.getAllByRole("button", { name: "저장 다시 시도" })[0]); await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2)); expect(mock.store).toHaveBeenCalledOnce();
});
it("finishes against the same scene ID after moving it while file storage is pending", async () => {
  let finish!: (value: SceneNarrationAudio) => void; mock.store.mockReturnValueOnce(new Promise<SceneNarrationAudio>(resolve => { finish = resolve; }));
  await open(); await files("scene_02.wav"); apply(); fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" })); fireEvent.click(screen.getByRole("button", { name: "이 장면을 뒤로 이동" })); await act(async () => finish(audio("late")));
  await waitFor(() => expect(saved().scenes[2].narration_audio?.id).toBe("late")); expect(saved().scenes[2].id).toBe("scene_02"); expect(saved().scenes[1].narration_audio).toBeUndefined();
});
it("retains a file after its target is merged away and reuses the same original on another scene", async () => {
  let finish!: (value: SceneNarrationAudio) => void; mock.store.mockReturnValueOnce(new Promise<SceneNarrationAudio>(resolve => { finish = resolve; }));
  await open(); await files("scene_02.wav"); apply(); fireEvent.click(screen.getByRole("button", { name: "Scene 1 편집" })); fireEvent.click(screen.getByRole("button", { name: "다음 장면과 합치기" })); await act(async () => finish(audio("detached")));
  await waitFor(() => expect(saved().media!.assets.some(asset => asset.id === "narration:detached")).toBe(true)); expect(saved().scenes.every(scene => scene.narration_audio?.id !== "detached")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" })); fireEvent.change(screen.getByLabelText("녹음 파일 1 연결 장면"), { target: { value: "scene_03" } }); apply(); await waitFor(() => expect(result()).toContain("녹음 적용 1/1"));
  expect(mock.store).toHaveBeenCalledOnce(); expect(saved().scenes[1].narration_audio?.id).toBe("detached"); expect(saved().media!.assets.find(asset => asset.id === "narration:detached")!.local_key).toBe(`${project.id}:narration:scene_02:detached`);
});
it("retains a saved file after script changes, then requires explicit retry without a second upload", async () => {
  let finish!: (value: SceneNarrationAudio) => void; mock.store.mockReturnValueOnce(new Promise<SceneNarrationAudio>(resolve => { finish = resolve; }));
  await open(); await files("scene_02.wav"); apply(); fireEvent.click(screen.getByRole("button", { name: "Scene 2 편집" })); fireEvent.change(screen.getByLabelText("Caption 1 텍스트"), { target: { value: "바뀐 대본" } }); await act(async () => finish(audio("cached")));
  await waitFor(() => expect(saved().media!.assets.some(asset => asset.id === "narration:cached")).toBe(true)); expect(saved().scenes[1].narration_audio).toBeUndefined(); fireEvent.click(screen.getByRole("button", { name: "작업 보드로 돌아가기" }));
  fireEvent.click(button("실패한 녹음만 재시도")); await waitFor(() => expect(result()).toContain("녹음 적용 1/1")); expect(mock.store).toHaveBeenCalledOnce();
});
it("stops after the current file and resumes the rest without duplicating the completed upload", async () => {
  let finish!: (value: SceneNarrationAudio) => void; mock.store.mockReturnValueOnce(new Promise<SceneNarrationAudio>(resolve => { finish = resolve; }));
  await open(); await files("scene_02.wav", "scene_03.wav"); apply(); fireEvent.click(button("현재 녹음 완료 후 중단")); await act(async () => finish(audio("first"))); await waitFor(() => expect(result()).toContain("녹음 적용 1/2")); expect(mock.store).toHaveBeenCalledOnce(); apply(); await waitFor(() => expect(result()).toContain("녹음 적용 2/2")); expect(mock.store).toHaveBeenCalledTimes(2);
});
it("rejects invalid files and oversized batches and revokes previews when clearing the list", async () => {
  mock.inspect.mockRejectedValueOnce(new Error("손상된 녹음")); await open(); await files("broken.wav", "scene_02.wav"); expect(panel().textContent).toContain("손상된 녹음"); expect(mock.store).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("일괄 내레이션 파일 선택"), { target: { files: Array.from({ length: 40 }, (_, i) => new File(["wave"], `${i}.wav`, { type: "audio/wav" })) } }); expect(within(panel()).getByRole("alert").textContent).toContain("최대 40개"); fireEvent.click(button("녹음 목록 비우기")); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-1"); expect(mock.discard).not.toHaveBeenCalled();
});
