import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import JSZip from "jszip";
import { openDB } from "idb";
import { createProjectDraft } from "./parser";
import { buildProjectZip, createProjectOnDisk, deleteProject, detectImageFormat, detectMusicFormat, detectNarrationFormat, getBackgroundMusic, getRenderedVideo, getSceneNarration, importImageCandidates, listProjects, removeBackgroundMusic, removeSceneNarration, saveBackgroundMusic, saveProject, saveRenderedVideo, saveSceneNarration } from "./platform";
import { SAMPLE_WORK_TEXT } from "./sample";

describe("project export", () => {
  it("includes the source, selected image, project data and prompt history", async () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    project.anchor.candidates = [{ id: "one", path: `${project.project_path}/02_character/candidate_one.svg`, preview_url: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", created_at: "2026-09-24T00:00:00Z", mode: "mock" }];
    project.anchor.selected_candidate_id = "one";
    const blob = await buildProjectZip(project);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const folder = `${project.folder_name}/`;
    expect(zip.file(`${folder}01_source/work_result.txt`)).not.toBeNull();
    expect(zip.file(`${folder}02_character/candidate_one.svg`)).not.toBeNull();
    expect(zip.file(`${folder}02_character/selected.svg`)).not.toBeNull();
    expect(zip.file(`${folder}06_logs/prompt_history.jsonl`)).not.toBeNull();
    const fullPrompt = await zip.file(`${folder}03_images/scene01/image_prompt.txt`)!.async("string");
    expect(fullPrompt).toContain(project.character_profile.description);
    expect(fullPrompt).toContain(project.style_guide);
    const thumbnailPrompt = await zip.file(`${folder}04_thumbnail/image_prompt.txt`)!.async("string");
    expect(thumbnailPrompt).toContain(project.thumbnail.prompt);
    expect(thumbnailPrompt).toContain(project.character_profile.description);
    const metadata = JSON.parse(await zip.file(`${folder}project_data.json`)!.async("string"));
    expect(metadata.anchor.candidates[0].preview_url).toBe("");
    expect(metadata.scenes[0].full_prompt).toBe(fullPrompt);
    expect(metadata.thumbnail.full_prompt).toBe(thumbnailPrompt);
  });

  it("includes an uploaded selection in the standard folder", async () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    project.scenes[0].candidates = [{ id: "uploaded", path: `${project.project_path}/03_images/scene01/candidate_uploaded.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "2026-09-24T00:00:00Z", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "uploaded";
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    const folder = `${project.folder_name}/03_images/scene01/`;
    expect(zip.file(`${folder}candidate_uploaded.png`)).not.toBeNull();
    expect(zip.file(`${folder}selected.png`)).not.toBeNull();
  });

  it("선택한 장면 MP4 원본을 후보와 selected 파일로 내보낸다", async () => {
    vi.stubGlobal("window", {});
    const project = createProjectDraft(3, "동영상 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    const candidate = { id: "clip", path: `${project.project_path}/03_images/scene01/candidate_clip.mp4`, preview_url: "data:image/jpeg;base64,a", created_at: "now", mode: "uploaded" as const, media_type: "video" as const, duration_sec: 2 };
    project.scenes[0].candidates = [candidate];
    project.scenes[0].selected_candidate_id = candidate.id;
    const bytes = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 1, 2, 3, 4]);
    await listProjects();
    const db = await openDB("great100-studio", 4);
    await db.put("media", { id: `${project.id}:scene-video:clip`, blob: new Blob([bytes], { type: "video/mp4" }) });
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    const folder = `${project.folder_name}/03_images/scene01/`;
    expect(new Uint8Array(await zip.file(`${folder}candidate_clip.mp4`)!.async("uint8array"))).toEqual(bytes);
    expect(new Uint8Array(await zip.file(`${folder}selected.mp4`)!.async("uint8array"))).toEqual(bytes);
  });

  it("includes the finished MP4 inside 05_exports", async () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    const video = new Blob([new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112])], { type: "video/mp4" });
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project, video)).arrayBuffer());
    expect(zip.file(`${project.folder_name}/05_exports/${project.folder_name}.mp4`)).not.toBeNull();
  });
});

describe("uploaded image validation", () => {
  it("accepts PNG, JPEG and WebP signatures", () => {
    expect(detectImageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))?.extension).toBe("png");
    expect(detectImageFormat(new Uint8Array([255, 216, 255]))?.extension).toBe("jpg");
    expect(detectImageFormat(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))?.extension).toBe("webp");
    expect(detectImageFormat(new Uint8Array([60, 115, 118, 103]))).toBeNull();
  });

  it("imports a local image as a selectable candidate", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File) {
        file.arrayBuffer().then((buffer) => {
          this.result = `data:${file.type};base64,${Buffer.from(buffer).toString("base64")}`;
          this.onload?.();
        }).catch(() => this.onerror?.());
      }
    });
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "anchor.png", { type: "image/png" });
    const [candidate] = await importImageCandidates([file], { project_path: "projects/002_이순신", asset_kind: "anchor" });
    expect(candidate.mode).toBe("uploaded");
    expect(candidate.path).toMatch(/^projects\/002_이순신\/02_character\/candidate_.+\.png$/);
    expect(candidate.preview_url).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});

describe("background music storage", () => {
  it("accepts common audio formats and rejects oversized files", () => {
    expect(detectMusicFormat({ name: "music.mp3", type: "audio/mpeg", size: 100 }).extension).toBe("mp3");
    expect(detectMusicFormat({ name: "music.wav", type: "audio/x-wav", size: 100 }).extension).toBe("wav");
    expect(detectMusicFormat({ name: "music.m4a", type: "audio/mp4", size: 100 }).extension).toBe("m4a");
    expect(detectMusicFormat({ name: "music.mp4", type: "video/mp4", size: 100_000_000 }).extension).toBe("mp4");
    expect(() => detectMusicFormat({ name: "music.mp3", type: "audio/mpeg", size: 100_000_001 })).toThrow("100MB");
  });

  it("stores the uploaded file separately, includes it in ZIP, and removes it cleanly", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = async () => ({ length: 1, duration: 1 });
      close = async () => {};
    });
    const project = createProjectDraft(24, "음악 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = await createProjectOnDisk(project);
    const file = new File([new Uint8Array([73, 68, 51, 1])], "theme.mp3", { type: "audio/mpeg" });
    project.background_music = await saveBackgroundMusic(project, file);
    await saveProject(project);
    expect((await getBackgroundMusic(project))?.size).toBe(file.size);
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    expect(zip.file(`${project.folder_name}/01_source/background_music.mp3`)).not.toBeNull();
    await removeBackgroundMusic(project);
    expect(await getBackgroundMusic(project)).toBeNull();
  });
});

describe("scene narration storage", () => {
  it("uploads and exports one scene recording, then removes it", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = async () => ({ duration: 1.25 });
      close = async () => {};
    });
    const project = createProjectDraft(33, "내레이션 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = await createProjectOnDisk(project);
    const scene = project.scenes[0];
    const file = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])], "voice.wav", { type: "audio/wav" });
    expect(detectNarrationFormat(file)).toMatchObject({ extension: "wav", mime: "audio/wav" });
    scene.narration_audio = await saveSceneNarration(project, scene, file);
    expect(scene.narration_audio.duration_sec).toBe(1.25);
    expect((await getSceneNarration(project, scene))?.size).toBe(file.size);
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    expect(zip.file(`${project.folder_name}/03_images/scene01/narration.wav`)).not.toBeNull();
    await removeSceneNarration(project, scene);
    expect(await getSceneNarration(project, scene)).toBeNull();
  });

  it("rejects a recording longer than its scene without replacing the saved file", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = async () => ({ duration: 12 });
      close = async () => {};
    });
    const project = createProjectDraft(34, "길이 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = await createProjectOnDisk(project);
    const scene = project.scenes[0];
    scene.duration = 10;
    const file = new File([new Uint8Array([82, 73, 70, 70])], "long.wav", { type: "audio/wav" });
    await expect(saveSceneNarration(project, scene, file)).rejects.toThrow("장면 길이");
    expect(await getSceneNarration(project, scene)).toBeNull();
  });
});

describe("project deletion", () => {
  it("removes only the matching browser project and its rendered MP4", async () => {
    vi.stubGlobal("window", {});
    const removed = createProjectDraft(21, "삭제 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    removed.project_path = await createProjectOnDisk(removed);
    await saveProject(removed);
    await saveRenderedVideo(removed, new Blob(["test"], { type: "video/mp4" }));
    const db = await openDB("great100-studio", 4);
    const recordingKey = `${removed.id}:narration:${removed.scenes[0].id}`;
    await db.put("audio", { id: recordingKey, blob: new Blob(["voice"]) });
    const kept = createProjectDraft(22, "보존 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    kept.project_path = await createProjectOnDisk(kept);
    await saveProject(kept);
    await expect(deleteProject({ ...removed, folder_name: "다른 폴더" })).rejects.toThrow("일치하지 않습니다");
    expect((await listProjects()).some((item) => item.id === removed.id)).toBe(true);
    await deleteProject(removed);
    const remaining = await listProjects();
    expect(remaining.some((item) => item.id === removed.id)).toBe(false);
    expect(remaining.some((item) => item.id === kept.id)).toBe(true);
    expect(await getRenderedVideo(removed)).toBeNull();
    expect(await db.get("audio", recordingKey)).toBeUndefined();
  });
});

describe("video cache", () => {
  it("requires a new MP4 when the rendering layout changes", async () => {
    vi.stubGlobal("window", {});
    const project = createProjectDraft(25, "영상 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = await createProjectOnDisk(project);
    const db = await openDB("great100-studio", 4);
    await db.put("videos", { id: project.id, updated_at: project.updated_at, blob: new Blob(["old"], { type: "video/mp4" }) });
    expect(await getRenderedVideo(project)).toBeNull();
    await saveRenderedVideo(project, new Blob(["new"], { type: "video/mp4" }));
    expect((await getRenderedVideo(project))?.size).toBe(3);
  });
});

describe("project prompt persistence", () => {
  it("stores a complete prompt for every scene", async () => {
    vi.stubGlobal("window", {});
    const project = createProjectDraft(23, "프롬프트 시험", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = await createProjectOnDisk(project);
    await saveProject(project);
    const saved = (await listProjects()).find((item) => item.id === project.id)!;
    expect(saved.scenes).toHaveLength(project.scenes.length);
    expect(saved.scenes[0].full_prompt).toContain(saved.character_profile.description);
    expect(saved.scenes[0].full_prompt).toContain(saved.style_guide);
  });
});

afterEach(() => vi.unstubAllGlobals());
