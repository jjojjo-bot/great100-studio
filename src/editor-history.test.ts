import { describe, expect, it } from "vitest";
import { EditorHistory, type HistoryResult } from "./editor-history";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import type { ProjectData } from "./types";

const fixture = () => createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT);
function applied(result: HistoryResult): ProjectData {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error("Expected an applied edit");
  return result.project;
}

describe("user edit history", () => {
  it("groups one interaction and undoes/redoes caption timing as one edit", () => {
    const history = new EditorHistory(); const before = fixture();
    before.scenes[0].captions = [{ text: "한 줄", start_sec: 0, end_sec: 3 }, { text: "다음 줄", start_sec: 5, end_sec: 8 }];
    let current = before;
    for (const start of [0.1, 0.4, 1]) {
      const next = structuredClone(current); next.scenes[0].captions![0].start_sec = start;
      history.record(current, next); current = next;
    }
    const undone = applied(history.undo(current));
    expect(undone.scenes[0].captions).toEqual(before.scenes[0].captions);
    expect(history.undoLabel).toBeUndefined();
    expect(applied(history.redo(undone)).scenes[0].captions).toEqual(current.scenes[0].captions);
  });

  it("preserves media, narration and current cloud metadata arriving after a text edit", () => {
    const history = new EditorHistory(); const before = fixture();
    const edited = structuredClone(before); edited.scenes[0].caption = "수정한 문장";
    history.record(before, edited);
    const current = structuredClone(edited);
    current.scenes[0].candidates.push({ id: "late-upload", path: "image.png", preview_url: "fresh-signed-url", storage_key: "asset-key", mode: "uploaded", created_at: "now" });
    current.scenes[0].narration_audio = { name: "voice.wav", mime_type: "audio/wav", path: "voice.wav", duration_sec: 2 };
    current.cloud_version = 42; current.updated_at = "newer";
    const undone = applied(history.undo(current));
    expect(undone.scenes[0].caption).toBe(before.scenes[0].caption);
    expect(undone.scenes[0].candidates).toEqual(current.scenes[0].candidates);
    expect(undone.scenes[0].narration_audio).toEqual(current.scenes[0].narration_audio);
    expect(undone.cloud_version).toBe(42); expect(undone.updated_at).toBe("newer");
    expect(applied(history.redo(undone)).scenes[0].caption).toBe("수정한 문장");
  });

  it("keeps interactions separate and clears redo when a new edit branches", () => {
    const history = new EditorHistory(); const before = fixture();
    const a = structuredClone(before); a.scenes[0].caption = "A";
    history.record(before, a); history.breakGroup();
    const b = structuredClone(a); b.scenes[0].caption = "B";
    history.record(a, b);
    const undone = applied(history.undo(b)); expect(undone.scenes[0].caption).toBe("A");
    const branch = structuredClone(undone); branch.scenes[0].motion = "zoom-out";
    history.record(undone, branch);
    expect(history.redoLabel).toBeUndefined();
    expect(applied(history.undo(branch)).scenes[0].motion).toBe(undone.scenes[0].motion);
  });

  it("invalidates selection edits referencing a physically deleted file", () => {
    const history = new EditorHistory(); const before = fixture();
    before.anchor.candidates = ["a", "b"].map(id => ({ id, path: `${id}.png`, preview_url: "", mode: "uploaded" as const, created_at: "now" }));
    before.anchor.selected_candidate_id = "a";
    const next = structuredClone(before); next.anchor.selected_candidate_id = "b";
    history.record(before, next);
    next.anchor.candidates = next.anchor.candidates.filter(item => item.id !== "a");
    history.reconcile(next);
    expect(history.undoLabel).toBeUndefined();
    expect(history.undo(next).status).toBe("empty");
  });

  it("does not overwrite a concurrent change to the very same field", () => {
    const history = new EditorHistory(); const before = fixture();
    const next = structuredClone(before); next.scenes[0].caption = "내가 편집한 문장";
    history.record(before, next);
    next.scenes[0].caption = "나중에 도착한 다른 변경";
    expect(history.undo(next).status).toBe("conflict");
    expect(history.undoLabel).toBeUndefined();
    expect(next.scenes[0].caption).toBe("나중에 도착한 다른 변경");
  });

  it("resets after opening another project and caps retained edit groups", () => {
    const history = new EditorHistory(); let current = fixture();
    for (let index = 1; index <= 55; index++) {
      const next = structuredClone(current); next.scenes[0].caption = String(index);
      history.breakGroup(); history.record(current, next); current = next;
    }
    for (let index = 0; index < 50; index++) current = applied(history.undo(current));
    expect(current.scenes[0].caption).toBe("5");
    expect(history.undo(current).status).toBe("empty");
    history.reset(fixture().id);
    expect(history.redoLabel).toBeUndefined();
  });
});
