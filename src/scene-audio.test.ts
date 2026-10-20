import { afterEach, expect, it, vi } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { bindComposition } from "./media-composition";
import { sceneNarrationWav } from "./scene-audio";

afterEach(() => vi.unstubAllGlobals());
it("writes a cropped WAV with its leading silence and source sample positions", async () => {
  const project = editorProject(); const scene = project.scenes[0]; scene.duration = 2; scene.end_sec = 2;
  scene.composition = bindComposition(scene, { source_signature: "", visuals: [], narrations: [{ id: "voice", asset_id: "original", start_sec: 0.5, end_sec: 1.5, source_start_sec: 1, source_end_sec: 2 }] });
  const samples = new Float32Array(48000 * 3); samples.fill(0.2, 0, 48000); samples.fill(0.7, 48000, 96000); samples.fill(-0.4, 96000);
  const close = vi.fn();
  vi.stubGlobal("AudioContext", class { decodeAudioData = async () => ({ duration: 3, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples }); close = close; });
  const read = vi.fn(async () => new Blob(["original"], { type: "audio/wav" }));
  const wav = await sceneNarrationWav(project, scene, read); const view = new DataView(await wav!.arrayBuffer());
  expect(wav?.type).toBe("audio/wav"); expect(wav?.size).toBe(44 + 2 * 48000 * 2); expect(read).toHaveBeenCalledWith("original");
  const sample = (time: number) => view.getInt16(44 + Math.round(time * 48000) * 2, true) / 32767;
  expect(sample(0.25)).toBe(0); expect(sample(0.6)).toBeCloseTo(0.7, 4); expect(sample(1.4)).toBeCloseTo(0.7, 4); expect(sample(1.6)).toBe(0);
  expect(samples[48000]).toBeCloseTo(0.7); expect(close).toHaveBeenCalledOnce();
});

it("returns no alias for an empty voice and closes decoding resources when an original is missing", async () => {
  const project = editorProject(); const scene = project.scenes[0];
  expect(await sceneNarrationWav(project, scene, vi.fn())).toBeNull();
  scene.composition = bindComposition(scene, { source_signature: "", visuals: [], narrations: [{ id: "voice", asset_id: "missing", start_sec: 0, end_sec: 1, source_start_sec: 0, source_end_sec: 1 }] });
  const close = vi.fn(); vi.stubGlobal("AudioContext", class { close = close; });
  await expect(sceneNarrationWav(project, scene, async () => null)).rejects.toThrow("원본"); expect(close).toHaveBeenCalledOnce();
});

it("preserves opposite stereo channels instead of cancelling them in the cropped alias", async () => {
  const project = editorProject(); const scene = project.scenes[0]; scene.duration = 1; scene.end_sec = 1;
  scene.composition = bindComposition(scene, { source_signature: "", visuals: [], narrations: [{ id: "voice", asset_id: "stereo", start_sec: 0, end_sec: 1, source_start_sec: 0, source_end_sec: 1 }] });
  vi.stubGlobal("AudioContext", class {
    decodeAudioData = async () => ({ duration: 1, sampleRate: 48000, numberOfChannels: 2, getChannelData: (channel: number) => new Float32Array(48000).fill(channel ? -0.6 : 0.6) });
    close = async () => {};
  });
  const wav = await sceneNarrationWav(project, scene, async () => new Blob(["voice"], { type: "audio/wav" }));
  const view = new DataView(await wav!.arrayBuffer()); expect(view.getUint16(22, true)).toBe(2);
  expect(view.getInt16(44, true) / 32767).toBeCloseTo(0.6, 4); expect(view.getInt16(46, true) / 32767).toBeCloseTo(-0.6, 4);
});
