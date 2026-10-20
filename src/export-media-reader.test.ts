import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { abortable, inspectExportMedia } from "./export-media-reader";
import type { MediaCheckItem } from "./export-media-check";
const mock = vi.hoisted(() => ({ read: vi.fn(), native: vi.fn(), cloud: vi.fn(), download: vi.fn(), open: vi.fn(), frame: vi.fn(), dispose: vi.fn(), image: vi.fn(), decode: vi.fn(), mpeg: vi.fn(), close: vi.fn(), revoke: vi.fn() }));
vi.mock("./platform", () => ({ getMediaAsset: mock.read, isTauri: mock.native }));
vi.mock("./cloud", () => ({ cloudContext: mock.cloud, downloadCloudFile: mock.download }));
vi.mock("./scene-video", () => ({ openSceneVideo: mock.open }));
vi.mock("./music", () => ({ decodeMpeg4Audio: mock.mpeg }));
const item = (kind: MediaCheckItem["kind"] = "image"): MediaCheckItem => ({ key: `${kind}:original`, kind, asset: { id: "original", kind: kind === "poster" ? "video" : kind, path: "original", mime_type: kind === "audio" ? "audio/wav" : kind === "video" ? "video/mp4" : "image/png" }, locations: [], times: [.2, .6, 1], requiredEnd: 1, previewUrl: "data:image/png;base64,iVBORw0KGgo=", fingerprint: "source" });
beforeEach(() => {
  vi.clearAllMocks(); mock.native.mockReturnValue(false); mock.cloud.mockReturnValue(null); mock.read.mockResolvedValue(new Blob(["original"])); mock.download.mockResolvedValue(new Blob(["poster"]));
  mock.image.mockResolvedValue(undefined); mock.decode.mockResolvedValue({ duration: 2, length: 48000, numberOfChannels: 1 }); mock.mpeg.mockImplementation(mock.decode); mock.close.mockResolvedValue(undefined);
  vi.stubGlobal("Image", class { src = ""; naturalWidth = 10; naturalHeight = 10; decode = mock.image; });
  vi.stubGlobal("AudioContext", class { decodeAudioData = mock.decode; close = mock.close; });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() {} }) }) });
  vi.stubGlobal("URL", class extends URL { static createObjectURL = () => "blob:check"; static revokeObjectURL = mock.revoke; });
  mock.frame.mockResolvedValue({ canvas: {} }); mock.open.mockResolvedValue({ firstTimestamp: 5, duration: 2, input: { dispose: mock.dispose }, sink: { getCanvas: mock.frame } });
});
afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
it("reads the original and the image used for output and releases image URLs on success and failure", async () => {
  const target = item(); target.asset.inline_data = target.previewUrl;
  await inspectExportMedia(editorProject(), target, signal()); expect(mock.read).not.toHaveBeenCalled(); expect(mock.image).toHaveBeenCalledOnce(); expect(mock.revoke).toHaveBeenCalledOnce();
  mock.image.mockRejectedValueOnce(new Error("손상된 이미지")); await expect(inspectExportMedia(editorProject(), target, signal())).rejects.toThrow("손상된 이미지"); expect(mock.revoke).toHaveBeenCalledTimes(2);
});
it("checks actual native files and refreshes cloud poster access through its storage key", async () => {
  const target = item(); target.asset.inline_data = target.previewUrl; mock.native.mockReturnValue(true);
  await inspectExportMedia(editorProject(), target, signal()); expect(mock.read).toHaveBeenCalledWith(expect.anything(), target.asset);
  mock.native.mockReturnValue(false); mock.cloud.mockReturnValue({ userId: "owner" }); const poster = item("poster"); poster.asset.preview_storage_key = "retained-poster"; poster.previewUrl = "https://expired.invalid/preview";
  await inspectExportMedia(editorProject(), poster, signal()); expect(mock.download).toHaveBeenCalledWith(expect.anything(), "retained-poster");
});
it("decodes the actual used video frames and disposes the input for corrupt or short originals", async () => {
  await inspectExportMedia(editorProject(), item("video"), signal()); expect(mock.frame.mock.calls.map(c => c[0])).toEqual([5.2, 5.6, 6]); expect(mock.dispose).toHaveBeenCalledOnce();
  mock.frame.mockResolvedValueOnce(null); await expect(inspectExportMedia(editorProject(), item("video"), signal())).rejects.toThrow("프레임");
  const short = item("video"); short.requiredEnd = 3; await expect(inspectExportMedia(editorProject(), short, signal())).rejects.toThrow("짧습니다"); expect(mock.dispose).toHaveBeenCalledTimes(3);
});
it("uses the export audio decoder, validates source windows and closes contexts on failure", async () => {
  const target = item("audio"); target.asset.mime_type = "audio/mp4"; await inspectExportMedia(editorProject(), target, signal()); expect(mock.mpeg).toHaveBeenCalledOnce();
  target.asset.mime_type = "audio/wav"; target.requiredEnd = 3; await expect(inspectExportMedia(editorProject(), target, signal())).rejects.toThrow("짧습니다");
  mock.decode.mockRejectedValueOnce(new Error("손상된 녹음")); await expect(inspectExportMedia(editorProject(), target, signal())).rejects.toThrow("손상된 녹음"); expect(mock.close).toHaveBeenCalledTimes(3);
});
it("rejects missing files and disposes a video opened after cancellation", async () => {
  mock.read.mockResolvedValueOnce(null); await expect(inspectExportMedia(editorProject(), item("audio"), signal())).rejects.toThrow("원본 파일이 없습니다");
  let finish!: (value: { dispose: () => void }) => void; const controller = new AbortController();
  const late = new Promise<{ dispose: () => void }>(resolve => { finish = resolve; }); const result = abortable(late, controller.signal, value => value.dispose()); controller.abort(); await expect(result).rejects.toMatchObject({ name: "AbortError" }); finish({ dispose: mock.dispose }); await Promise.resolve(); expect(mock.dispose).toHaveBeenCalledOnce();
});
