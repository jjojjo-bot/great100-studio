import { cloudAccessToken, getCloudSession, type CloudSession } from "./cloud-session";
import { assertEditorWrite, prepareEditorWrite, readEditorProject } from "./editor-format";
import { withFullImagePrompts } from "./prompts";
import { collectMediaAssets, prepareMediaProject } from "./media-composition";
import type { ImageCandidate, ProjectData } from "./types";

interface ProjectRow { id: string; owner_id: string; data: ProjectData; version: number }
export interface StorageReadiness { databaseReady: boolean; storageReady: boolean }
const versions = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
const uploadedImages = new Map<string, string>();
const savedProjects = new Map<string, ProjectData>();

export function cloudContext(project?: ProjectData): CloudSession | null {
  const context = getCloudSession();
  if (project?.cloud_owner_id && project.cloud_owner_id !== context?.userId) throw new Error("이 프로젝트의 계정으로 다시 로그인해 주세요.");
  return context;
}

function requireContext(project?: ProjectData): CloudSession {
  const context = cloudContext(project);
  if (!context) throw new Error("계정 저장을 사용하려면 로그인해 주세요.");
  return context;
}

export async function mediaRequest<T>(context: CloudSession, body: Record<string, unknown>): Promise<T> {
  const token = await cloudAccessToken(context);
  const response = await fetch("/api/media", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "계정 저장소에 연결하지 못했습니다.");
  return result as T;
}

export async function checkCloudStorage(): Promise<StorageReadiness> {
  return mediaRequest(requireContext(), { operation: "status" });
}

export async function uploadCloudFile(projectId: string, blob: Blob, context = requireContext()): Promise<string> {
  const contentType = blob.type.split(";")[0].trim().toLowerCase();
  const signed = await mediaRequest<{ key: string; url: string }>(context, { operation: "upload", projectId, contentType, size: blob.size });
  const response = await fetch(signed.url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob, signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error("파일 업로드가 완료되지 않았습니다. 연결 상태와 저장소 설정을 확인해 주세요.");
  return signed.key;
}

export async function cloudFileUrls(projectId: string, keys: string[], context = requireContext()): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const unique = [...new Set(keys)];
  for (let start = 0; start < unique.length; start += 100) {
    const signed = await mediaRequest<{ urls: Record<string, string> }>(context, { operation: "read", projectId, keys: unique.slice(start, start + 100) });
    Object.assign(result, signed.urls);
  }
  return result;
}

