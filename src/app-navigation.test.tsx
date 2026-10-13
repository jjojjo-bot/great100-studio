// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

vi.mock("./platform", async (importOriginal) => {
  const original = await importOriginal<typeof import("./platform")>();
  return { ...original, listProjects: async () => [], getNextProjectEpisode: async () => 1, isTauri: () => false, getAccessCode: () => "" };
});

afterEach(cleanup);

it("returns to the dashboard before project creation and retains the setup draft", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "새 인물 프로젝트" }));
  expect((screen.getByLabelText("자동 회차") as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText("인물명 직접 입력"), { target: { value: "세종대왕" } });
  fireEvent.change(document.querySelector(".source-input")!, { target: { value: "작성 중인 제작안" } });
  fireEvent.click(screen.getByRole("button", { name: /대시보드$/ }));
  expect(screen.getByRole("button", { name: "새 인물 프로젝트" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "새 인물 프로젝트" }));
  expect((screen.getByLabelText("인물명 직접 입력") as HTMLInputElement).value).toBe("세종대왕");
  expect(document.querySelector<HTMLTextAreaElement>(".source-input")!.value).toBe("작성 중인 제작안");
  fireEvent.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
  expect(screen.getByRole("button", { name: "새 인물 프로젝트" })).toBeTruthy();
  await waitFor(() => expect(window.history.state.great100.step).toBe(0));
});

it("uses browser back and forward for setup navigation without losing the chosen person", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "새 인물 프로젝트" }));
  fireEvent.change(screen.getByLabelText("100인 목록에서 인물 선택"), { target: { value: "이순신" } });
  window.history.back();
  await waitFor(() => expect(screen.getByRole("button", { name: "새 인물 프로젝트" })).toBeTruthy());
  expect(window.history.state.great100.step).toBe(0);
  window.history.forward();
  await waitFor(() => expect((screen.getByLabelText("인물명 직접 입력") as HTMLInputElement).value).toBe("이순신"));
  expect(window.history.state.great100.step).toBe(1);
});
