import { invoke } from "@tauri-apps/api/core";
import { openDB, type IDBPDatabase } from "idb";
import JSZip from "jszip";
import { MAX_MUSIC_BYTES, MAX_MUSIC_SECONDS } from "./music-limits";
import { composeScenePrompt, composeThumbnailPrompt, withFullImagePrompts } from "./prompts";
import { inspectSceneVideo, validateSceneVideoFile } from "./scene-video";
import { cloudContext, createCloudProject, deleteCloudProject, deleteCloudFile, downloadCloudFile, getCloudRenderedVideo, listCloudProjects, nextCloudEpisode, readCloudProject, saveCloudProject, saveCloudRenderedVideo, uploadCloudFile } from "./cloud";
import { cloudAccessToken } from "./cloud-session";
import { detectImageFormat } from "./image-format";
import { prepareReferenceImage } from "./reference-image";
import { assertEditorWrite, prepareEditorWrite, readEditorProject } from "./editor-format";
import type { BackgroundMusic, GenerateRequest, ImageCandidate, ProjectData, Scene, SceneNarrationAudio, VisualAsset } from "./types";

export { detectImageFormat } from "./image-format";

export const isTauri = () => "__TAURI_INTERNALS__" in window;
const VIDEO_RENDER_VERSION = 9;

