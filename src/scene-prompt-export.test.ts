import { expect, it } from "vitest";
import { editorProject } from "../tests/fixtures/editor-project";
import { prepareEditorWrite } from "./editor-format";
import { mergeScene } from "./scene-merge";
import { moveScene } from "./scene-order";
import { composeScenePrompt } from "./prompts";
import { scenePromptBundle, scenePromptRows } from "./scene-prompt-export";
const image = { id: "image", path: "image.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", mode: "uploaded" as const, created_at: "now" };

it.each([1, "2.0", "2.1"] as const)("exports current full prompts in current scene order without altering format %s", version => {
  const p = editorProject(); p.schema_version = version; p.character_profile.description = "새 외형 · 붉은 관복"; p.style_guide = "새 스타일 · 잔잔한 새벽"; p.scenes[0].full_prompt = "오래된 프롬프트";
  const before = structuredClone(p), bundle = scenePromptBundle(p, [p.scenes[2].id, p.scenes[0].id, p.scenes[0].id]);
  expect(p).toEqual(before); expect(bundle.selected.map(row => row.scene.id)).toEqual([p.scenes[0].id, p.scenes[2].id]);
  expect(bundle.text).toContain(composeScenePrompt(p, p.scenes[0])); expect(bundle.text).toContain("새 외형 · 붉은 관복"); expect(bundle.text).toContain("새 스타일 · 잔잔한 새벽"); expect(bundle.text).not.toContain("오래된 프롬프트");
  expect(bundle.filename).toMatch(/_image_prompts\.txt$/); expect(bundle.excluded).toEqual([]);
});
it("retains stable selection through reordering, while filenames and text reflect current numbers", () => {
  const p = editorProject(), ids = [p.scenes[0].id, p.scenes[1].id], moved = moveScene(p, p.scenes[0].id, 1), bundle = scenePromptBundle(moved, ids);
  expect(bundle.selected.map(row => row.scene.id)).toEqual([p.scenes[1].id, p.scenes[0].id]); expect(bundle.selected[1].filename).toMatch(/^scene_02__/);
});
it("excludes deleted and blank prompts without exporting placeholder instructions or replacing them with a reused number", () => {
  const p = editorProject(); p.scenes[1].prompt = " "; const bundle = scenePromptBundle(p, ["deleted", p.scenes[1].id]);
  expect(bundle.text).toBe(""); expect(bundle.excluded).toEqual(["deleted", p.scenes[1].id]); expect(bundle.selected).toEqual([]);
});
it("distinguishes empty screens from video, merged visuals and unreadable compositions", () => {
  let p = editorProject(); p.scenes[0].candidates = [image]; p.scenes[0].selected_candidate_id = image.id;
  p.scenes[1].candidates = [{ ...image, id: "video", path: "clip.mp4", media_type: "video", duration_sec: 2 }]; p.scenes[1].selected_candidate_id = "video";
  expect(scenePromptRows(p).map(row => row.hasVisual)).toEqual([true, true, false]);
  p = mergeScene(prepareEditorWrite(p), p.scenes[0].id); expect(scenePromptRows(p)[0].hasVisual).toBe(true);
  p.scenes[0].composition!.visuals = null as never; expect(scenePromptRows(p)[0].hasVisual).toBeUndefined();
});
it("preserves Korean prompt text and sanitizes the TXT filename", () => {
  const p = editorProject(); p.folder_name = "001_세종/새\n이름"; p.scenes[0].prompt = "한글 ‘훈민정음’\n둘째 줄 🌅";
  const bundle = scenePromptBundle(p, [p.scenes[0].id]); expect(bundle.text).toContain(p.scenes[0].prompt); expect(bundle.filename).toBe("001_세종_새_이름_image_prompts.txt");
});
