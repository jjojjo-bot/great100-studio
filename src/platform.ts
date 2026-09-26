import { invoke } from "@tauri-apps/api/core";
import { openDB } from "idb";
import JSZip from "jszip";
import { MAX_MUSIC_BYTES, MAX_MUSIC_SECONDS } from "./music-limits";
import { composeScenePrompt, composeThumbnailPrompt, withFullImagePrompts } from "./prompts";
import { inspectSceneVideo, validateSceneVideoFile } from "./scene-video";
import type { BackgroundMusic, GenerateRequest, ImageCandidate, ProjectData, Scene, SceneNarrationAudio, VisualAsset } from "./types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;
const VIDEO_RENDER_VERSION = 7;

const database = () => openDB("great100-studio", 4, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
    if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
    if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
  },
});

function mockPreview(label: string, index: number) {
  const colors = [["#102f2d", "#df8d52"], ["#5d2722", "#e6bd72"], ["#1d3858", "#78a6a0"]][index % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="480" cy="220" r="95" fill="#f3d7b2" opacity=".9"/><path d="M300 520 Q340 310 480 320 Q620 310 660 520" fill="#d45b3d" opacity=".9"/><path d="M385 185 Q480 70 575 185 L545 140 L415 140Z" fill="#262b2b"/><text x="48" y="475" font-family="sans-serif" font-size="30" fill="white" opacity=".86">${label.replace(/[<>&]/g, "")}</text><text x="48" y="510" font-family="sans-serif" font-size="18" fill="white" opacity=".6">MOCK PREVIEW · ${index + 1}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function getAccessCode() {
  return sessionStorage.getItem("great100-access-code") || "";
}

export function setAccessCode(code: string) {
  if (code.trim()) sessionStorage.setItem("great100-access-code", code.trim());
  else sessionStorage.removeItem("great100-access-code");
}

export async function listProjects(): Promise<ProjectData[]> {
  if (isTauri()) return invoke("list_projects");
  const db = await database();
  const projects = await db.getAll("projects") as ProjectData[];
  return projects.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createProjectOnDisk(project: ProjectData): Promise<string> {
  if (isTauri()) return invoke("create_project", { project });
  const path = `projects/${project.folder_name}`;
  const db = await database();
  await db.put("projects", { ...project, project_path: path });
  return path;
}

export async function saveProject(project: ProjectData): Promise<void> {
  const complete = withFullImagePrompts(project);
  if (isTauri()) return invoke("save_project", { project: complete });
  const db = await database();
  await db.put("projects", complete);
}

export async function deleteProject(project: ProjectData): Promise<string | undefined> {
  if (isTauri()) return invoke<string>("delete_project", { projectPath: project.project_path, projectId: project.id });
  const db = await database();
  const saved = await db.get("projects", project.id) as ProjectData | undefined;
  if (!saved || saved.project_path !== project.project_path || saved.folder_name !== project.folder_name) {
    throw new Error("삭제할 프로젝트가 저장된 내용과 일치하지 않습니다. 목록을 새로고침해 주세요.");
  }
  const tx = db.transaction(["projects", "videos", "audio", "media"], "readwrite");
  const audio = tx.objectStore("audio");
  const media = tx.objectStore("media");
  const narrationKeys = (await audio.getAllKeys()).filter((key) => typeof key === "string" && key.startsWith(`${project.id}:narration:`));
  const mediaKeys = (await media.getAllKeys()).filter((key) => typeof key === "string" && key.startsWith(`${project.id}:scene-video:`));
  await Promise.all([tx.objectStore("projects").delete(project.id), tx.objectStore("videos").delete(project.id), audio.delete(project.id), ...narrationKeys.map((key) => audio.delete(key)), ...mediaKeys.map((key) => media.delete(key))]);
  await tx.done;
}

const MUSIC_FORMATS: Record<string, { extension: string; mime: string }> = {
  mp3: { extension: "mp3", mime: "audio/mpeg" },
  wav: { extension: "wav", mime: "audio/wav" },
  m4a: { extension: "m4a", mime: "audio/mp4" },
  mp4: { extension: "mp4", mime: "video/mp4" },
};

export function detectMusicFormat(file: Pick<File, "name" | "type" | "size">): { extension: string; mime: string } {
  if (!file.size || file.size > MAX_MUSIC_BYTES) throw new Error("배경음악은 100MB 이하 파일만 사용할 수 있습니다.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  const format = MUSIC_FORMATS[extension];
  if (!format) throw new Error("MP3, WAV, M4A, MP4(MPEG-4) 배경음악만 사용할 수 있습니다.");
  const alternativeTypes = extension === "wav" ? ["audio/x-wav", "audio/wave"]
    : extension === "m4a" ? ["audio/x-m4a", "audio/aac"]
      : extension === "mp4" ? ["audio/mp4", "application/mp4"] : ["audio/mp3"];
  if (file.type && ![format.mime, ...alternativeTypes].includes(file.type)) {
    throw new Error("파일 확장자와 오디오 형식이 맞지 않습니다.");
  }
  return format;
}

export async function saveBackgroundMusic(project: ProjectData, file: File): Promise<BackgroundMusic> {
  const format = detectMusicFormat(file);
  let duration = 0;
  if (format.extension === "mp4") duration = await (await import("./music")).inspectMpeg4Audio(file);
  else {
    const audioContext = new AudioContext();
    try { duration = (await audioContext.decodeAudioData(await file.arrayBuffer())).duration; }
    catch { throw new Error("음악 파일을 재생할 수 없습니다. 다른 MP3, WAV, M4A 또는 MP4 파일을 선택해 주세요."); }
    finally { await audioContext.close(); }
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MUSIC_SECONDS) throw new Error("배경음악은 15분 이하 파일만 사용할 수 있습니다. 짧은 음악은 영상 길이만큼 반복됩니다.");
  const music = { name: file.name, mime_type: format.mime, path: `${project.project_path}/01_source/background_music.${format.extension}` };
  if (isTauri()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("음악 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    await invoke("save_background_music", { projectPath: project.project_path, mimeType: format.mime, dataUrl: `data:${format.mime};base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}` });
  } else {
    const db = await database();
    await db.put("audio", { id: project.id, blob: file });
  }
  return music;
}

export async function getBackgroundMusic(project: ProjectData): Promise<Blob | null> {
  if (!project.background_music) return null;
  if (isTauri()) {
    const encoded = await invoke<string>("read_background_music", { projectPath: project.project_path, mimeType: project.background_music.mime_type });
    return await (await fetch(`data:${project.background_music.mime_type};base64,${encoded}`)).blob();
  }
  const db = await database();
  const saved = await db.get("audio", project.id) as { blob: Blob } | undefined;
  return saved?.blob || null;
}

export async function removeBackgroundMusic(project: ProjectData): Promise<void> {
  if (isTauri()) await invoke("remove_background_music", { projectPath: project.project_path });
  else {
    const db = await database();
    await db.delete("audio", project.id);
  }
}

const NARRATION_FORMATS: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "audio/webm",
};
const narrationKey = (project: ProjectData, scene: Scene) => `${project.id}:narration:${scene.id}`;

export function detectNarrationFormat(file: Pick<File, "name" | "type" | "size">): { extension: string; mime: string } {
  if (!file.size || file.size > 30_000_000) throw new Error("씬 녹음은 30MB 이하 파일만 사용할 수 있습니다.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  const mime = NARRATION_FORMATS[extension];
  if (!mime) throw new Error("MP3, WAV, M4A, MP4, WebM 녹음만 사용할 수 있습니다.");
  const actual = file.type.split(";")[0].toLowerCase();
  if (actual && actual !== mime && !(extension === "wav" && ["audio/x-wav", "audio/wave"].includes(actual)) && !(extension === "m4a" && actual === "audio/x-m4a")) {
    throw new Error("녹음 파일 확장자와 오디오 형식이 맞지 않습니다.");
  }
  return { extension, mime };
}

export async function saveSceneNarration(project: ProjectData, scene: Scene, file: File): Promise<SceneNarrationAudio> {
  const { extension, mime } = detectNarrationFormat(file);
  const audioContext = new AudioContext();
  let duration = 0;
  try {
    duration = extension === "mp4" || extension === "m4a"
      ? await (await import("./music")).inspectMpeg4Audio(file)
      : (await audioContext.decodeAudioData(await file.arrayBuffer())).duration;
  } catch { throw new Error("녹음 파일을 읽지 못했습니다. 다른 파일을 선택해 주세요."); }
  finally { await audioContext.close(); }
  const sceneDuration = scene.duration ?? 10;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("녹음 길이를 확인할 수 없습니다.");
  if (duration > sceneDuration + 0.15) throw new Error(`녹음이 장면 길이(${sceneDuration}초)보다 깁니다. ${duration.toFixed(1)}초 녹음을 짧게 다시 만들거나 장면 시간을 조정해 주세요.`);
  const narration = { name: file.name, mime_type: mime, path: `${project.project_path}/03_images/scene${String(scene.number).padStart(2, "0")}/narration.${extension}`, duration_sec: duration };
  if (isTauri()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("녹음 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    await invoke("save_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, mimeType: mime, dataUrl: `data:${mime};base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}` });
  } else {
    const db = await database();
    await db.put("audio", { id: narrationKey(project, scene), blob: file });
  }
  return narration;
}

export async function getSceneNarration(project: ProjectData, scene: Scene): Promise<Blob | null> {
  if (!scene.narration_audio) return null;
  if (isTauri()) {
    const encoded = await invoke<string>("read_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, mimeType: scene.narration_audio.mime_type });
    return await (await fetch(`data:${scene.narration_audio.mime_type};base64,${encoded}`)).blob();
  }
  const db = await database();
  const saved = await db.get("audio", narrationKey(project, scene)) as { blob: Blob } | undefined;
  return saved?.blob || null;
}

export async function removeSceneNarration(project: ProjectData, scene: Scene): Promise<void> {
  if (isTauri()) await invoke("remove_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number });
  else {
    const db = await database();
    await db.delete("audio", narrationKey(project, scene));
  }
}

export async function generateImages(request: GenerateRequest): Promise<ImageCandidate[]> {
  if (isTauri()) return invoke("generate_images", { request });
  const accessCode = getAccessCode();
  if (accessCode) {
    const generated: ImageCandidate[] = [];
    for (let index = 0; index < request.count; index++) {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessCode}` },
        body: JSON.stringify({ prompt: request.prompt, reference_image: request.reference_image }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `이미지 생성 실패 (${response.status})`);
      const id = crypto.randomUUID();
      generated.push({
        id,
        path: candidatePath(request, id, "jpg"),
        preview_url: `data:image/jpeg;base64,${result.image_base64}`,
        created_at: new Date().toISOString(),
        mode: "openai",
      });
    }
    return generated;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const label = request.asset_kind === "scene" || request.asset_kind === "support" ? `${request.asset_kind.toUpperCase()} ${String(request.scene_number).padStart(2, "0")}` : request.asset_kind.toUpperCase();
  return Array.from({ length: request.count }, (_, index) => {
    const id = crypto.randomUUID();
    return { id, path: candidatePath(request, id, "svg"), preview_url: mockPreview(label, index), created_at: new Date().toISOString(), mode: "mock" as const };
  });
}

type ImageLocation = Pick<GenerateRequest, "project_path" | "asset_kind" | "scene_number">;
type ImageFormat = { mime: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp" };

export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

export async function importImageCandidates(files: File[], location: ImageLocation): Promise<ImageCandidate[]> {
  if (!files.length) return [];
  if (files.length > 6) throw new Error("한 번에 최대 6장까지 업로드할 수 있습니다.");
  const checked = await Promise.all(files.map(async (file) => {
    if (!file.size || file.size > 12_000_000) throw new Error(`${file.name}: 12MB 이하 이미지만 업로드할 수 있습니다.`);
    const format = detectImageFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!format) throw new Error(`${file.name}: PNG, JPEG, WebP 이미지만 사용할 수 있습니다.`);
    if (file.type && file.type !== format.mime) throw new Error(`${file.name}: 파일 형식이 확장자 정보와 맞지 않습니다.`);
    return { file, format };
  }));
  const candidates: ImageCandidate[] = [];
  for (const { file, format } of checked) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`${file.name}: 파일을 읽지 못했습니다.`));
      reader.readAsDataURL(file);
    });
    const previewUrl = `data:${format.mime};base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}`;
    if (isTauri()) {
      candidates.push(await invoke<ImageCandidate>("import_image", { request: { ...location, data_url: previewUrl } }));
    } else {
      const id = crypto.randomUUID();
      candidates.push({ id, path: candidatePath(location, id, format.extension), preview_url: previewUrl, created_at: new Date().toISOString(), mode: "uploaded" });
    }
  }
  return candidates;
}

const sceneVideoKey = (project: ProjectData, candidateId: string) => `${project.id}:scene-video:${candidateId}`;

export async function importSceneVideo(project: ProjectData, scene: Scene, file: File): Promise<ImageCandidate> {
  validateSceneVideoFile(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  const { duration, poster } = await inspectSceneVideo(file);
  let id: string = crypto.randomUUID();
  let path = `${project.project_path}/03_images/scene${String(scene.number).padStart(2, "0")}/candidate_${id}.mp4`;
  if (isTauri()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("동영상 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    const saved = await invoke<{ id: string; path: string }>("import_scene_video", { projectPath: project.project_path, sceneNumber: scene.number, dataUrl: `data:video/mp4;base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}` });
    id = saved.id;
    path = saved.path;
  } else {
    const db = await database();
    await db.put("media", { id: sceneVideoKey(project, id), blob: file });
  }
  return { id, path, preview_url: poster, created_at: new Date().toISOString(), mode: "uploaded", media_type: "video", duration_sec: duration };
}

export async function getSceneVideo(project: ProjectData, scene: Scene, candidate: ImageCandidate): Promise<Blob | null> {
  if (candidate.media_type !== "video") return null;
  if (isTauri()) {
    const encoded = await invoke<string>("read_scene_video", { projectPath: project.project_path, sceneNumber: scene.number, candidateId: candidate.id });
    return await (await fetch(`data:video/mp4;base64,${encoded}`)).blob();
  }
  const db = await database();
  const saved = await db.get("media", sceneVideoKey(project, candidate.id)) as { blob: Blob } | undefined;
  return saved?.blob || null;
}

export async function deleteCandidateAsset(project: ProjectData, kind: "anchor" | "scene" | "support" | "thumbnail", candidate: ImageCandidate, sceneNumber?: number): Promise<void> {
  const scene = sceneNumber === undefined ? undefined : project.scenes.find((item) => item.number === sceneNumber);
  const candidates = kind === "anchor" ? project.anchor.candidates : kind === "thumbnail" ? project.thumbnail.candidates
    : kind === "scene" ? scene?.candidates : scene?.support_candidates;
  if (!candidates?.some((item) => item.id === candidate.id && item.path === candidate.path)) {
    throw new Error("삭제할 후보가 현재 프로젝트에 없습니다. 화면을 새로고침해 주세요.");
  }
  if (isTauri()) {
    await invoke("delete_candidate_file", { projectPath: project.project_path, assetKind: kind, sceneNumber, candidateId: candidate.id, candidatePath: candidate.path });
  }
  const db = await database();
  const tx = db.transaction(["media", "videos"], "readwrite");
  if (candidate.media_type === "video") await tx.objectStore("media").delete(sceneVideoKey(project, candidate.id));
  await tx.objectStore("videos").delete(project.id);
  await tx.done;
}

function candidatePath(request: ImageLocation, id: string, extension: string) {
  const folder = request.asset_kind === "scene" || request.asset_kind === "support" ? `03_images/scene${String(request.scene_number).padStart(2, "0")}` : request.asset_kind === "anchor" ? "02_character" : "04_thumbnail";
  const prefix = request.asset_kind === "support" ? "support_" : "candidate_";
  return `${request.project_path}/${folder}/${prefix}${id}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveRenderedVideo(project: ProjectData, blob: Blob): Promise<void> {
  if (isTauri()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    await invoke("save_video", { projectPath: project.project_path, dataUrl: `data:video/mp4;base64,${btoa(binary)}` });
  }
  const db = await database();
  await db.put("videos", { id: project.id, updated_at: project.updated_at, render_version: VIDEO_RENDER_VERSION, blob });
}

export async function getRenderedVideo(project: ProjectData): Promise<Blob | null> {
  const db = await database();
  const saved = await db.get("videos", project.id) as { updated_at: string; render_version?: number; blob: Blob } | undefined;
  return saved?.updated_at === project.updated_at && saved.render_version === VIDEO_RENDER_VERSION ? saved.blob : null;
}

export async function exportProjectZip(project: ProjectData): Promise<void> {
  const video = await getRenderedVideo(project);
  if (!video) throw new Error("완성 단계에서 MP4를 먼저 만들어 주세요.");
  downloadBlob(await buildProjectZip(project, video), `${project.folder_name}.zip`);
}

export async function buildProjectZip(project: ProjectData, video?: Blob): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(project.folder_name)!;
  for (const folder of ["01_source", "02_character", "03_images", "04_thumbnail", "05_exports", "06_logs"]) root.folder(folder);
  root.file("01_source/work_result.txt", project.source_text);
  if (project.background_music) {
    const music = await getBackgroundMusic(project);
    if (!music) throw new Error("배경음악 파일을 찾지 못했습니다. 다시 업로드해 주세요.");
    root.file(`01_source/background_music.${project.background_music.path.split(".").at(-1)}`, music);
  }
  for (const scene of project.scenes) {
    if (!scene.narration_audio) continue;
    const narration = await getSceneNarration(project, scene);
    if (!narration) throw new Error(`Scene ${scene.number} 녹음 파일을 찾지 못했습니다.`);
    root.file(`03_images/scene${String(scene.number).padStart(2, "0")}/narration.${scene.narration_audio.path.split(".").at(-1)}`, narration);
  }
  const withoutPreviews = structuredClone(withFullImagePrompts(project));
  for (const asset of [withoutPreviews.anchor, withoutPreviews.thumbnail, ...withoutPreviews.scenes]) {
    asset.candidates = asset.candidates.map(({ preview_url: _preview, ...candidate }) => ({ ...candidate, preview_url: "" }));
  }
  for (const scene of withoutPreviews.scenes) scene.support_candidates = scene.support_candidates?.map(({ preview_url: _preview, ...candidate }) => ({ ...candidate, preview_url: "" }));
  root.file("project_data.json", JSON.stringify(withoutPreviews, null, 2));
  for (const scene of project.scenes) {
    root.file(`03_images/scene${String(scene.number).padStart(2, "0")}/image_prompt.txt`, composeScenePrompt(project, scene));
    if (scene.support_image_prompt) root.file(`03_images/scene${String(scene.number).padStart(2, "0")}/support_image_prompt.txt`, scene.support_image_prompt);
  }
  root.file("04_thumbnail/image_prompt.txt", composeThumbnailPrompt(project));
  if (video) root.file(`05_exports/${project.folder_name}.mp4`, video);
  const promptHistory = [
    ...historyLines("anchor", project.anchor),
    ...project.scenes.flatMap((scene) => historyLines(`scene${String(scene.number).padStart(2, "0")}`, scene)),
    ...project.scenes.flatMap((scene) => (scene.support_prompt_history || []).map((revision) => JSON.stringify({ asset_kind: `scene${String(scene.number).padStart(2, "0")}_support`, ...revision }))),
    ...historyLines("thumbnail", project.thumbnail),
  ];
  root.file("06_logs/prompt_history.jsonl", promptHistory.join("\n") + (promptHistory.length ? "\n" : ""));
  for (const [assetIndex, asset] of [project.anchor, project.thumbnail, ...project.scenes, ...project.scenes.map((scene) => ({ candidates: scene.support_candidates || [], selected_candidate_id: scene.support_selected_candidate_id }))].entries()) {
    for (const candidate of asset.candidates) {
      const blob = candidate.media_type === "video" ? await getSceneVideo(project, project.scenes[assetIndex - 2], candidate) : await (await fetch(candidate.preview_url)).blob();
      if (!blob) throw new Error(`Scene ${project.scenes[assetIndex - 2]?.number} 동영상 파일을 찾지 못했습니다.`);
      const path = candidate.path.replace(`${project.project_path}/`, "");
      root.file(path, blob);
      if (candidate.id === asset.selected_candidate_id) {
        const folder = path.slice(0, path.lastIndexOf("/"));
        const extension = path.split(".").at(-1) || "jpg";
        root.file(`${folder}/${assetIndex >= project.scenes.length + 2 ? "selected_support" : "selected"}.${extension}`, blob);
      }
    }
  }
  return zip.generateAsync({ type: "blob" });
}

function historyLines(kind: string, asset: VisualAsset) {
  return asset.prompt_history.map((revision) => JSON.stringify({ asset_kind: kind, ...revision }));
}
