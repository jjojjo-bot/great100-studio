// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import App from "./App";

const mock = vi.hoisted(() => ({ readiness: vi.fn(), list: vi.fn(), save: vi.fn(), download: vi.fn() }));
vi.mock("./Auth", () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
  AccountMenu: ({ storageStatus, saving }: { storageStatus: string; saving: boolean }) => <div><output>{storageStatus}</output><button disabled={saving}>로그아웃</button></div>,
}));
vi.mock("./cloud", async importOriginal => ({ ...await importOriginal<typeof import("./cloud")>(), cloudContext: () => ({ userId: "alice" }), checkCloudStorage: mock.readiness }));
vi.mock("./platform", async importOriginal => ({
  ...await importOriginal<typeof import("./platform")>(), listProjects: mock.list, saveProject: mock.save, exportProjectZip: mock.download,
  localProjectsForImport: async () => [], getAccessCode: () => "", isTauri: () => false,
}));
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, "", "/");
  mock.readiness.mockResolvedValue({ databaseReady: true, storageReady: true });
  mock.list.mockResolvedValue([{ ...createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT), cloud_owner_id: "alice" }]);
  mock.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("waits for both DB and file storage before allowing new work", async () => {
  mock.readiness.mockResolvedValue({ databaseReady: true, storageReady: false });
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "연결 다시 확인" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("button", { name: "새 인물 프로젝트" }).hasAttribute("disabled")).toBe(true);
  expect(within(screen.getByRole("navigation", { name: "제작 단계" })).getByRole("button", { name: /프로젝트$/ }).hasAttribute("disabled")).toBe(true);
  expect(mock.list).not.toHaveBeenCalled();
  mock.readiness.mockResolvedValue({ databaseReady: true, storageReady: true });
  fireEvent.click(screen.getByRole("button", { name: "연결 다시 확인" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "새 인물 프로젝트" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByText("계정에 저장됨")).toBeTruthy();
});

it("keeps failed edits available for ZIP backup and explicitly reloads the latest project", async () => {
  mock.save.mockRejectedValue(new Error("다른 PC에서 수정되었습니다"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "이어 작업하기" }));
  fireEvent.change(screen.getByLabelText("장면 1 영상 자막"), { target: { value: "저장 실패한 편집본" } });
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "로그아웃" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "편집본 ZIP 보관" }));
  expect(mock.download.mock.calls[0][0].scenes[0].caption).toBe("저장 실패한 편집본");
  const latest = { ...createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT), cloud_owner_id: "alice" };
  latest.id = mock.download.mock.calls[0][0].id; latest.scenes[0].caption = "서버의 최신 편집본";
  mock.list.mockResolvedValue([latest]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "최신 작업 불러오기" }));
  await waitFor(() => expect((screen.getByLabelText("장면 1 영상 자막") as HTMLTextAreaElement).value).toBe("서버의 최신 편집본"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "로그아웃" }).hasAttribute("disabled")).toBe(false);
});
