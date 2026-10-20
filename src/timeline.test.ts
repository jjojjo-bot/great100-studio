import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { buildSceneSegment, buildVideoPlan } from "./video";
import { frameTimeline, playbackPosition, projectTimeline, proposeNarrationTiming, sourceCaptionTiming, timingFingerprint, VIDEO_FPS } from "./timeline";
import { EditorHistory } from "./editor-history";

it("extends a scene and shifts following scene/caption times by integer milliseconds while retaining gaps and source", () => {
  const project = editorProject();
  project.scenes.slice(1).forEach(scene => { scene.start_sec! += 2; scene.end_sec! += 2; scene.captions!.forEach(block => { block.start_sec += 2; block.end_sec += 2; }); });
  const original = structuredClone(project);
  const proposal = proposeNarrationTiming(project, project.scenes[0].id, 14.01, "keep");
  expect(proposal.duration).toBe(14.1);
  expect(proposal.project.editor_version).toBe(2);
  expect(proposal.project.scenes[1]).toMatchObject({ id: project.scenes[1].id, start_sec: 16.1, end_sec: 26.1, duration: 10 });
  expect(proposal.project.scenes[1].captions![0]).toMatchObject({ id: project.scenes[1].captions![0].id, start_sec: 16.1, end_sec: 26.1 });
  expect(proposal.project.scenes[0].captions).toEqual(project.scenes[0].captions);
  expect(proposal.project.source).toEqual(project.source);
  expect(project).toEqual(original);
});

it("scales caption positions and gaps without changing their IDs or text, and rejects a shortening that would clip captions", () => {
  const project = editorProject(); const scene = project.scenes[0];
  scene.captions = [{ id: "a", text: "첫 문장", start_sec: 1, end_sec: 4 }, { id: "b", text: "끝 문장", start_sec: 6, end_sec: 10 }];
  expect(() => proposeNarrationTiming(project, scene.id, 5, "keep")).toThrow("자막");
  const proposal = proposeNarrationTiming(project, scene.id, 5, "scale");
  expect(proposal.project.scenes[0].captions).toEqual([{ id: "a", text: "첫 문장", start_sec: 0.5, end_sec: 2 }, { id: "b", text: "끝 문장", start_sec: 3, end_sec: 5 }]);
  expect(proposal.project.scenes[1].start_sec).toBe(5);
});

it("reserves enough output frames for the audio even when the previous boundary rounded up", () => {
  const project = editorProject(); project.scenes[0].duration = 1.1; project.scenes[0].end_sec = 1.1;
  project.scenes[0].captions = [{ id: "first", text: "첫 장면", start_sec: 0, end_sec: 1.1 }];
  const result = proposeNarrationTiming(project, project.scenes[1].id, 14.09, "keep");
  expect(result.duration).toBe(14.2);
  expect(projectTimeline(result.project).scenes[1].duration).toBeGreaterThanOrEqual(14.09);
});

it("rounds cumulative boundaries rather than adding a rounding error for every scene", () => {
  const ranges = frameTimeline(Array(300).fill(1.1));
  expect(ranges.at(-1)!.endFrame).toBe(4950);
  ranges.forEach((range, i) => expect(Math.abs(range.end - (i + 1) * 1.1)).toBeLessThanOrEqual(0.5 / VIDEO_FPS + 0.000001));
  const repeated = frameTimeline(ranges.map(range => range.duration), true);
  expect(repeated.map(range => range.endFrame)).toEqual(ranges.map(range => range.endFrame));
  expect(playbackPosition(ranges.map(range => range.duration), ranges[14].end)!.index).toBe(15);
});

it("uses the same frame-aligned durations and caption boundaries for single-scene preview and full video", () => {
  const project = editorProject();
  project.scenes.forEach((scene, index) => {
    scene.duration = 1.1; scene.start_sec = index * 1.1; scene.end_sec = (index + 1) * 1.1;
    scene.captions = [{ id: `caption-${index}`, text: scene.narration!, start_sec: scene.start_sec, end_sec: scene.end_sec }];
    scene.candidates = [{ id: scene.id, path: "image.png", preview_url: "data:image/png;base64,a", mode: "uploaded", created_at: "now" }]; scene.selected_candidate_id = scene.id;
  });
  const plan = buildVideoPlan(project);
  expect(plan[0].duration).toBe(3); expect(plan.at(-1)!.duration).toBe(4);
  expect(plan.reduce((sum, segment) => sum + segment.duration, 0)).toBeCloseTo(31 / 3, 8);
  project.scenes.forEach((scene, index) => {
    const single = buildSceneSegment(project, scene, index);
    expect(single).toMatchObject({ duration: plan[index + 1].duration, timedCaptions: plan[index + 1].timedCaptions });
    expect(single.timedCaptions![0].end_sec).toBe(single.duration);
  });
});

