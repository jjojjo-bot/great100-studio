import { expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { mergeProjectChanges } from "./project-changes";

it("preserves edits made while image generation was pending", () => {
  const base = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  const current = structuredClone(base);
  current.scenes[0].caption = "생성을 기다리며 수정한 자막";
  current.scenes[1].duration = 25;
  const generated = structuredClone(base);
  generated.scenes[0].candidates.push({ id: "generated", path: "image.png", preview_url: "data:image/png;base64,AA==", mode: "openai", created_at: "now" });
  const result = mergeProjectChanges(base, generated, current);
  expect(result.scenes[0].caption).toBe(current.scenes[0].caption);
  expect(result.scenes[1].duration).toBe(25);
  expect(result.scenes[0].candidates[0].id).toBe("generated");
});

it("combines two completed uploads without restoring a deleted candidate", () => {
  const base = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  const candidate = (id: string) => ({ id, path: `${id}.png`, preview_url: "", mode: "uploaded" as const, created_at: "now" });
  base.anchor.candidates = [candidate("old")];
  const current = structuredClone(base);
  current.anchor.candidates = [candidate("upload-a")];
  const next = structuredClone(base);
  next.anchor.candidates.push(candidate("upload-b"));
  const result = mergeProjectChanges(base, next, current);
  expect(result.anchor.candidates.map(value => value.id)).toEqual(["upload-a", "upload-b"]);
});

it("applies a deletion while retaining another callback's added candidate", () => {
  const base = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
  const candidate = (id: string) => ({ id, path: `${id}.png`, preview_url: "", mode: "uploaded" as const, created_at: "now" });
  base.anchor.candidates = [candidate("remove"), candidate("keep")];
  const next = structuredClone(base); next.anchor.candidates.shift();
  const current = structuredClone(base); current.anchor.candidates.push(candidate("new"));
  expect(mergeProjectChanges(base, next, current).anchor.candidates.map(value => value.id)).toEqual(["keep", "new"]);
});
