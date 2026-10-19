// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VisitorTrends, type VisitorTrendsData } from "./VisitorTrends";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), context: null as object | null }));
vi.mock("./cloud-session", () => ({ getCloudSession: () => mock.context }));
const data: VisitorTrendsData = {
  today: "2026-10-19", today_visitors: 3, week_visitors: 3,
  daily: Array.from({ length: 14 }, (_, index) => ({ period_start: `2026-10-${String(index + 6).padStart(2, "0")}`, period_end: `2026-10-${String(index + 6).padStart(2, "0")}`, visitors: index === 13 ? 3 : index === 12 ? 4 : 0 })),
  weekly: [{ period_start: "2026-10-12", period_end: "2026-10-18", visitors: 7 }, { period_start: "2026-10-19", period_end: "2026-10-19", visitors: 3 }],
};
let allowed: boolean;
let error: { code: string } | null;
beforeEach(() => {
  vi.clearAllMocks(); allowed = true; error = null;
  mock.context = { userId: "alice", client: { rpc: mock.rpc } };
  mock.rpc.mockImplementation((name: string) => ({ abortSignal: async () => name === "great100_is_analytics_admin" ? { data: allowed, error: null } : { data: structuredClone(data), error } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows nothing in local mode or to non-admin users and never fetches their totals", async () => {
  mock.context = null; const local = render(<VisitorTrends />);
  expect(mock.rpc).not.toHaveBeenCalled(); expect(local.container.textContent).toBe(""); local.unmount();
  mock.context = { userId: "bob", client: { rpc: mock.rpc } }; allowed = false;
  const user = render(<VisitorTrends />);
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("great100_is_analytics_admin"));
  expect(user.container.textContent).toBe(""); expect(mock.rpc).not.toHaveBeenCalledWith("great100_visitor_trends");
});

it("switches daily/weekly charts and exposes each period's visitor count to keyboard users", async () => {
  render(<VisitorTrends />);
  const daily = await screen.findByRole("group", { name: "일별 방문자 수" });
  expect(within(daily).getAllByRole("button")).toHaveLength(14);
  const point = screen.getByRole("button", { name: "10.18 방문자 4명" });
  fireEvent.focus(point); expect(point.className).toContain("active");
  fireEvent.click(screen.getByRole("button", { name: "주별" }));
  expect(screen.getByRole("button", { name: "주별" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(screen.getByRole("group", { name: "주별 방문자 수" })).getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "10.12–10.18 방문자 7명" })).toBeTruthy();
  expect(mock.rpc.mock.calls.filter(([name]) => name === "great100_visitor_trends")).toHaveLength(1);
});

it("shows an error instead of invented zero totals and allows retry", async () => {
  error = { code: "network" }; render(<VisitorTrends />);
  expect((await screen.findByRole("status")).textContent).toContain("불러오지 못했어요");
  expect(screen.queryByRole("group", { name: "일별 방문자 수" })).toBeNull();
  error = null; fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByRole("group", { name: "일별 방문자 수" });
});

it("refreshes after a visit is recorded and removes the card if admin access is revoked", async () => {
  render(<VisitorTrends />); await screen.findByRole("group", { name: "일별 방문자 수" });
  window.dispatchEvent(new Event("great100:visit-recorded"));
  await waitFor(() => expect(mock.rpc.mock.calls.filter(([name]) => name === "great100_visitor_trends")).toHaveLength(2));
  error = { code: "42501" }; window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "방문 추이" })).toBeNull());
});

it("aborts pending requests when the dashboard unmounts", async () => {
  let requestSignal: AbortSignal | undefined;
  mock.rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { requestSignal = signal; return new Promise(() => {}); } }));
  const view = render(<VisitorTrends />);
  expect(requestSignal?.aborted).toBe(false); view.unmount(); expect(requestSignal?.aborted).toBe(true);
});
