import type { NarrationGeneration, NarrationPace, ProjectData, Scene, SceneNarrationAudio } from "./types";
import { cloudAccessToken, getCloudSession } from "./cloud-session";
import { proposeNarrationTiming, timingFingerprint, type CaptionTimingMode } from "./timeline";
import { narrationAssetId, sceneComposition } from "./media-composition";

export const NARRATION_VOICES = ["alloy", "ash", "coral", "echo", "sage", "shimmer", "verse"] as const;
export const NARRATION_PACES: { value: NarrationPace; label: string }[] = [{ value: "slow", label: "느리게" }, { value: "normal", label: "보통" }, { value: "fast", label: "빠르게" }];
export const MAX_NARRATION_CHARACTERS = 1800;
export const narrationScript = (scene: Scene) => (scene.captions?.length ? scene.captions.map(block => block.text).join(" ") : scene.narration ?? scene.caption ?? "").trim();
export const sameNarrationText = (a: string, b: string) => a.normalize("NFKC").replace(/\s+/gu, " ").trim() === b.normalize("NFKC").replace(/\s+/gu, " ").trim();
export const narrationSelectionFingerprint = (project: ProjectData, scene: Scene) => JSON.stringify([project.id, scene.id, narrationScript(scene),
  scene.narration_audio && [narrationAssetId(scene), scene.narration_audio.path, scene.narration_audio.storage_key, scene.narration_audio.duration_sec], sceneComposition(scene).narrations, scene.split_origin, scene.merge_origin]);
export const generatedApplyFingerprint = (project: ProjectData, scene: Scene) => JSON.stringify([narrationSelectionFingerprint(project, scene), timingFingerprint(project)]);

export interface GeneratedNarrationRequest {
  projectId: string; sceneId: string; expected: string; narration: SceneNarrationAudio;
  adjustDuration: boolean; mode: CaptionTimingMode;
}

// Revalidate in the root callback after file storage: a React render can lag a
// synchronous caption edit, scene operation, or newly selected recording.
export function applyGeneratedNarration(project: ProjectData, request: GeneratedNarrationRequest): ProjectData {
  const scene = project.scenes.find(item => item.id === request.sceneId);
  if (project.id !== request.projectId || !scene || generatedApplyFingerprint(project, scene) !== request.expected
    || !request.narration.generation || !sameNarrationText(narrationScript(scene), request.narration.generation.input_text)) {
    throw new Error("대본·시간·녹음이 변경되었습니다. 최신 내용을 확인한 뒤 다시 적용해 주세요.");
  }
  const next = request.adjustDuration ? proposeNarrationTiming(project, scene.id, request.narration.duration_sec, request.mode).project : project;
  const target = next.scenes.find(item => item.id === scene.id)!;
  if (request.narration.duration_sec > (target.duration ?? 10) + 0.000001) throw new Error("생성한 음성이 장면보다 깁니다. 음성 길이에 맞추기를 선택해 주세요.");
  return { ...next, scenes: next.scenes.map(item => item.id === scene.id ? { ...item, narration_audio: request.narration } : item) };
}

export async function generateSceneNarration(project: ProjectData, scene: Scene, voice: string, pace: NarrationPace, signal: AbortSignal): Promise<{ file: File; generation: NarrationGeneration }> {
  const context = getCloudSession();
  if (!context || project.cloud_owner_id && project.cloud_owner_id !== context.userId) throw new Error("AI 내레이션은 로그인한 웹에서 사용할 수 있습니다.");
  const text = narrationScript(scene);
  if (!text || text.length > MAX_NARRATION_CHARACTERS) throw new Error(`내레이션 대본은 1~${MAX_NARRATION_CHARACTERS}자로 입력해 주세요.`);
  const token = await cloudAccessToken(context);
  const requestId = crypto.randomUUID();
  const response = await fetch("/api/narration", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, voice, pace, request_id: requestId }), signal });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "AI 내레이션을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (getCloudSession()?.userId !== context.userId) throw new Error("로그인한 계정이 바뀌었습니다. 작업을 다시 열어 주세요.");
  if (typeof result.audio_base64 !== "string" || !result.audio_base64.length || result.audio_base64.length > 4_000_000
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.audio_base64) || result.generation?.input_text !== text
    || result.generation?.voice !== voice || result.generation?.pace !== pace || result.generation?.request_id !== requestId
    || result.generation?.provider !== "openai" || typeof result.generation?.model !== "string" || typeof result.generation?.transcript !== "string"
    || typeof result.generation?.created_at !== "string" || result.mime_type !== "audio/mpeg") throw new Error("생성한 음성 응답이 올바르지 않습니다.");
  const bytes = Uint8Array.from(atob(result.audio_base64), char => char.charCodeAt(0));
  return { file: new File([bytes], `scene${String(scene.number).padStart(2, "0")}_ai.mp3`, { type: "audio/mpeg" }), generation: result.generation };
}
