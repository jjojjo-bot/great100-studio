import { describe, expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { sceneVisualSections } from "./SceneTimeline";

const image = { id: "image", path: "image.png", preview_url: "image", created_at: "now", mode: "uploaded" as const };
const video = { id: "video", path: "clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded" as const, media_type: "video" as const, duration_sec: 10 };

describe("장면 통합 시간축", () => {
  it("이미지만 선택하면 장면 전체를 이미지로 표시한다", () => {
    const scene = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT).scenes[0];
    Object.assign(scene, { duration: 19, candidates: [image], selected_candidate_id: image.id });
    expect(sceneVisualSections(scene)).toEqual([{ label: "이미지", kind: "image", start: 0, end: 19 }]);
  });

  it("이미지, 원본 동영상 사용 구간, 마지막 화면 유지를 순서대로 보여준다", () => {
    const scene = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT).scenes[0];
    Object.assign(scene, { duration: 19, candidates: [image, video], selected_candidate_id: video.id, video_intro_candidate_id: image.id, video_intro_duration_sec: 2, video_trim_start_sec: 1, video_trim_end_sec: 8 });
    expect(sceneVisualSections(scene)).toEqual([
      { label: "이미지", kind: "image", start: 0, end: 2 },
      { label: "동영상", kind: "video", start: 2, end: 9 },
      { label: "마지막 화면", kind: "hold", start: 9, end: 19 },
    ]);
  });

  it("인트로 이미지가 없고 영상이 장면을 채우면 동영상만 보여준다", () => {
    const scene = createProjectDraft(1, "이순신", "장군", SAMPLE_WORK_TEXT).scenes[0];
    Object.assign(scene, { duration: 8, candidates: [video], selected_candidate_id: video.id });
    expect(sceneVisualSections(scene)).toEqual([{ label: "동영상", kind: "video", start: 0, end: 8 }]);
  });
});
