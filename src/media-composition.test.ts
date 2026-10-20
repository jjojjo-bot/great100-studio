import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { assertEditorWrite, prepareEditorWrite } from "./editor-format";
import { candidateAssetId, collectMediaAssets, mediaCompositionErrors, prepareMediaProject } from "./media-composition";
import { buildSceneSegments, buildVideoPlan } from "./video";
import { EditorHistory } from "./editor-history";

function projectWithMedia() {
  const project = editorProject(); project.project_path = `projects/${project.folder_name}`;
  for (const [index, scene] of project.scenes.entries()) {
    scene.candidates = [{ id: `image-${index}`, path: `${project.project_path}/03_images/scene0${index + 1}/candidate.png`,
      preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded", created_at: "now" }];
    scene.selected_candidate_id = `image-${index}`;
  }
  const scene = project.scenes[0];
  scene.candidates.push({ id: "clip", path: `${project.project_path}/03_images/scene01/clip.mp4`, preview_url: "data:image/png;base64,iVBORw0KGgo=",
    mode: "uploaded", media_type: "video", duration_sec: 3, created_at: "now" });
  scene.selected_candidate_id = "clip"; scene.video_trim_start_sec = 0.4; scene.video_trim_end_sec = 1.4;
  scene.video_intro_duration_sec = 1;
  scene.support_candidates = [{ ...scene.candidates[0], id: "support", path: `${project.project_path}/03_images/scene01/support.png` }];
  scene.support_selected_candidate_id = "support"; scene.support_start_sec = 6;
  scene.narration_audio = { name: "voice.wav", path: `${project.project_path}/03_images/scene01/narration.wav`, mime_type: "audio/wav", duration_sec: 3 };
  return project;
}

it.each(["2.0", "2.1"] as const)("adapts %s without changing legacy time, paths, source or playback", version => {
  const project = { ...projectWithMedia(), schema_version: version, source: editorProject(version).source };
  if (version === "2.0") for (const scene of project.scenes) delete scene.captions;
  const original = structuredClone(project);
  const before = buildVideoPlan(project);
  const saved = prepareEditorWrite(project);
  expect(saved.editor_version).toBe(3);
  expect(project).toEqual(original); expect(saved.source).toEqual(original.source);
  expect(saved.scenes.map(scene => [scene.id, scene.start_sec, scene.end_sec])).toEqual(project.scenes.map(scene => [scene.id, scene.start_sec, scene.end_sec]));
  expect(buildVideoPlan(saved)).toEqual(before);
  expect(mediaCompositionErrors(saved)).toEqual([]);
  expect(prepareEditorWrite(saved)).toEqual(saved);
  expect(saved.scenes[0].composition).toMatchObject({ visuals: [{ source_start_sec: 0.4, source_end_sec: 1.4, intro_duration_sec: 1, support_start_sec: 6 }], narrations: [{ source_start_sec: 0, source_end_sec: 3 }] });
});

it("keeps original paths, local storage keys and clip identities when a display number changes", () => {
  const project = prepareEditorWrite(projectWithMedia());
  const changed = structuredClone(project); changed.scenes[0].number = 9;
  const next = prepareEditorWrite(changed);
  expect(next.media).toEqual(project.media);
  expect(next.scenes[0].composition).toEqual(project.scenes[0].composition);
  expect(collectMediaAssets(next).find(asset => asset.kind === "video")?.local_key).toBe(`${project.id}:scene-video:clip`);
});

it("retains an unlinked original and preserves it across undo, redo and serialization", () => {
  const before = prepareEditorWrite(projectWithMedia());
  const changed = structuredClone(before); changed.scenes[0].selected_candidate_id = "image-0";
  const next = prepareMediaProject(changed, before);
  const history = new EditorHistory(); history.record(before, next);
  const undo = history.undo(next); if (undo.status !== "applied") throw new Error("undo failed");
  const undone = prepareEditorWrite(undo.project);
  expect(buildSceneSegments(undone, undone.scenes[0], 0)[0].videoAssetId).toBe("candidate:clip");
  const redo = history.redo(undone); if (redo.status !== "applied") throw new Error("redo failed");
  const deleted = structuredClone(redo.project); deleted.scenes[0].candidates = deleted.scenes[0].candidates.filter(candidate => candidate.id !== "clip");
  const reopened = prepareEditorWrite(JSON.parse(JSON.stringify(prepareMediaProject(deleted, redo.project))));
  expect(reopened.media?.assets.find(asset => asset.id === "candidate:clip")?.path).toContain("scene01/clip.mp4");
  expect(reopened.source).toEqual(before.source);
});

it("keeps several original visual and voice intervals even after their candidate rows are removed", () => {
  const project = prepareEditorWrite(projectWithMedia()); const scene = project.scenes[0];
  const composition = scene.composition!;
  composition.visuals = [
    { ...composition.visuals[0], id: "first", end_sec: 4, support_asset_id: undefined, support_start_sec: undefined },
    { id: "second", start_sec: 4, end_sec: 10, asset_id: candidateAssetId(project.scenes[1].candidates[0]), source_start_sec: 0, motion: "none" },
  ];
  const voice = composition.narrations[0];
  composition.narrations = [
    { ...voice, id: "voice-a", start_sec: 1, end_sec: 2, source_start_sec: 0.5, source_end_sec: 1.5 },
    { ...voice, id: "voice-b", start_sec: 5, end_sec: 6, source_start_sec: 2, source_end_sec: 3 },
  ];
  expect(mediaCompositionErrors(project)).toEqual([]);
  const segments = buildSceneSegments(project, scene, 0);
  expect(segments.map(segment => segment.duration)).toEqual([4, 6]);
  expect(segments[0].narrationClips).toMatchObject([{ start_sec: 1, end_sec: 2, source_start_sec: 0.5 }]);
  expect(segments[1].narrationClips).toMatchObject([{ start_sec: 1, end_sec: 2, source_start_sec: 2 }]);
  expect(segments[1].timedCaptions).toMatchObject([{ start_sec: 0, end_sec: 6 }]);
  project.scenes[1].candidates = [];
  // The source no longer has a candidate row in any scene, but its original is retained.
  expect(buildSceneSegments(project, scene, 0)[1].imageUrl).toContain("data:image/png");
});

it("rejects missing originals, overlapping voices, invalid source trims and malformed visual ranges", () => {
  const project = prepareEditorWrite(projectWithMedia()); const composition = project.scenes[0].composition!;
  composition.visuals[0].source_end_sec = 7;
  composition.narrations.push({ ...composition.narrations[0], id: "overlap" });
  expect(mediaCompositionErrors(project).join("\n")).toContain("동영상 원본 구간");
  expect(mediaCompositionErrors(project).join("\n")).toContain("녹음 구간");
  composition.visuals[0].asset_id = "missing"; composition.visuals[0].start_sec = 1;
  expect(mediaCompositionErrors(project).join("\n")).toContain("화면 구간 또는 원본 연결");
  const tampered = structuredClone(project); tampered.media!.assets = [];
  expect(() => assertEditorWrite(tampered, project)).toThrow("원본 자료");
});

it("preserves unknown media fields and blocks replacing an immutable locator", () => {
  const project = prepareEditorWrite(projectWithMedia());
  const extra = { ...project.media!.assets[0], extra: { retained: true } }; project.media!.assets[0] = extra;
  expect(prepareEditorWrite(project).media?.assets[0]).toMatchObject({ extra: { retained: true } });
  const replaced = structuredClone(project); replaced.media!.assets[0].local_key = "another-project";
  expect(() => assertEditorWrite(replaced, project)).toThrow("원본 자료");
});
