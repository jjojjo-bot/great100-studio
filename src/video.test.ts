import { describe, expect, it } from "vitest";
import { createProjectDraft } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";
import { activeTimedCaption, buildSceneSegment, buildVideoPlan, captionParts, imagePlacement, musicGainAtTime, resolveImageMotion, resolveVideoIntroImage, sceneMusicVolume, sceneTiming } from "./video";

describe("MP4 제작 계획", () => {
  it("requires a selected image for every scene", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    expect(() => buildVideoPlan(project)).toThrow("Scene 01");
  });

  it("uses scene captions and durations and adds an ending card", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes.forEach((scene) => {
      scene.candidates = [{ id: scene.id, path: "a.png", preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "now", mode: "uploaded" }];
      scene.selected_candidate_id = scene.id;
    });
    project.scenes[0].caption = "수정한 자막";
    project.scenes[0].duration = 7;
    project.scenes[0].motion = "pan-right";
    const plan = buildVideoPlan(project);
    expect(plan[0]).toMatchObject({ opening: true, caption: "", duration: 3, motion: "pan-right" });
    expect(plan[0].imageUrl).toBe(plan[1].imageUrl);
    expect(plan[1]).toMatchObject({ caption: "수정한 자막", duration: 7, motion: "pan-right", motionStart: 0.3 });
    expect(plan[0].motionEnd).toBe(plan[1].motionStart);
    expect(plan[2].motion).toBe("pan-left");
    expect(plan.at(-1)).toMatchObject({ ending: true, duration: 4, motion: "none" });
  });

  it("선택한 장면 MP4를 계획에 연결하고 오프닝에는 첫 화면을 쓴다", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].candidates = [{ id: "clip", path: "candidate_clip.mp4", preview_url: "poster-url", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 5 }];
    project.scenes[0].selected_candidate_id = "clip";
    const plan = buildVideoPlan(project);
    expect(plan[0]).toMatchObject({ opening: true, imageUrl: "poster-url" });
    expect(plan[0].videoCandidateId).toBeUndefined();
    expect(plan[1]).toMatchObject({ sceneId: project.scenes[0].id, imageUrl: "poster-url", videoCandidateId: "clip" });
  });

  it("이미지와 MP4를 함께 올리면 최근 업로드 이미지를 먼저 짧게 보여준다", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    const scene = project.scenes[0];
    scene.duration = 8;
    scene.candidates = [
      { id: "first", path: "first.png", preview_url: "first-url", created_at: "now", mode: "uploaded" },
      { id: "second", path: "second.png", preview_url: "second-url", created_at: "now", mode: "uploaded" },
      { id: "clip", path: "clip.mp4", preview_url: "poster-url", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 5 },
    ];
    scene.selected_candidate_id = "clip";
    expect(resolveVideoIntroImage(scene)?.id).toBe("second");
    expect(buildVideoPlan(project)[1]).toMatchObject({ imageUrl: "second-url", videoCandidateId: "clip", videoIntroDuration: 1.5, duration: 8 });
    scene.video_intro_candidate_id = "first";
    expect(buildVideoPlan(project)[1].imageUrl).toBe("first-url");
    scene.video_intro_candidate_id = null;
    expect(buildVideoPlan(project)[1]).toMatchObject({ imageUrl: "poster-url", videoIntroDuration: undefined });
  });

  it("장면별 전환과 원본 구간 값을 계획에 반영한다", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    const scene = project.scenes[0];
    scene.duration = 8;
    scene.candidates = [
      { id: "intro", path: "intro.png", preview_url: "intro", created_at: "now", mode: "uploaded" },
      { id: "clip", path: "clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 6 },
    ];
    scene.selected_candidate_id = "clip";
    scene.video_intro_duration_sec = 2.5;
    scene.video_trim_start_sec = 1.2;
    scene.video_trim_end_sec = 4.8;
    scene.support_candidates = [{ id: "support", path: "support.png", preview_url: "support", created_at: "now", mode: "uploaded" }];
    scene.support_selected_candidate_id = "support";
    scene.support_start_sec = 5.5;
    expect(buildVideoPlan(project)[1]).toMatchObject({ videoIntroDuration: 2.5, videoTrimStart: 1.2, videoTrimEnd: 4.8, supportStartsAt: 5.5 });
    expect(sceneTiming({ ...scene, video_trim_start_sec: 9 }, 6, true, true).trimStart).toBe(5.9);
  });

  it("선택한 보조 이미지를 장면 후반부에, 썸네일을 마지막 이름 화면에 연결한다", () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.scenes = [project.scenes[0]];
    project.scenes[0].duration = 10;
    project.scenes[0].candidates = [{ id: "main", path: "main.png", preview_url: "main-url", created_at: "now", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "main";
    project.scenes[0].support_candidates = [{ id: "support", path: "support.png", preview_url: "support-url", created_at: "now", mode: "uploaded" }];
    project.scenes[0].support_selected_candidate_id = "support";
    project.thumbnail.candidates = [{ id: "thumb", path: "thumb.png", preview_url: "thumbnail-url", created_at: "now", mode: "uploaded" }];
    project.thumbnail.selected_candidate_id = "thumb";
    const plan = buildVideoPlan(project);
    expect(plan[0]).toMatchObject({ imageUrl: "main-url", opening: true, duration: 3 });
    expect(plan[1]).toMatchObject({ imageUrl: "main-url", supportImageUrl: "support-url", supportStartsAt: 5 });
    expect(plan.at(-1)).toMatchObject({ imageUrl: "thumbnail-url", ending: true, duration: 4 });
  });

  it("긴 내레이션을 빠짐없이 짧은 자막들로 나눈다", () => {
    const original = "이순신은 군사들을 모았습니다. 배와 무기를 점검하고 바닷길을 살폈습니다. 많은 적선이 다가왔지만 동료들과 함께 힘을 모았습니다. 그리고 마지막까지 책임을 다했습니다.";
    const parts = captionParts(original);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(original);
    expect(parts.every((part) => part.length <= 62)).toBe(true);
  });

  it("v2.1 caption block은 지정 시간에만 표시하고 임의로 다시 나누지 않는다", () => {
    const blocks = [{ text: "첫 의미 단위", start_sec: 0, end_sec: 3 }, { text: "두 번째 의미 단위", start_sec: 3, end_sec: 6 }];
    expect(activeTimedCaption(blocks, 1)).toBe("첫 의미 단위");
    expect(activeTimedCaption(blocks, 3)).toBe("두 번째 의미 단위");
    expect(activeTimedCaption(blocks, 6)).toBe("");
  });

  it("씬 미리보기 계획은 다른 씬 선택 없이 자막 시간을 씬 기준으로 변환한다", () => {
    const project = createProjectDraft(2, "세종대왕", "왕", SAMPLE_WORK_TEXT);
    project.schema_version = "2.1";
    const scene = project.scenes[0];
    scene.start_sec = 19;
    scene.end_sec = 38;
    scene.duration = 19;
    scene.narration = "여러분에게 하고 싶은 말이 있어요.";
    scene.captions = [{ text: "여러분에게 하고 싶은 말이 있어요.", start_sec: 19, end_sec: 23.5 }];
    scene.candidates = [{ id: "clip", path: "clip.mp4", preview_url: "poster", created_at: "now", mode: "uploaded", media_type: "video", duration_sec: 10 }];
    scene.selected_candidate_id = "clip";
    const segment = buildSceneSegment(project, scene, 0);
    expect(segment.timedCaptions).toEqual([{ text: "여러분에게 하고 싶은 말이 있어요.", start_sec: 0, end_sec: 4.5 }]);
    expect(activeTimedCaption(segment.timedCaptions!, 3)).toBe("여러분에게 하고 싶은 말이 있어요.");
  });

  it("자동 효과는 장면마다 줌과 이동을 순환한다", () => {
    expect(Array.from({ length: 6 }, (_, index) => resolveImageMotion("auto", index))).toEqual([
      "zoom-in", "pan-left", "zoom-out", "pan-right", "pan-up", "pan-down",
    ]);
  });

  it("장면별 음악 볼륨을 경계에서 부드럽게 바꾸고 끝에서 페이드아웃한다", () => {
    const sections = [{ duration: 2, musicVolume: 20 }, { duration: 2, musicVolume: 80 }, { duration: 4, musicVolume: 80 }];
    expect(sceneMusicVolume(undefined)).toBe(45);
    expect(sceneMusicVolume(120)).toBe(100);
    expect(musicGainAtTime(sections, 0)).toBe(0);
    expect(musicGainAtTime(sections, 1)).toBeCloseTo(0.2);
    expect(musicGainAtTime(sections, 1.9)).toBeCloseTo(0.5);
    expect(musicGainAtTime(sections, 2)).toBeCloseTo(0.8);
    expect(musicGainAtTime(sections, 7.5)).toBeCloseTo(0.8 / 3);
    expect(musicGainAtTime(sections, 8)).toBe(0);
  });

  it("줌과 이동 중에도 이미지가 프레임 전체를 덮는다", () => {
    for (const [imageWidth, imageHeight] of [[1920, 1080], [1000, 1000], [720, 1280]]) {
      for (const motion of ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"] as const) {
        for (const progress of [0, 0.5, 1]) {
          const placement = imagePlacement(imageWidth, imageHeight, 1280, 720, motion, progress);
          expect(placement.x).toBeLessThanOrEqual(0.001);
          expect(placement.y).toBeLessThanOrEqual(0.001);
          expect(placement.x + placement.width).toBeGreaterThanOrEqual(1279.999);
          expect(placement.y + placement.height).toBeGreaterThanOrEqual(719.999);
        }
      }
    }
    expect(imagePlacement(1920, 1080, 1280, 720, "zoom-in", 1).width).toBeGreaterThan(imagePlacement(1920, 1080, 1280, 720, "zoom-in", 0).width);
    expect(imagePlacement(1920, 1080, 1280, 720, "zoom-out", 1).width).toBeLessThan(imagePlacement(1920, 1080, 1280, 720, "zoom-out", 0).width);
    expect(imagePlacement(1920, 1080, 1280, 720, "pan-left", 1).x).toBeLessThan(imagePlacement(1920, 1080, 1280, 720, "pan-left", 0).x);
    const tallStart = imagePlacement(720, 1280, 1280, 720, "pan-up", 0);
    const tallEnd = imagePlacement(720, 1280, 1280, 720, "pan-up", 1);
    expect(tallStart.y - tallEnd.y).toBeCloseTo(720 * 0.16, 5);
  });
});