it("undoes all affected scene times as one edit and keeps new media and the editor version", () => {
  const project = editorProject();
  const proposal = proposeNarrationTiming(project, project.scenes[0].id, 14, "scale");
  const next = proposal.project;
  next.scenes[0].narration_audio = { id: "new-file", name: "voice.wav", path: "voice-new.wav", mime_type: "audio/wav", duration_sec: 14 };
  const history = new EditorHistory(); history.record(project, next, "녹음 길이에 맞추기");
  const undo = history.undo(next);
  if (undo.status !== "applied") throw new Error("undo failed");
  expect(undo.project.scenes.map(scene => [scene.duration, scene.start_sec, scene.end_sec, scene.captions])).toEqual(project.scenes.map(scene => [scene.duration, scene.start_sec, scene.end_sec, scene.captions]));
  expect(undo.project.scenes[0].narration_audio).toEqual(next.scenes[0].narration_audio);
  expect(undo.project.editor_version).toBe(2); expect(history.undoLabel).toBeUndefined();
  const redo = history.redo(undo.project);
  if (redo.status !== "applied") throw new Error("redo failed");
  expect(redo.project.scenes).toEqual(next.scenes);
});

it("restores original caption times relative to a shifted scene and disallows a reset past the new scene end", () => {
  const project = editorProject();
  const next = proposeNarrationTiming(project, project.scenes[0].id, 14, "keep").project;
  expect(sourceCaptionTiming(next, next.scenes[1])![0]).toMatchObject({ start_sec: 14, end_sec: 24 });
  const shortened = proposeNarrationTiming(project, project.scenes[1].id, 5, "scale").project;
  expect(sourceCaptionTiming(shortened, shortened.scenes[1])).toBeUndefined();
});

it.each([NaN, 0, -1, 120.1, Infinity])("rejects invalid or oversized narration lengths (%s)", duration => {
  const project = editorProject(); expect(() => proposeNarrationTiming(project, project.scenes[0].id, duration, "keep")).toThrow("녹음 길이");
});

it("rejects a total duration over fifteen minutes and caption blocks shorter than 100 ms", () => {
  const project = editorProject();
  project.scenes = Array.from({ length: 8 }, (_, index) => ({ ...project.scenes[0], id: `scene-${index}`, number: index + 1, duration: 120, start_sec: index * 120, end_sec: (index + 1) * 120, captions: [] }));
  expect(() => proposeNarrationTiming(project, project.scenes[0].id, 120, "keep")).toThrow("15분");
  const small = editorProject(); small.scenes[0].captions![0].end_sec = 0.1;
  expect(() => proposeNarrationTiming(small, small.scenes[0].id, 1, "scale")).toThrow("0.1초");
});

it("keeps legacy v1 and v2.0 media references while changing durations", () => {
  const legacy = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  const result = proposeNarrationTiming(legacy, legacy.scenes[0].id, 14, "keep");
  expect(result.project.schema_version).toBe(1); expect(result.project.scenes[1].start_sec).toBe(14);
  const v2 = editorProject("2.0");
  expect(proposeNarrationTiming(v2, v2.scenes[0].id, 14, "keep").project.schema_version).toBe("2.0");
});

it("detects stale timing and narration while allowing a late image or text-only edit", () => {
  const original = editorProject(); const copy = structuredClone(original);
  copy.scenes[0].captions![0].text = "새 문구";
  copy.scenes[0].candidates = [{ id: "late", path: "image.png", preview_url: "data:image/png;base64,a", mode: "uploaded", created_at: "now" }];
  expect(timingFingerprint(copy)).toBe(timingFingerprint(original));
  copy.scenes[1].start_sec! += 1;
  expect(timingFingerprint(copy)).not.toBe(timingFingerprint(original));
});
