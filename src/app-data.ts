import { DEFAULT_STYLE } from "./parser";
import type { AppDataV2, ImageMotion, ProjectData, Scene, VisualAsset } from "./types";

export interface QualityReport {
  errors: string[];
  warnings: string[];
  metrics: { visualTypes: number; shotTypes: number; locations: number; withoutProtagonist: number; coreScenes: number; duration: number; sceneCount: number };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const textFields = (object: Record<string, unknown>, fields: string[], prefix: string, errors: string[]) => {
  for (const field of fields) if (!nonempty(object[field])) errors.push(`${prefix}.${field} 값이 없습니다.`);
};

export function extractAppData(input: string): unknown {
  const heading = /^##\s+APP_DATA\s*$/im.exec(input);
  if (!heading) throw new Error("'## APP_DATA' 섹션이 없습니다. v2 JSON을 포함한 Work 결과를 붙여넣거나 Legacy Import를 선택해 주세요.");
  const tail = input.slice(heading.index + heading[0].length).trim();
  const fenced = tail.match(/^```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const jsonText = fenced ? fenced[1] : tail;
  try { return JSON.parse(jsonText); }
  catch { throw new Error("APP_DATA JSON을 읽을 수 없습니다. 코드 블록과 쉼표·따옴표를 확인해 주세요."); }
}

export function validateAppData(value: unknown): QualityReport {
  const root = record(value);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (root.schema_version !== "2.0") errors.push('schema_version은 "2.0"이어야 합니다.');
  const person = record(root.person);
  textFields(person, ["name", "one_line_intro", "period"], "person", errors);
  const video = record(root.video);
  if (!number(video.target_duration_sec) || video.target_duration_sec <= 0) errors.push("video.target_duration_sec 값이 올바르지 않습니다.");
  textFields(video, ["concept"], "video", errors);
  const profile = record(root.character_profile);
  textFields(profile, ["age", "face", "eyes", "hair", "beard", "body", "outfit", "impression"], "character_profile", errors);
  const core = record(root.core_achievement);
  textFields(core, ["title", "scene_id", "visual_subject"], "core_achievement", errors);
  if (core.must_visualize !== true) errors.push("core_achievement.must_visualize는 true여야 합니다.");
  const ending = record(root.ending);
  textFields(ending, ["title", "message"], "ending", errors);
  const thumbnail = record(root.thumbnail);
  if (!Array.isArray(thumbnail.phrases) || !thumbnail.phrases.every(nonempty)) errors.push("thumbnail.phrases 값이 올바르지 않습니다.");
  if (!Array.isArray(thumbnail.prompts) || !thumbnail.prompts.length || !thumbnail.prompts.every(nonempty)) errors.push("thumbnail.prompts 값이 올바르지 않습니다.");
  if (!Number.isInteger(thumbnail.recommended_index) || (Array.isArray(thumbnail.prompts) && (thumbnail.recommended_index as number) >= thumbnail.prompts.length) || (thumbnail.recommended_index as number) < 0) errors.push("thumbnail.recommended_index 값이 올바르지 않습니다.");
  const youtube = record(root.youtube);
  if (!Array.isArray(youtube.titles) || !youtube.titles.length || !youtube.titles.every(nonempty)) errors.push("youtube.titles 값이 올바르지 않습니다.");
  if (!Number.isInteger(youtube.recommended_title_index) || (Array.isArray(youtube.titles) && (youtube.recommended_title_index as number) >= youtube.titles.length) || (youtube.recommended_title_index as number) < 0) errors.push("youtube.recommended_title_index 값이 올바르지 않습니다.");
  textFields(youtube, ["description"], "youtube", errors);
  if (!Array.isArray(youtube.hashtags) || !youtube.hashtags.every(nonempty)) errors.push("youtube.hashtags 값이 올바르지 않습니다.");
  const scenes = Array.isArray(root.scenes) ? root.scenes.map(record) : [];
  if (!scenes.length) errors.push("scenes가 비어 있습니다.");
  const fields = ["id", "narration", "scene_description", "visual_type", "shot_type", "location", "main_subject", "main_action", "image_prompt", "subtitle", "motion"];
  scenes.forEach((scene, index) => {
    const expected = `scene_${String(index + 1).padStart(2, "0")}`;
    if (scene.id !== expected) errors.push(`${expected}이 누락되었거나 순서가 잘못되었습니다.`);
    if (scene.order !== index + 1) errors.push(`${expected}의 order는 ${index + 1}이어야 합니다.`);
    textFields(scene, fields, expected, errors);
    if (!number(scene.start_sec) || !number(scene.end_sec) || (scene.start_sec as number) >= (scene.end_sec as number)) errors.push(`${expected}의 start_sec/end_sec가 잘못되었습니다.`);
    if (index && number(scene.start_sec) && number(scenes[index - 1].end_sec) && (scenes[index - 1].end_sec as number) > scene.start_sec) errors.push(`${expected}이 이전 Scene과 시간이 겹칩니다.`);
    if (!("support_image_prompt" in scene) || (scene.support_image_prompt !== null && typeof scene.support_image_prompt !== "string")) errors.push(`${expected}의 support_image_prompt는 문자열 또는 null이어야 합니다.`);
  });
  if (nonempty(core.scene_id)) {
    const target = scenes.find((scene) => scene.id === core.scene_id);
    if (!target || !nonempty(target.image_prompt) || !nonempty(target.visual_type)) errors.push(`핵심 업적 '${String(core.title || "")}'이 실제 이미지 Scene에 연결되지 않았습니다.`);
  }
  const unique = (field: string) => new Set(scenes.map((scene) => String(scene[field] || "").trim().toLocaleLowerCase()).filter(Boolean)).size;
  const name = String(person.name || "").replace(/\s/g, "");
  const withoutProtagonist = scenes.filter((scene) => {
    const subject = String(scene.main_subject || "").replace(/\s/g, "");
    const prompt = String(scene.image_prompt || "").replace(/\s/g, "");
    return !!name && !subject.includes(name) && !prompt.includes(name);
  }).length;
  const duration = number(scenes.at(-1)?.end_sec) ? scenes.at(-1)!.end_sec as number : 0;
  const metrics = { visualTypes: unique("visual_type"), shotTypes: unique("shot_type"), locations: unique("location"), withoutProtagonist, coreScenes: scenes.filter((scene) => scene.id === core.scene_id).length, duration, sceneCount: scenes.length };
  if (scenes.length < 14 || scenes.length > 18) warnings.push(`Scene이 ${scenes.length}개입니다. 권장 범위는 14~18개입니다.`);
  if (duration < 270 || duration > 300) warnings.push(`현재 영상 길이는 ${duration}초입니다. 권장 범위는 270~300초입니다.`);
  if (number(video.target_duration_sec) && (video.target_duration_sec < 270 || video.target_duration_sec > 300)) warnings.push(`목표 영상 길이는 ${video.target_duration_sec}초입니다. 권장 범위는 270~300초입니다.`);
  if (number(video.target_duration_sec) && Math.abs(duration - video.target_duration_sec) > 15) warnings.push(`마지막 Scene 종료 시간과 목표 길이(${video.target_duration_sec}초)가 15초 넘게 차이 납니다.`);
  if (metrics.visualTypes < 6) warnings.push(`visual_type이 ${metrics.visualTypes}종입니다. 6종 이상을 권장합니다.`);
  if (metrics.shotTypes < 5) warnings.push(`shot_type이 ${metrics.shotTypes}종입니다. 5종 이상을 권장합니다.`);
  if (metrics.locations < 4) warnings.push(`location이 ${metrics.locations}종입니다. 4종 이상을 권장합니다.`);
  if (withoutProtagonist < 3) warnings.push(`주인공 미등장 Scene이 ${withoutProtagonist}개입니다. 3개 이상을 권장합니다.`);
  const comparisonFields = ["visual_type", "shot_type", "location", "main_subject", "main_action"];
  scenes.slice(1).forEach((scene, index) => {
    const previous = scenes[index];
    const same = comparisonFields.filter((field) => nonempty(scene[field]) && String(scene[field]).trim().toLocaleLowerCase() === String(previous[field] || "").trim().toLocaleLowerCase());
    if (same.length >= 2) warnings.push(`Scene ${index + 1}과 Scene ${index + 2}가 시각적으로 유사합니다. 공통: ${same.map((field) => `${field}: ${scene[field]}`).join(", ")}`);
  });
  return { errors, warnings, metrics };
}

export function parseAppData(input: string): { data: AppDataV2; report: QualityReport } {
  const data = extractAppData(input);
  const report = validateAppData(data);
  return { data: data as AppDataV2, report };
}

const asset = (prompt: string): VisualAsset => ({ prompt, prompt_history: prompt ? [{ prompt, created_at: new Date().toISOString() }] : [], candidates: [], status: "idle" });
const imageMotion = (value: string): ImageMotion => {
  const key = value.trim().toLocaleLowerCase().replace(/_/g, "-");
  if (["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none", "auto"].includes(key)) return key as ImageMotion;
  if (/줌인/.test(value)) return "zoom-in";
  if (/줌아웃/.test(value)) return "zoom-out";
  if (/왼쪽/.test(value)) return "pan-left";
  if (/오른쪽/.test(value)) return "pan-right";
  return "auto";
};

export function createV2ProjectDraft(episode: number, category: string, sourceText: string, data: AppDataV2, report: QualityReport): ProjectData {
  const now = new Date().toISOString();
  const person = data.person.name.trim();
  const profile = data.character_profile;
  const description = [profile.age, profile.face, profile.eyes, profile.hair, profile.beard, profile.body, profile.outfit, profile.impression].join(", ");
  const scenes: Scene[] = data.scenes.map((source) => ({
    id: source.id, source_scene_id: source.id, number: source.order, title: source.subtitle,
    start_sec: source.start_sec, end_sec: source.end_sec, duration: source.end_sec - source.start_sec,
    narration: source.narration, scene_description: source.scene_description,
    visual_type: source.visual_type, shot_type: source.shot_type, location: source.location,
    main_subject: source.main_subject, main_action: source.main_action,
    support_image_prompt: source.support_image_prompt, overlay_required: source.overlay_required,
    support_prompt_history: source.support_image_prompt ? [{ prompt: source.support_image_prompt, created_at: now }] : [],
    overlay_type: source.overlay_type, overlay_note: source.overlay_note,
    caption: source.subtitle, motion: imageMotion(source.motion), prompt: source.image_prompt,
    prompt_history: [{ prompt: source.image_prompt, created_at: now }], candidates: [], status: "idle",
  }));
  return {
    schema_version: "2.0", id: crypto.randomUUID(), episode, person, category,
    folder_name: `${String(episode).padStart(3, "0")}_${person.replace(/[\\/:*?"<>|]/g, "_")}`,
    project_path: "", source_text: sourceText, source: data, style_guide: DEFAULT_STYLE,
    character_profile: { ...profile, clothing: profile.outfit, mood: profile.impression, description },
    anchor: asset(`${description}. 인물 얼굴 일관성을 위한 기준 이미지. 정면 또는 반신, 단순한 배경.`),
    scenes, thumbnail: asset(data.thumbnail.prompts[data.thumbnail.recommended_index]),
    ending_message: data.ending.message, created_at: now, updated_at: now,
    app_state: { warnings: report.warnings, selected_scene_images: {} },
  };
}

export function reportForProject(project: ProjectData): QualityReport {
  if (project.schema_version !== "2.0" || !project.source) return { errors: [], warnings: ["Legacy v1 프로젝트입니다. 기존 흐름으로 계속 사용할 수 있습니다."], metrics: { visualTypes: 0, shotTypes: 0, locations: 0, withoutProtagonist: 0, coreScenes: 0, duration: 0, sceneCount: project.scenes.length } };
  const data: AppDataV2 = { ...project.source, scenes: project.scenes.map((scene) => ({
    id: scene.source_scene_id || scene.id, order: scene.number, start_sec: scene.start_sec as number, end_sec: scene.end_sec as number,
    narration: scene.narration as string, scene_description: scene.scene_description as string,
    visual_type: scene.visual_type as string, shot_type: scene.shot_type as string, location: scene.location as string,
    main_subject: scene.main_subject as string, main_action: scene.main_action as string,
    image_prompt: scene.prompt, support_image_prompt: scene.support_image_prompt ?? null,
    subtitle: scene.caption as string, motion: scene.motion || "auto",
  })) };
  return validateAppData(data);
}

export function completionErrors(project: ProjectData): string[] {
  if (project.schema_version !== "2.0") return [];
  const errors = reportForProject(project).errors;
  for (const scene of project.scenes) if (!scene.selected_candidate_id) errors.push(`${scene.source_scene_id || scene.id} 메인 이미지가 선택되지 않았습니다.`);
  if (!project.thumbnail.selected_candidate_id) errors.push("썸네일 이미지가 선택되지 않았습니다.");
  return errors;
}