export async function downloadCloudFile(project: ProjectData, key: string): Promise<Blob> {
  const urls = await cloudFileUrls(project.id, [key], requireContext(project));
  const response = await fetch(urls[key], { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error("저장한 파일을 불러오지 못했습니다.");
  return response.blob();
}

export async function deleteCloudFile(project: ProjectData, key: string): Promise<void> {
  await mediaRequest(requireContext(project), { operation: "delete", projectId: project.id, key });
}

function candidates(project: ProjectData): ImageCandidate[] {
  return [project.anchor, project.thumbnail, ...project.scenes].flatMap(asset => asset.candidates)
    .concat(project.scenes.flatMap(scene => scene.support_candidates || []));
}

export async function refreshCloudPreviews(project: ProjectData): Promise<ProjectData> {
  const context = requireContext(project);
  const next = structuredClone(project);
  const all = candidates(next);
  const keys = [...all.map(candidate => candidate.media_type === "video" ? candidate.preview_storage_key : candidate.storage_key),
    ...(next.media?.assets || []).map(asset => asset.kind === "video" ? asset.preview_storage_key : asset.kind === "image" ? asset.storage_key : undefined)].filter((key): key is string => !!key);
  const urls = await cloudFileUrls(project.id, keys, context);
  for (const candidate of all) {
    const key = candidate.media_type === "video" ? candidate.preview_storage_key : candidate.storage_key;
    if (key) candidate.preview_url = urls[key];
  }
  for (const asset of next.media?.assets || []) {
    const key = asset.kind === "video" ? asset.preview_storage_key : asset.kind === "image" ? asset.storage_key : undefined;
    if (key) asset.preview_url = urls[key];
  }
  return next;
}

function databaseError(error: { code?: string; message?: string }): Error {
  if (error.message?.includes("PROJECT_EDITOR_VERSION")) return new Error("저장된 프로젝트의 편집 형식이 더 최신입니다. 앱을 새로고침하고 최신 작업을 다시 열어 주세요.");
  if (error.message?.includes("PROJECT_SOURCE_IMMUTABLE")) return new Error("원본 제작안은 변경할 수 없습니다. 수정한 제작안은 새 프로젝트로 만들어 주세요.");
  if (error.message?.includes("PROJECT_MEDIA_IMMUTABLE")) return new Error("보관 중인 원본 자료는 제거하거나 교체할 수 없습니다. 최신 작업을 다시 열어 주세요.");
  if (error.message?.includes("PROJECT_MEDIA_INVALID")) return new Error("원본 자료 목록이 잘못되었습니다. 최신 작업을 다시 열어 주세요.");
  if (error.code === "PGRST202") return new Error("편집 형식 저장 설정이 필요합니다. DB의 편집 호환성 업데이트를 적용해 주세요.");
  if (error.code === "40001" || error.message?.includes("PROJECT_CONFLICT")) return new Error("다른 PC나 탭에서 이 프로젝트가 수정되었습니다. 현재 편집본을 ZIP으로 보관한 뒤 최신 작업을 다시 열어 주세요.");
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code || "")) return new Error("계정 저장 설정이 아직 완료되지 않았습니다. DB 설치 안내를 확인해 주세요.");
  return new Error("계정에 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
}

function versionKey(context: CloudSession, id: string): string { return `${context.userId}:${id}`; }

function rowProject(row: ProjectRow): ProjectData {
  return readEditorProject({ ...row.data, cloud_owner_id: row.owner_id, cloud_version: row.version });
}

export async function listCloudProjects(): Promise<ProjectData[]> {
  const context = requireContext();
  const { data, error } = await context.client.from("great100_projects").select("id,owner_id,data,version").eq("owner_id", context.userId).order("updated_at", { ascending: false });
  if (error) throw databaseError(error);
  return Promise.all((data as ProjectRow[]).map(async row => {
    versions.set(versionKey(context, row.id), row.version);
    savedProjects.set(versionKey(context, row.id), row.data);
    return refreshCloudPreviews(rowProject(row));
  })).then(projects => projects.filter(project => !project.migration_pending));
}

export async function nextCloudEpisode(): Promise<number> {
  const context = requireContext();
  const { data, error } = await context.client.from("great100_projects").select("episode").eq("owner_id", context.userId).order("episode", { ascending: false }).limit(1);
  if (error) throw databaseError(error);
  return (data[0]?.episode || 0) + 1;
}

export async function createCloudProject(draft: ProjectData): Promise<ProjectData> {
  assertEditorWrite(draft);
  draft = readEditorProject(draft);
  const context = requireContext(draft);
  const { data: episode, error } = await context.client.rpc("great100_reserve_episode");
  if (error) throw databaseError(error);
  const folder_name = `${String(episode).padStart(3, "0")}_${draft.person.replace(/[\\/:*?"<>|]/g, "_")}`;
  const project = { ...draft, episode: Number(episode), folder_name, project_path: `projects/${folder_name}`, cloud_owner_id: context.userId, cloud_version: 0 };
  await saveCloudProject(project);
  project.cloud_version = versions.get(versionKey(context, project.id))!;
  return project;
}

// Serialize writes per account/project so normal rapid typing cannot race its own version.
export async function saveCloudProject(project: ProjectData): Promise<void> {
  project = prepareEditorWrite(project);
  assertEditorWrite(project);
  const context = requireContext(project);
  let snapshot = withFullImagePrompts(structuredClone(readEditorProject(project)));
  const key = versionKey(context, project.id);
  const previous = queues.get(key) || Promise.resolve();
  const task = previous.then(async () => {
    await cloudAccessToken(context);
    snapshot = prepareMediaProject(snapshot, savedProjects.get(key));
    assertEditorWrite(snapshot, savedProjects.get(key));
    const expected = versions.get(key) ?? snapshot.cloud_version ?? 0;
    for (const candidate of candidates(snapshot)) {
      if (!candidate.storage_key && candidate.media_type !== "video") {
        const imageKey = `${key}:${candidate.id}`;
        candidate.storage_key = uploadedImages.get(imageKey);
        if (!candidate.storage_key) {
          if (!candidate.preview_url.startsWith("data:image/")) throw new Error("업로드할 이미지 원본을 찾지 못했습니다.");
          const blob = await (await fetch(candidate.preview_url)).blob();
          candidate.storage_key = await uploadCloudFile(snapshot.id, blob, context);
          uploadedImages.set(imageKey, candidate.storage_key);
        }
      }
      if (candidate.storage_key) candidate.preview_url = "";
    }
    snapshot = prepareMediaProject(snapshot);
    for (const asset of snapshot.media?.assets || []) {
      if (!asset.storage_key && asset.kind === "image" && asset.inline_data) {
        const imageKey = `${key}:${asset.id.replace(/^candidate:/, "")}`;
        asset.storage_key = uploadedImages.get(imageKey) || await uploadCloudFile(snapshot.id, await (await fetch(asset.inline_data)).blob(), context);
        uploadedImages.set(imageKey, asset.storage_key);
      }
      if (!asset.storage_key) throw new Error("보관할 원본 자료를 계정으로 옮겨 주세요.");
      if (asset.kind === "video" && !asset.preview_storage_key && asset.preview_inline_data) asset.preview_storage_key = await uploadCloudFile(snapshot.id, await (await fetch(asset.preview_inline_data)).blob(), context);
      delete asset.inline_data; delete asset.preview_inline_data; delete asset.preview_url;
    }
    // Never persist temporary signed URLs or UI-only revision fields in JSONB.
    const { cloud_owner_id: _owner, cloud_version: _version, ...data } = snapshot;
    const rpc = (snapshot.editor_version ?? 0) >= 5 ? "great100_save_merged_project" : (snapshot.editor_version ?? 0) >= 4 ? "great100_save_structured_project" : (snapshot.editor_version ?? 0) >= 3 ? "great100_save_media_project" : (snapshot.editor_version ?? 0) >= 2 ? "great100_save_timed_project" : "great100_save_editor_project";
    const result = await context.client.rpc(rpc, { p_id: snapshot.id, p_data: data, p_expected_version: expected });
    if (result.error?.code === "PGRST202" && (snapshot.editor_version ?? 0) >= 5) throw new Error("장면 합치기 저장 설정이 필요합니다. DB의 장면 합치기 업데이트를 적용해 주세요.");
    if (result.error?.code === "PGRST202" && (snapshot.editor_version ?? 0) >= 4) throw new Error("장면 구조 저장 설정이 필요합니다. DB의 장면 나누기 업데이트를 적용해 주세요.");
    if (result.error?.code === "PGRST202" && (snapshot.editor_version ?? 0) >= 3) throw new Error("자료 구간 저장 설정이 필요합니다. DB의 자료 구성 업데이트를 적용해 주세요.");
    if (result.error) throw databaseError(result.error);
    const row = (result.data as ProjectRow[])[0];
    if (!row) throw new Error("저장 결과를 확인하지 못했습니다.");
    versions.set(key, row.version);
    const previousProject = savedProjects.get(key);
    savedProjects.set(key, snapshot);
    if (previousProject) {
      const retained = new Set(projectFileKeys(snapshot));
      await Promise.allSettled(projectFileKeys(previousProject).filter(objectKey => !retained.has(objectKey)).map(objectKey => mediaRequest(context, { operation: "delete", projectId: snapshot.id, key: objectKey })));
    }
  });
  queues.set(key, task);
  try { await task; }
  finally { if (queues.get(key) === task) queues.delete(key); }
}

export function projectFileKeys(project: ProjectData): string[] {
  return [...new Set([
    ...candidates(project).flatMap(candidate => [candidate.storage_key, candidate.preview_storage_key]),
    project.background_music?.storage_key, ...project.scenes.map(scene => scene.narration_audio?.storage_key),
    ...collectMediaAssets(project).flatMap(asset => [asset.storage_key, asset.preview_storage_key]),
  ].filter((value): value is string => !!value))];
}

export async function readCloudProject(id: string): Promise<ProjectData | null> {
  const context = requireContext();
  const { data, error } = await context.client.from("great100_projects").select("id,owner_id,data,version").eq("id", id).eq("owner_id", context.userId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data) return null;
  const row = data as ProjectRow;
  versions.set(versionKey(context, id), row.version);
  savedProjects.set(versionKey(context, id), row.data);
  return rowProject(row);
}

export async function saveCloudRenderedVideo(project: ProjectData, blob: Blob, renderVersion: number): Promise<void> {
  const context = requireContext(project);
  const previous = await context.client.from("great100_exports").select("storage_key").eq("project_id", project.id).eq("owner_id", context.userId).maybeSingle();
  if (previous.error) throw databaseError(previous.error);
  const key = await uploadCloudFile(project.id, blob, context);
  const { error } = await context.client.from("great100_exports").upsert({
    project_id: project.id, owner_id: context.userId, storage_key: key, project_updated_at: project.updated_at, render_version: renderVersion,
  });
  if (error) {
    await mediaRequest(context, { operation: "delete", projectId: project.id, key }).catch(() => {});
    throw databaseError(error);
  }
  if (previous.data?.storage_key) await mediaRequest(context, { operation: "delete", projectId: project.id, key: previous.data.storage_key }).catch(() => {});
}

export async function getCloudRenderedVideo(project: ProjectData, renderVersion: number): Promise<Blob | null> {
  const context = requireContext(project);
  const { data, error } = await context.client.from("great100_exports").select("storage_key,project_updated_at,render_version").eq("project_id", project.id).eq("owner_id", context.userId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data || data.project_updated_at !== project.updated_at || data.render_version !== renderVersion) return null;
  return downloadCloudFile(project, data.storage_key);
}

export async function deleteCloudProject(project: ProjectData): Promise<void> {
  const context = requireContext(project);
  const pending = queues.get(versionKey(context, project.id));
  if (pending) await pending;
  await mediaRequest(context, { operation: "delete-project", projectId: project.id });
  const { error } = await context.client.from("great100_projects").delete().eq("id", project.id).eq("owner_id", context.userId);
  if (error) throw databaseError(error);
  versions.delete(versionKey(context, project.id));
}
