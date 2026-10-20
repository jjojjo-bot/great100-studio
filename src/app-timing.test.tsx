// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import type { ProjectData } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), inspect: vi.fn(), store: vi.fn(), discard: vi.fn(), generate: vi.fn() }));
vi.mock("./Auth", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, AccountMenu: () => null }));
vi.mock("./SceneTimeline", () => ({ ScenePreviewPane: () => null }));
vi.mock("./platform", async original => ({ ...await original<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save,
  inspectSceneNarration: mock.inspect, savePreparedNarration: mock.store, discardSceneNarration: mock.discard, generateImages: mock.generate,
  getSceneNarration: async () => new Blob(["voice"]), isTauri: () => false, getAccessCode: () => "" }));
let project: ProjectData;
const recording = { id: "file-v2", name: "long.wav", path: "narration_file-v2.wav", mime_type: "audio/wav", duration_sec: 14 };
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:voice"; static revokeObjectURL = () => {}; });
  project = editorProject(); mock.list.mockResolvedValue([project]); mock.save.mockResolvedValue(undefined); mock.discard.mockResolvedValue(undefined);
  mock.inspect.mockImplementation(async (file: File) => ({ file, extension: "wav", mime: "audio/wav", duration: 14 }));
  mock.store.mockResolvedValue(recording);
  mock.generate.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
}
async function upload() {
  fireEvent.change(screen.getByLabelText("Scene 1 내레이션 파일 선택"), { target: { files: [new File(["voice"], "long.wav", { type: "audio/wav" })] } });
  await screen.findByRole("region", { name: "녹음 길이 조정안" });
}

it("previews before storing, then changes all scene times in one undoable edit while keeping the imported recording", async () => {
  await open(); await upload();
  expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("자막 비율 재배치"));
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  const changed = mock.save.mock.calls.at(-1)![0];
  expect(changed).toMatchObject({ editor_version: 2, source: project.source });
  expect(changed.scenes[0]).toMatchObject({ duration: 14, narration_audio: recording });
  expect(changed.scenes[1].start_sec).toBe(14);
  expect(changed.scenes[0].captions[0]).toMatchObject({ id: project.scenes[0].captions![0].id, end_sec: 14 });
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  const undo = mock.save.mock.calls.at(-1)![0];
  expect(undo.scenes[1].start_sec).toBe(10); expect(undo.scenes[0].duration).toBe(10);
  expect(undo.scenes[0].narration_audio).toEqual(recording);
  expect(screen.getByText(/녹음은 보관되어 있으며/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
  expect(mock.save.mock.calls.at(-1)![0].scenes[1].start_sec).toBe(14);
});

it("keeps pending audio unselected after concurrent timing edits and reuses it when the refreshed proposal is applied", async () => {
  let finish!: (value: typeof recording) => void;
  mock.store.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); await upload();
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(mock.store).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Caption 1 종료"), { target: { value: "9" } });
  await act(async () => finish(recording));
  expect(screen.getByText(/시간이나 녹음이 변경되었습니다/)).toBeTruthy();
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].duration).toBe(10);
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].narration_audio).toBeUndefined();
  fireEvent.click(screen.getByLabelText("자막 비율 재배치"));
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(mock.save.mock.calls.at(-1)![0].scenes[0].duration).toBe(14));
  expect(mock.store).toHaveBeenCalledOnce();
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].captions[0].end_sec).toBe(12.6);
});

it("cancels a long-file proposal without saving the file or changing the project", async () => {
  await open(); await upload(); fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.queryByRole("region", { name: "녹음 길이 조정안" })).toBeNull();
  expect(mock.store).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});

it("preserves a generation result started before the timing-format upgrade, including after undo", async () => {
  let finish!: (value: unknown[]) => void;
  mock.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "후보 2장 생성" }));
  await waitFor(() => expect(mock.generate).toHaveBeenCalledOnce());
  await upload(); fireEvent.click(screen.getByLabelText("자막 비율 재배치"));
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  await waitFor(() => expect(mock.save.mock.calls.at(-1)![0].editor_version).toBe(2));
  await act(async () => finish([{ id: "late", path: "late.png", preview_url: "data:image/png;base64,a", mode: "mock", created_at: "now" }]));
  expect(mock.save.mock.calls.at(-1)![0].scenes[0]).toMatchObject({ duration: 14, narration_audio: recording, candidates: [{ id: "late" }] });
  fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
  expect(mock.save.mock.calls.at(-1)![0].scenes[0]).toMatchObject({ duration: 10, narration_audio: recording, candidates: [{ id: "late" }] });
});

it("requires caption scaling when an existing short recording would cut off the last caption", async () => {
  project.scenes[0].narration_audio = { name: "short.wav", path: "old.wav", mime_type: "audio/wav", duration_sec: 5 };
  await open(); fireEvent.click(screen.getByRole("button", { name: "녹음 길이에 맞추기" }));
  expect(screen.getByRole("button", { name: "시간 조정 적용" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText("자막 비율 재배치"));
  fireEvent.click(screen.getByRole("button", { name: "시간 조정 적용" }));
  expect(mock.save.mock.calls.at(-1)![0].scenes[0].duration).toBe(5);
  expect(mock.store).not.toHaveBeenCalled();
});

it("allows microphone recording beyond the current scene duration and stops before the 120 second limit", async () => {
  const stopTrack = vi.fn(); const stopRecording = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported = () => true;
    state = "inactive"; mimeType = "audio/webm";
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() { stopRecording(); this.state = "inactive"; this.onstop?.(); }
  });
  await open(); vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "녹음 시작" })); });
  await act(async () => { vi.advanceTimersByTime(11_000); });
  expect(stopRecording).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /녹음 마치기/ }).textContent).toContain("11.0초");
  await act(async () => { vi.advanceTimersByTime(109_000); });
  expect(stopRecording).toHaveBeenCalledOnce(); expect(stopTrack).toHaveBeenCalledOnce();
});
