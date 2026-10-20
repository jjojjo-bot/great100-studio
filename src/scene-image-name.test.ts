import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { moveScene } from "./scene-order";
import { sceneImageFilename } from "./scene-image-name";
import { suggestedSceneId } from "./scene-image-batch";

it("keeps a recommended filename connected to the same scene after its number changes", () => {
  const p = editorProject(), scene = p.scenes[0], name = sceneImageFilename(p.id, scene), moved = moveScene(p, scene.id, 1);
  expect(name).toMatch(/^scene_01__g100\[[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\]\.png$/);
  expect(suggestedSceneId(name, moved.scenes, p.id)).toBe(scene.id); expect(moved.scenes[1].id).toBe(scene.id);
});
it.each(["png", "jpg", "webp"])("supports a real %s extension and duplicate-download suffix without using its old number", extension => {
  const p = editorProject(), name = sceneImageFilename(p.id, p.scenes[1]).replace(/\.png$/, ` (1).${extension}`);
  expect(suggestedSceneId(name, p.scenes, p.id)).toBe(p.scenes[1].id);
});
it("round-trips Unicode and split-scene IDs using portable ASCII filenames", () => {
  const p = editorProject(); p.id = "프로젝트:조선/1"; p.scenes[0].id = "장면_나눔:abc-123";
  const name = sceneImageFilename(p.id, p.scenes[0]); expect(name).toMatch(/^[\x20-\x7e]+$/); expect(name).not.toMatch(/[\\/:*?"<>|]/);
  expect(suggestedSceneId(name, p.scenes, p.id)).toBe(p.scenes[0].id);
});
it("never falls back to a number for another project, removed scene, missing context or duplicate IDs", () => {
  const p = editorProject(), name = sceneImageFilename(p.id, p.scenes[0]);
  expect(suggestedSceneId(name, p.scenes, "another-project")).toBe(""); expect(suggestedSceneId(name, p.scenes)).toBe("");
  expect(suggestedSceneId(name, [{ ...p.scenes[1], number: 1 }], p.id)).toBe("");
  expect(suggestedSceneId(name, [p.scenes[0], p.scenes[0]], p.id)).toBe("");
});
it("leaves malformed and ambiguous Great100 names unassigned instead of using their scene prefix", () => {
  const p = editorProject(), name = sceneImageFilename(p.id, p.scenes[0]);
  for (const bad of ["scene_01__g100[broken].png", "scene_01__g100[_.YWJj].png", name.replace("]", ""), name + name, "scene_01__g100.png"]) expect(suggestedSceneId(bad, p.scenes, p.id)).toBe("");
});
it("retains existing explicit scene-number suggestions for ordinary filenames", () => {
  const p = editorProject(); expect(suggestedSceneId("scene_02.png", p.scenes, p.id)).toBe(p.scenes[1].id); expect(suggestedSceneId("장면3.jpg", p.scenes, p.id)).toBe(p.scenes[2].id);
  expect(suggestedSceneId("scene_01_scene_02.webp", p.scenes, p.id)).toBe("");
});
