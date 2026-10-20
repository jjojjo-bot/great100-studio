import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { generateImages, resolveReferenceImage } from "./platform";

const mock = vi.hoisted(() => ({ context: vi.fn(), download: vi.fn(), invoke: vi.fn() }));
vi.mock("./cloud", async original => ({ ...await original<typeof import("./cloud")>(), cloudContext: mock.context, downloadCloudFile: mock.download }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
function fixture() {
  const project = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  project.anchor.candidates = [{ id: "uploaded-anchor", path: "anchor.png", mode: "uploaded", preview_url: imageUrl, created_at: "now" }];
  project.anchor.selected_candidate_id = "uploaded-anchor";
  return project;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() })));
  mock.context.mockReturnValue(null);
});
afterEach(() => vi.unstubAllGlobals());

it("uses an uploaded local original after the saved project is reopened", async () => {
  const reopened = JSON.parse(JSON.stringify(fixture()));
  expect(await resolveReferenceImage(reopened)).toBe(imageUrl);
  expect(mock.download).not.toHaveBeenCalled();
});

it("uses the cloud object key to refresh an expired preview URL", async () => {
  const project = fixture();
  project.cloud_owner_id = "alice";
  Object.assign(project.anchor.candidates[0], { storage_key: "alice/project/anchor.png", preview_url: "https://expired.example/anchor" });
  mock.context.mockReturnValue({ userId: "alice" });
  mock.download.mockResolvedValue(await (await fetch(imageUrl)).blob());
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await resolveReferenceImage(project)).toBe(imageUrl);
  expect(mock.download).toHaveBeenCalledWith(project, "alice/project/anchor.png");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("retains the original data URL through the shared Tauri generation path", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  mock.invoke.mockResolvedValue([]);
  const project = fixture();
  const request = { project_path: project.project_path, asset_kind: "scene" as const, scene_number: 1, prompt: "새 구도", count: 2, reference_image: await resolveReferenceImage(project) };
  await generateImages(request);
  expect(mock.invoke).toHaveBeenCalledWith("generate_images", { request: expect.objectContaining({ reference_image: imageUrl }) });
});

it("skips mock anchors and fails before generating when the selected real original is missing", async () => {
  const project = fixture(); project.anchor.candidates[0].mode = "mock";
  expect(await resolveReferenceImage(project)).toBeUndefined();
  project.anchor.candidates[0].mode = "uploaded";
  project.anchor.candidates[0].preview_url = "";
  await expect(resolveReferenceImage(project)).rejects.toThrow("원본을 찾지 못했습니다");
  expect(mock.invoke).not.toHaveBeenCalled();
});
