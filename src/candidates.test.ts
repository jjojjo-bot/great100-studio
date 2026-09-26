import { describe, expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { withoutAssetCandidate, withoutSceneCandidate } from "./candidates";

describe("후보 삭제 후 선택 상태", () => {
  it("선택한 동영상을 삭제하면 선택을 해제하고 다른 이미지는 보존한다", () => {
    const scene = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT).scenes[0];
    scene.candidates = [
      { id: "image", path: "image.png", preview_url: "image", created_at: "now", mode: "uploaded" },
      { id: "clip", path: "clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded", media_type: "video" },
    ];
    scene.selected_candidate_id = "clip";
    scene.video_intro_candidate_id = "image";
    const withoutVideo = withoutSceneCandidate(scene, "clip");
    expect(withoutVideo.candidates.map((item) => item.id)).toEqual(["image"]);
    expect(withoutVideo.selected_candidate_id).toBeUndefined();
    expect(withoutVideo.video_intro_candidate_id).toBe("image");
    const withoutIntro = withoutSceneCandidate(scene, "image");
    expect(withoutIntro.selected_candidate_id).toBe("clip");
    expect(withoutIntro.video_intro_candidate_id).toBeUndefined();
  });

  it("기준·썸네일 및 보조 이미지의 선택도 삭제 시 해제한다", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.anchor.candidates = [{ id: "anchor", path: "anchor.png", preview_url: "image", created_at: "now", mode: "uploaded" }];
    project.anchor.selected_candidate_id = "anchor";
    expect(withoutAssetCandidate(project.anchor, "anchor")).toMatchObject({ candidates: [], selected_candidate_id: undefined });
    const scene = project.scenes[0];
    scene.support_candidates = [{ id: "support", path: "support.png", preview_url: "image", created_at: "now", mode: "uploaded" }];
    scene.support_selected_candidate_id = "support";
    expect(withoutSceneCandidate(scene, "support", true)).toMatchObject({ support_candidates: [], support_selected_candidate_id: undefined });
  });
});
