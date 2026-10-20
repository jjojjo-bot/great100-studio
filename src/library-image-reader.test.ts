import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { readOriginalImageCandidate } from "./library-image-reader";
import type { MediaAsset } from "./types";
const mock = vi.hoisted(() => ({ read: vi.fn(), native: vi.fn() }));
vi.mock("./platform", () => ({ getMediaAsset: mock.read, isTauri: mock.native }));
const asset: MediaAsset = { id: "candidate:kept", kind: "image", path: "old/scene01/kept.png", mime_type: "image/png", storage_key: "original-key" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
beforeEach(() => { vi.clearAllMocks(); mock.native.mockReturnValue(false); mock.read.mockResolvedValue(new Blob([png], { type: "image/png" })); });
afterEach(() => vi.unstubAllGlobals());
it("reads the retained original and reuses its ID, path and storage key without uploading or re-encoding bytes", async () => {
  const p = editorProject(), decode = vi.fn().mockResolvedValue(undefined), next = await readOriginalImageCandidate(p, asset, decode);
  expect(mock.read).toHaveBeenCalledWith(p, asset); expect(next).toMatchObject({ id: "kept", path: asset.path, storage_key: "original-key", media_type: "image" });
  expect(new Uint8Array(await (await fetch(next.preview_url)).arrayBuffer())).toEqual(png); expect(decode).toHaveBeenCalledOnce();
});
it("preserves mock SVG originals and candidate metadata when the source still exists in another palette", async () => {
  const p = editorProject(), svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>', svgAsset = { ...asset, mime_type: "image/svg+xml", path: "old/kept.svg" };
  p.anchor.candidates = [{ id: "kept", path: svgAsset.path, preview_url: "", mode: "mock", created_at: "original-time", storage_key: asset.storage_key }];
  mock.read.mockResolvedValue(new Blob([svg])); const result = await readOriginalImageCandidate(p, svgAsset, async () => {});
  expect(result.mode).toBe("mock"); expect(result.created_at).toBe("original-time"); expect(await (await fetch(result.preview_url)).text()).toBe(svg);
});
it("uses original inline bytes when an account save has not yet hydrated the storage key in this tab", async () => {
  const inline = { ...asset, storage_key: undefined, inline_data: "data:image/png;base64,iVBORw0KGgo=" };
  await readOriginalImageCandidate(editorProject(), inline, async () => {}); expect(mock.read).not.toHaveBeenCalled();
  mock.native.mockReturnValue(true); await readOriginalImageCandidate(editorProject(), inline, async () => {}); expect(mock.read).toHaveBeenCalledOnce();
});
it("rejects missing, oversized, mismatched, corrupt and unsupported originals before a candidate is added", async () => {
  const p = editorProject(), decode = vi.fn().mockResolvedValue(undefined);
  mock.read.mockResolvedValue(null); await expect(readOriginalImageCandidate(p, asset, decode)).rejects.toThrow("원본이 없습니다");
  mock.read.mockResolvedValue(new Blob([new Uint8Array(12_000_001)])); await expect(readOriginalImageCandidate(p, asset, decode)).rejects.toThrow("12MB");
  mock.read.mockResolvedValue(new Blob([png])); await expect(readOriginalImageCandidate(p, { ...asset, mime_type: "image/jpeg" }, decode)).rejects.toThrow("형식");
  await expect(readOriginalImageCandidate(p, asset, vi.fn().mockRejectedValue(new Error("손상된 원본")))).rejects.toThrow("손상된 원본");
  await expect(readOriginalImageCandidate(p, { ...asset, id: "external-image" }, decode)).rejects.toThrow("식별 정보");
});