const database = () => new Promise<IDBPDatabase>((resolve, reject) => {
  let blocked = false;
  openDB("great100-studio", 6, {
    blocked() {
      blocked = true;
      reject(new Error("저장소 업데이트를 위해 Great100의 다른 탭을 닫거나 새로고침한 뒤 다시 시도해 주세요."));
    },
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
    upgrade(db) {
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    },
  }).then((db) => { if (blocked) db.close(); else resolve(db); }, reject);
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
  if (isTauri()) return (await invoke<ProjectData[]>("list_projects")).map(readEditorProject);
  if (cloudContext()) return listCloudProjects();
  return listLocalProjects();
}

export async function listLocalProjects(): Promise<ProjectData[]> {
  const db = await database();
  const projects = await db.getAll("projects") as ProjectData[];
  return projects.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(readEditorProject);
}

export async function localProjectsForImport(): Promise<ProjectData[]> {
  const context = cloudContext();
  if (!context) return [];
  const db = await database();
  const projects = await listLocalProjects();
  const pending = await Promise.all(projects.filter(project => !project.cloud_owner_id).map(async project => {
    const marker = await db.get("settings", `cloud-import:${context.userId}:${project.id}`);
    return marker?.completed ? null : project;
  }));
  return pending.filter((project): project is ProjectData => !!project);
}

export async function importLocalProject(localId: string, onProgress: (message: string) => void = () => {}): Promise<void> {
  const context = cloudContext();
  if (!context) throw new Error("로그인 후 작업을 옮겨 주세요.");
  const db = await database();
  const original = await db.get("projects", localId) as ProjectData | undefined;
  if (!original || original.cloud_owner_id) throw new Error("이 브라우저의 원본 프로젝트를 찾지 못했습니다.");
  const markerKey = `cloud-import:${context.userId}:${original.id}`;
  const marker = await db.get("settings", markerKey) as { id: string; completed?: boolean } | undefined;
  if (marker?.completed) return;
  await cloudAccessToken(context);
  let saved = marker ? await readCloudProject(marker.id) : null;
  if (!saved) {
    const empty = { ...structuredClone(original), id: crypto.randomUUID(), cloud_owner_id: context.userId, migration_pending: true,
      background_music: undefined,
      anchor: { ...original.anchor, candidates: [], selected_candidate_id: undefined },
      thumbnail: { ...original.thumbnail, candidates: [], selected_candidate_id: undefined },
      scenes: original.scenes.map(scene => ({ ...scene, candidates: [], support_candidates: [], narration_audio: undefined, selected_candidate_id: undefined, support_selected_candidate_id: undefined })),
    };
    saved = await createCloudProject(empty);
    await db.put("settings", { id: saved.id, completed: false }, markerKey);
  }
  if (!saved.migration_pending) { await db.put("settings", { id: saved.id, completed: true }, markerKey); return; }
  const target = readEditorProject({ ...structuredClone(original), id: saved.id, episode: saved.episode, folder_name: saved.folder_name,
    project_path: saved.project_path, cloud_owner_id: context.userId, cloud_version: saved.cloud_version, migration_pending: true });
  const rewrite = (path: string) => path.replace(`${original.project_path}/`, `${target.project_path}/`);
  const existingCandidates = new Map([saved.anchor, saved.thumbnail, ...saved.scenes].flatMap(asset => asset.candidates)
    .concat(saved.scenes.flatMap(scene => scene.support_candidates || [])).map(candidate => [candidate.id, candidate]));
  const all = [target.anchor, target.thumbnail, ...target.scenes].flatMap(asset => asset.candidates)
    .concat(target.scenes.flatMap(scene => scene.support_candidates || []));
  let done = 0;
  for (const candidate of all) {
    onProgress(`이미지·동영상 옮기는 중 ${++done}/${all.length}`);
    candidate.path = rewrite(candidate.path);
    const previous = existingCandidates.get(candidate.id);
    if (previous?.storage_key) {
      candidate.storage_key = previous.storage_key;
      candidate.preview_storage_key = previous.preview_storage_key;
      continue;
    }
    if (candidate.media_type === "video") {
      const local = await db.get("media", sceneVideoKey(original, candidate.id)) as { blob: Blob } | undefined;
      if (!local?.blob) throw new Error("동영상 원본이 없습니다. 원래 작업하던 브라우저에서 다시 시도해 주세요.");
      candidate.storage_key = await uploadCloudFile(target.id, new Blob([local.blob], { type: "video/mp4" }), context);
      candidate.preview_storage_key = await uploadCloudFile(target.id, await (await fetch(candidate.preview_url)).blob(), context);
    } else {
      if (!candidate.preview_url.startsWith("data:image/")) throw new Error("이미지 원본을 찾지 못했습니다.");
      candidate.storage_key = await uploadCloudFile(target.id, await (await fetch(candidate.preview_url)).blob(), context);
    }
  }
  if (target.background_music) {
    onProgress("배경음악 옮기는 중");
    const local = await db.get("audio", original.id) as { blob: Blob } | undefined;
    if (!local?.blob) throw new Error("배경음악 원본을 찾지 못했습니다.");
    target.background_music.path = rewrite(target.background_music.path);
    target.background_music.storage_key = saved.background_music?.storage_key || await uploadCloudFile(target.id, new Blob([local.blob], { type: target.background_music.mime_type }), context);
  }
  for (const scene of target.scenes) {
    if (!scene.narration_audio) continue;
    onProgress(`Scene ${scene.number} 녹음 옮기는 중`);
    const local = await db.get("audio", narrationKey(original, scene)) as { blob: Blob } | undefined;
    if (!local?.blob) throw new Error(`Scene ${scene.number} 녹음 원본을 찾지 못했습니다.`);
    scene.narration_audio.path = rewrite(scene.narration_audio.path);
    scene.narration_audio.storage_key = saved.scenes.find(item => item.id === scene.id)?.narration_audio?.storage_key
      || await uploadCloudFile(target.id, new Blob([local.blob], { type: scene.narration_audio.mime_type }), context);
  }
  onProgress("편집 정보 저장 중");
  await saveCloudProject(withFullImagePrompts(target));
  const rendered = await db.get("videos", original.id) as { blob: Blob; updated_at: string; render_version: number } | undefined;
  if (rendered?.updated_at === original.updated_at && rendered.render_version === VIDEO_RENDER_VERSION) {
    onProgress("완성 MP4 옮기는 중");
    await saveCloudRenderedVideo(target, rendered.blob, VIDEO_RENDER_VERSION);
  }
  await saveCloudProject({ ...withFullImagePrompts(target), migration_pending: false });
  await db.put("settings", { id: target.id, completed: true }, markerKey);
  onProgress("계정으로 이전 완료");
}

export async function createProjectOnDisk(project: ProjectData): Promise<string> {
  assertEditorWrite(project);
  project = readEditorProject(project);
  if (isTauri()) return invoke("create_project", { project });
  const path = `projects/${project.folder_name}`;
  const db = await database();
  await db.put("projects", { ...project, project_path: path });
  return path;
}

function nextEpisode(projects: ProjectData[], last: unknown): number {
  const episodes = projects.map((project) => project.episode).concat(typeof last === "number" ? last : 0);
  return Math.max(0, ...episodes.filter((episode) => Number.isSafeInteger(episode) && episode > 0)) + 1;
}

export async function getNextProjectEpisode(): Promise<number> {
  const desktop = isTauri();
  if (!desktop && cloudContext()) return nextCloudEpisode();
  const diskProjects = desktop ? await listProjects() : [];
  const db = await database();
  const tx = db.transaction(["projects", "settings"], "readonly");
  const projects = desktop ? diskProjects : await tx.objectStore("projects").getAll() as ProjectData[];
  const last = await tx.objectStore("settings").get("last-episode");
  await tx.done;
  return nextEpisode(projects, last);
}

export async function createNumberedProject(draft: ProjectData): Promise<ProjectData> {
  assertEditorWrite(draft);
  draft = readEditorProject(draft);
  const desktop = isTauri();
  if (!desktop && cloudContext()) return createCloudProject(withFullImagePrompts(draft));
  const diskProjects = desktop ? await listProjects() : [];
  const db = await database();
  // The read and reservation share one transaction, including across browser tabs.
  const tx = db.transaction(["projects", "settings"], "readwrite");
  const store = tx.objectStore("projects");
  const projects = desktop ? diskProjects : await store.getAll() as ProjectData[];
  const last = await tx.objectStore("settings").get("last-episode");
  const episode = nextEpisode(projects, last);
  const folder_name = `${String(episode).padStart(3, "0")}_${draft.person.replace(/[\\/:*?"<>|]/g, "_")}`;
  const project = withFullImagePrompts({ ...draft, episode, folder_name, project_path: `projects/${folder_name}` });
  if (!desktop) await store.add(project);
  await tx.objectStore("settings").put(episode, "last-episode");
  await tx.done;
  if (desktop) project.project_path = await createProjectOnDisk(project);
  return project;
}

export async function saveProject(project: ProjectData): Promise<void> {
  project = prepareEditorWrite(project);
  assertEditorWrite(project);
  const complete = withFullImagePrompts(readEditorProject(project));
  if (isTauri()) return invoke("save_project", { project: complete });
  if (cloudContext(project)) return saveCloudProject(project);
  const db = await database();
  const tx = db.transaction(["projects", "settings"], "readwrite");
  try {
    const stored = await tx.objectStore("projects").get(project.id) as ProjectData | undefined;
    assertEditorWrite(project, stored);
    if (stored && (stored.editor_version ?? 0) < (project.editor_version ?? 0)) {
      const key = `editor-backup:${project.id}:${stored.editor_version ?? 0}`;
      if (!await tx.objectStore("settings").get(key)) await tx.objectStore("settings").put(stored, key);
    }
    await tx.objectStore("projects").put(complete);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* A failed IndexedDB request may have aborted it. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function deleteProject(project: ProjectData): Promise<string | undefined> {
  if (isTauri()) return invoke<string>("delete_project", { projectPath: project.project_path, projectId: project.id });
  if (cloudContext(project)) { await deleteCloudProject(project); return; }
  const db = await database();
  const saved = await db.get("projects", project.id) as ProjectData | undefined;
  if (!saved || saved.project_path !== project.project_path || saved.folder_name !== project.folder_name) {
    throw new Error("삭제할 프로젝트가 저장된 내용과 일치하지 않습니다. 목록을 새로고침해 주세요.");
  }
  const tx = db.transaction(["projects", "videos", "audio", "media", "settings"], "readwrite");
  const audio = tx.objectStore("audio");
  const media = tx.objectStore("media");
  const narrationKeys = (await audio.getAllKeys()).filter((key) => typeof key === "string" && key.startsWith(`${project.id}:narration:`));
  const mediaKeys = (await media.getAllKeys()).filter((key) => typeof key === "string" && key.startsWith(`${project.id}:scene-video:`));
  await Promise.all([tx.objectStore("projects").delete(project.id), tx.objectStore("videos").delete(project.id), ...[0, 1].map(version => tx.objectStore("settings").delete(`editor-backup:${project.id}:${version}`)), audio.delete(project.id), ...narrationKeys.map((key) => audio.delete(key)), ...mediaKeys.map((key) => media.delete(key))]);
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
  if (!isTauri() && cloudContext(project)) return { ...music, storage_key: await uploadCloudFile(project.id, new Blob([file], { type: format.mime })) };
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
  if (!isTauri() && cloudContext(project)) {
    if (!project.background_music.storage_key) throw new Error("배경음악 원본을 계정으로 옮겨 주세요.");
    return downloadCloudFile(project, project.background_music.storage_key);
  }
  if (isTauri()) {
    const encoded = await invoke<string>("read_background_music", { projectPath: project.project_path, mimeType: project.background_music.mime_type });
    return await (await fetch(`data:${project.background_music.mime_type};base64,${encoded}`)).blob();
  }
  const db = await database();
  const saved = await db.get("audio", project.id) as { blob: Blob } | undefined;
  return saved?.blob || null;
}

export async function removeBackgroundMusic(project: ProjectData): Promise<void> {
  // Cloud objects are removed only after the updated project has been committed successfully.
  if (!isTauri() && cloudContext(project)) return;
  if (isTauri()) await invoke("remove_background_music", { projectPath: project.project_path });
  else {
    const db = await database();
    await db.delete("audio", project.id);
  }
}

const NARRATION_FORMATS: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "audio/webm",
};
const narrationKey = (project: ProjectData, scene: Scene, id = scene.narration_audio?.id) => `${project.id}:narration:${scene.id}${id ? `:${id}` : ""}`;

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

export interface PreparedNarration { file: File; extension: string; mime: string; duration: number }

export async function inspectSceneNarration(file: File): Promise<PreparedNarration> {
  const { extension, mime } = detectNarrationFormat(file);
  let duration: number;
  if (extension === "mp4" || extension === "m4a") {
    try { duration = await (await import("./music")).inspectMpeg4Audio(file); }
    catch { throw new Error("녹음 파일을 읽지 못했습니다. 다른 파일을 선택해 주세요."); }
  } else {
    const audioContext = new AudioContext();
    try { duration = (await audioContext.decodeAudioData(await file.arrayBuffer())).duration; }
    catch { throw new Error("녹음 파일을 읽지 못했습니다. 다른 파일을 선택해 주세요."); }
    finally { await audioContext.close(); }
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error("녹음 길이는 0초 초과, 120초 이하여야 합니다.");
  return { file, extension, mime, duration };
}

export async function savePreparedNarration(project: ProjectData, scene: Scene, prepared: PreparedNarration): Promise<SceneNarrationAudio> {
  const { file, extension, mime, duration } = prepared;
  detectNarrationFormat(file);
  const sceneDuration = scene.duration ?? 10;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error("녹음 길이를 확인할 수 없습니다.");
  if (duration > sceneDuration + 0.15) throw new Error(`녹음이 장면 길이(${sceneDuration}초)보다 깁니다. 녹음 길이에 맞추기를 적용해 주세요.`);
  const id = crypto.randomUUID();
  const narration = { id, name: file.name, mime_type: mime, path: `${project.project_path}/03_images/scene${String(scene.number).padStart(2, "0")}/narration_${id}.${extension}`, duration_sec: duration };
  if (!isTauri() && cloudContext(project)) return { ...narration, storage_key: await uploadCloudFile(project.id, new Blob([file], { type: mime })) };
  if (isTauri()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("녹음 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    await invoke("save_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, mimeType: mime, fileId: id, dataUrl: `data:${mime};base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}` });
  } else {
    const db = await database();
    await db.put("audio", { id: narrationKey(project, scene, id), blob: file });
  }
  return narration;
}

export async function saveSceneNarration(project: ProjectData, scene: Scene, file: File): Promise<SceneNarrationAudio> {
  return savePreparedNarration(project, scene, await inspectSceneNarration(file));
}

export async function discardSceneNarration(project: ProjectData, scene: Scene, narration: SceneNarrationAudio): Promise<void> {
  if (!narration.id) return;
  if (!isTauri() && cloudContext(project)) {
    if (narration.storage_key) await deleteCloudFile(project, narration.storage_key);
  } else if (isTauri()) {
    await invoke("remove_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, fileId: narration.id, mimeType: narration.mime_type });
  } else {
    const db = await database();
    await db.delete("audio", narrationKey(project, scene, narration.id));
  }
}

export async function getSceneNarration(project: ProjectData, scene: Scene): Promise<Blob | null> {
  if (!scene.narration_audio) return null;
  if (!isTauri() && cloudContext(project)) {
    if (!scene.narration_audio.storage_key) throw new Error("녹음 원본을 계정으로 옮겨 주세요.");
    return downloadCloudFile(project, scene.narration_audio.storage_key);
  }
  if (isTauri()) {
    const encoded = await invoke<string>("read_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, mimeType: scene.narration_audio.mime_type, fileId: scene.narration_audio.id });
    return await (await fetch(`data:${scene.narration_audio.mime_type};base64,${encoded}`)).blob();
  }
  const db = await database();
  const saved = await db.get("audio", narrationKey(project, scene)) as { blob: Blob } | undefined;
  return saved?.blob || null;
}

export async function removeSceneNarration(project: ProjectData, scene: Scene): Promise<void> {
  if (!isTauri() && cloudContext(project)) return;
  if (isTauri()) await invoke("remove_scene_narration", { projectPath: project.project_path, sceneNumber: scene.number, fileId: scene.narration_audio?.id, mimeType: scene.narration_audio?.mime_type });
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

export async function resolveReferenceImage(project: ProjectData): Promise<string | undefined> {
  const candidate = project.anchor.candidates.find((item) => item.id === project.anchor.selected_candidate_id);
  if (!candidate || candidate.mode === "mock" || candidate.media_type === "video") return undefined;
  const context = !isTauri() ? cloudContext(project) : null;
  let blob: Blob;
  if (context && candidate.storage_key) {
    // Resolve a fresh signed URL instead of reusing an expiring preview URL.
    blob = await downloadCloudFile(project, candidate.storage_key);
  } else if (candidate.preview_url.startsWith("data:image/")) {
    // Local web and Tauri projects retain the full original image as a data URL.
    const response = await fetch(candidate.preview_url);
    if (!response.ok) throw new Error("기준 이미지 원본을 읽지 못했습니다. 다시 업로드해 주세요.");
    blob = await response.blob();
  } else {
    throw new Error("기준 이미지 원본을 찾지 못했습니다. 작업을 다시 열거나 이미지를 업로드해 주세요.");
  }
  return prepareReferenceImage(blob);
}

type ImageLocation = Pick<GenerateRequest, "project_path" | "asset_kind" | "scene_number">;

export async function importImageCandidates(files: File[], location: ImageLocation): Promise<ImageCandidate[]> {
  if (!files.length) return [];
  if (files.length > 6) throw new Error("한 번에 최대 6장까지 업로드할 수 있습니다.");
  const context = !isTauri() ? cloudContext() : null;
  const projectId = context ? await findCloudProjectId(location.project_path, context) : undefined;
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
      const storage_key = projectId ? await uploadCloudFile(projectId, new Blob([file], { type: format.mime }), context!) : undefined;
      candidates.push({ id, path: candidatePath(location, id, format.extension), preview_url: previewUrl, created_at: new Date().toISOString(), mode: "uploaded", ...(storage_key ? { storage_key } : {}) });
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
  if (!isTauri() && cloudContext(project)) {
    const storage_key = await uploadCloudFile(project.id, new Blob([file], { type: "video/mp4" }));
    const preview_storage_key = await uploadCloudFile(project.id, await (await fetch(poster)).blob());
    return { id, path, preview_url: poster, created_at: new Date().toISOString(), mode: "uploaded", media_type: "video", duration_sec: duration, storage_key, preview_storage_key };
  }
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
  if (!isTauri() && cloudContext(project)) {
    if (!candidate.storage_key) throw new Error("동영상 원본을 계정으로 옮겨 주세요.");
    return downloadCloudFile(project, candidate.storage_key);
  }
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
  if (!isTauri() && cloudContext(project)) return;
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
  if (!isTauri() && cloudContext(project)) return saveCloudRenderedVideo(project, blob, VIDEO_RENDER_VERSION);
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
  if (!isTauri() && cloudContext(project)) return getCloudRenderedVideo(project, VIDEO_RENDER_VERSION);
  const db = await database();
  const saved = await db.get("videos", project.id) as { updated_at: string; render_version?: number; blob: Blob } | undefined;
  return saved?.updated_at === project.updated_at && saved.render_version === VIDEO_RENDER_VERSION ? saved.blob : null;
}

export async function exportProjectZip(project: ProjectData): Promise<void> {
  const video = await getRenderedVideo(project);
  downloadBlob(await buildProjectZip(project, video || undefined), `${project.folder_name}.zip`);
}

export async function buildProjectZip(project: ProjectData, video?: Blob): Promise<Blob> {
  project = readEditorProject(project);
  const zip = new JSZip();
  const root = zip.folder(project.folder_name)!;
  for (const folder of ["01_source", "02_character", "03_images", "04_thumbnail", "05_exports", "06_logs"]) root.folder(folder);
  root.file("01_source/work_result.txt", project.source_text);
  if (project.source) root.file("01_source/app_data.json", JSON.stringify(project.source, null, 2));
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
    if (scene.narration_audio.id) root.file(`03_images/scene${String(scene.number).padStart(2, "0")}/narration_${scene.narration_audio.id}.${scene.narration_audio.path.split(".").at(-1)}`, narration);
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
      const blob = candidate.media_type === "video" ? await getSceneVideo(project, project.scenes[assetIndex - 2], candidate)
        : candidate.storage_key && cloudContext(project) ? await downloadCloudFile(project, candidate.storage_key) : await (await fetch(candidate.preview_url)).blob();
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

async function findCloudProjectId(projectPath: string, context: NonNullable<ReturnType<typeof cloudContext>>): Promise<string> {
  const { data, error } = await context.client.from("great100_projects").select("id").eq("owner_id", context.userId).eq("data->>project_path", projectPath).single();
  if (error || !data) throw new Error("이미지를 저장할 프로젝트를 찾지 못했습니다.");
  return data.id;
}

function historyLines(kind: string, asset: VisualAsset) {
  return asset.prompt_history.map((revision) => JSON.stringify({ asset_kind: kind, ...revision }));
}
