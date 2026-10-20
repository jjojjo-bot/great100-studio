import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REFERENCE_BYTES, prepareReferenceImage } from "./reference-image";

const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
const jpeg = new Blob([new Uint8Array([255, 216, 255, 0])], { type: "image/jpeg" });
const close = vi.fn();
const drawImage = vi.fn();
const encode = vi.fn();
const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage }), toBlob: encode };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 512, height: 512, close })));
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  encode.mockImplementation((callback: BlobCallback) => callback(jpeg));
});
afterEach(() => vi.unstubAllGlobals());

describe("reference image request preparation", () => {
  it("keeps a small original's bytes and determines its MIME from its contents", async () => {
    expect(await prepareReferenceImage(new Blob([png], { type: "application/octet-stream" }))).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(encode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("scales a large uploaded original into a request-sized copy without altering it", async () => {
    const bytes = new Uint8Array(3_200_000); bytes.set([255, 216, 255]);
    const original = new Blob([bytes], { type: "image/jpeg" });
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 4000, height: 2000, close } as unknown as ImageBitmap);
    expect(await prepareReferenceImage(original)).toBe("data:image/jpeg;base64,/9j/AA==");
    expect(canvas.width).toBe(1536); expect(canvas.height).toBe(768);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1536, 768);
    expect(original.size).toBe(3_200_000);
    expect(close).toHaveBeenCalledOnce();
  });

  it("retries a smaller encoding and rejects output that still exceeds the request limit", async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 4000, height: 2000, close } as unknown as ImageBitmap);
    const oversized = new Blob([new Uint8Array(MAX_REFERENCE_BYTES + 1)]);
    encode.mockImplementationOnce((callback: BlobCallback) => callback(oversized));
    await expect(prepareReferenceImage(png)).resolves.toContain("data:image/jpeg;base64,");
    expect(encode).toHaveBeenCalledTimes(2);
    encode.mockImplementation((callback: BlobCallback) => callback(oversized));
    await expect(prepareReferenceImage(png)).rejects.toThrow("너무 큽니다");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported and corrupt images before a generation request can be made", async () => {
    await expect(prepareReferenceImage(new Blob(["<svg/>"]))).rejects.toThrow("PNG, JPEG, WebP");
    expect(createImageBitmap).not.toHaveBeenCalled();
    vi.mocked(createImageBitmap).mockRejectedValue(new Error("invalid image"));
    await expect(prepareReferenceImage(png)).rejects.toThrow("다시 업로드");
  });
});
