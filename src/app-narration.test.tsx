// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import type { NarrationGeneration, ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), inspect: vi.fn(), store: vi.fn(), discard: vi.fn(), generate: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save,
  inspectSceneNarration: mock.inspect, savePreparedNarration: mock.store, discardSceneNarration: mock.discard,
  getSceneNarration: async () => new Blob(["voice"]), isTauri: () => false, getAccessCode: () => "" }));
vi.mock("./narration-generation", async original => ({ ...await original<typeof import("./narration-generation")>(), generateSceneNarration: mock.generate }));
let project: ProjectData;
let generation: NarrationGeneration;
const recording = { id: "generated", name: "ai.mp3", path: "generated.mp3", mime_type: "audio/mpeg", duration_sec: 14 };
const file = () => new File(["voice"], "ai.mp3", { type: "audio/mpeg" });
beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_AI_NARRATION", "true");
  vi.clearAllMocks(); window.history.replaceState(null, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:voice"; static revokeObjectURL = () => {}; });
  project = editorProject(); project.scenes[0].narration_audio = { ...recording, id: "old", path: "old.mp3", duration_sec: 3 };
  generation = { provider: "openai", model: "gpt-audio-1.5", request_id: "request", input_text: project.scenes[0].captions![0].text, transcript: project.scenes[0].captions![0].text, voice: "alloy", pace: "normal", created_at: "now" };
  mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.discard.mockResolvedValue(undefined); mock.store.mockResolvedValue(recording);
  mock.inspect.mockImplementation(async (value: File) => ({ file: value, extension: "mp3", mime: "audio/mpeg", duration: 14 }));
  mock.generate.mockResolvedValue({ file: file(), generation });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
}
async function generate() { fireEvent.click(screen.getByRole("button", { name: "이 장면 음성 생성" })); return await screen.findByRole("region", { name: "생성한 AI 음성 검토" }); }

it("previews before replacing the old recording, then applies voice and scaled timings in one undoable edit", async () => {
  await open(); const preview = await generate(); expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Scene 1 내레이션 미리듣기")).toBeTruthy();
  expect((within(preview).getByLabelText("음성 길이에 맞추기") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(preview).getByRole("button", { name: "이 음성 적용" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  const after = mock.save.mock.calls.at(-1)![0];
  expect(after.scenes[0]).toMatchObject({ duration: 14, narration_audio: { id: "generated", generation } });
  expect(after.scenes[0].captions[0].end_sec).toBe(14); expect(after.source).toEqual(project.source);
  expect(after.scenes[1].start_sec).toBe(14); expect(after.media.assets.some((asset: any) => asset.path === "old.mp3")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  const undo = mock.save.mock.calls.at(-1)![0]; expect(undo.scenes[0]).toMatchObject({ duration: 10, narration_audio: { id: "old" } });
  expect(undo.media.assets.some((asset: any) => asset.generation?.request_id === "request")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.id).toBe("generated");
});
it("blocks an old response after the user edits captions while the request is running", async () => {
  let finish!: (value: unknown) => void; mock.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "이 장면 음성 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Caption 1 텍스트"), { target: { value: "새 대본입니다" } });
  await act(async () => finish({ file: file(), generation }));
  const preview = await screen.findByRole("region", { name: "생성한 AI 음성 검토" });
  expect(within(preview).getByRole("button", { name: "이 음성 적용" }).hasAttribute("disabled")).toBe(true);
  expect(mock.store).not.toHaveBeenCalled(); expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.id).toBe("old");
});
it("blocks stale options and cancels a preview without saving audio", async () => {
  await open(); const preview = await generate();
  fireEvent.change(screen.getByLabelText("AI 내레이션 목소리"), { target: { value: "coral" } });
  expect(within(preview).getByRole("button", { name: "이 음성 적용" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(preview).getByRole("button", { name: "생성한 음성 취소" }));
  expect(screen.queryByRole("region", { name: "생성한 AI 음성 검토" })).toBeNull(); expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});
it("rechecks concurrent edits after storage and reuses the saved file on a valid retry", async () => {
  let finish!: (value: unknown) => void; mock.store.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); await generate(); fireEvent.click(screen.getByRole("button", { name: "이 음성 적용" }));
  await waitFor(() => expect(mock.store).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Caption 1 종료"), { target: { value: "9" } });
  await act(async () => finish(recording));
  expect(await screen.findByText(/대본·시간·녹음이 변경되었습니다/)).toBeTruthy();
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.id).toBe("old");
  fireEvent.click(screen.getByRole("button", { name: "이 음성 적용" }));
  await waitFor(() => expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.id).toBe("generated"));
  expect(mock.store).toHaveBeenCalledOnce(); expect(mock.save.mock.calls.at(-1)![0].scenes[0].captions[0].end_sec).toBe(12.6);
});
it("keeps a failed project save visible without throwing away the selected generated voice", async () => {
  mock.save.mockRejectedValue(new Error("offline"));
  await open(); await generate(); fireEvent.click(screen.getByRole("button", { name: "이 음성 적용" }));
  expect(await screen.findByText(/저장 실패: Error: offline/)).toBeTruthy();
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.generation).toEqual(generation);
  expect(screen.queryByRole("region", { name: "생성한 AI 음성 검토" })).toBeNull();
});
it("keeps provider errors retryable without replacing audio or issuing an automatic second request", async () => {
  mock.generate.mockRejectedValue(new Error("음성 생성 한도에 도달했습니다"));
  await open(); fireEvent.click(screen.getByRole("button", { name: "이 장면 음성 생성" }));
  expect(await screen.findByText("음성 생성 한도에 도달했습니다")).toBeTruthy();
  expect(mock.generate).toHaveBeenCalledOnce(); expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "이 장면 음성 생성" }).hasAttribute("disabled")).toBe(false);
});
it("marks the applied AI recording as out of date after a caption edit", async () => {
  await open(); await generate(); fireEvent.click(screen.getByRole("button", { name: "이 음성 적용" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Caption 1 텍스트"), { target: { value: "바뀐 발화" } });
  expect(await screen.findByText(/대본이 변경되어 현재 AI 음성과 다릅니다/)).toBeTruthy();
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio.id).toBe("generated");
});
it("does not accept a late result after cancelling generation waiting", async () => {
  let finish!: (value: unknown) => void; mock.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "이 장면 음성 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "생성 대기 중단" }));
  await act(async () => finish({ file: file(), generation }));
  expect(screen.queryByRole("region", { name: "생성한 AI 음성 검토" })).toBeNull(); expect(mock.inspect).not.toHaveBeenCalled(); expect(mock.store).not.toHaveBeenCalled();
});
it("hides API generation by default and copies the current script for recording or external audio upload", async () => {
  vi.stubEnv("VITE_ENABLE_AI_NARRATION", undefined);
  const copy = vi.fn(async () => {}); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  await open();
  expect(screen.queryByRole("region", { name: "AI 내레이션 생성" })).toBeNull();
  expect(screen.getByRole("button", { name: "다시 녹음" })).toBeTruthy(); expect(screen.getByRole("button", { name: "파일 업로드" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "내레이션 대본 복사" }));
  await screen.findByRole("button", { name: "대본 복사됨" }); expect(copy).toHaveBeenCalledWith(project.scenes[0].captions![0].text);
  expect(mock.generate).not.toHaveBeenCalled();
});
