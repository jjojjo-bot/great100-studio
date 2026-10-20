import type { ImageCandidate, MediaAsset, ProjectData, Scene, SceneComposition } from "./types";

export const candidateAssetId = (candidate: ImageCandidate) => `candidate:${candidate.id}`;
export const narrationAssetId = (scene: Scene) => scene.narration_audio ? scene.narration_audio.asset_id || `narration:${scene.narration_audio.id || scene.narration_audio.path}` : undefined;
export const musicAssetId = (project: ProjectData) => project.background_music ? project.background_music.asset_id || `music:${project.background_music.id || project.background_music.path}` : undefined;
export const allCandidates = (project: ProjectData) => [project.anchor, project.thumbnail, ...project.scenes].flatMap(asset => asset.candidates)
  .concat(project.scenes.flatMap(scene => scene.support_candidates || []));

function imageMime(candidate: ImageCandidate) {
  const extension = candidate.path.split(".").at(-1)?.toLowerCase();
  return candidate.preview_url.match(/^data:([^;,]+)/)?.[1] || ({ png: "image/png", webp: "image/webp", svg: "image/svg+xml" }[extension || ""] ?? "image/jpeg");
}

export function collectMediaAssets(project: ProjectData): MediaAsset[] {
  const assets = new Map((project.media?.assets || []).map(asset => [asset.id, { ...asset }]));
  const add = (asset: MediaAsset) => {
    const previous = assets.get(asset.id);
    if (previous && (previous.path !== asset.path || previous.kind !== asset.kind)) throw new Error("같은 자료 ID의 원본 위치가 변경되었습니다. 최신 작업을 다시 열어 주세요.");
    assets.set(asset.id, { ...previous, ...asset, storage_key: asset.storage_key || previous?.storage_key,
      preview_storage_key: asset.preview_storage_key || previous?.preview_storage_key, inline_data: asset.storage_key || previous?.storage_key ? undefined : asset.inline_data || previous?.inline_data,
      local_store: previous?.local_store || asset.local_store, local_key: previous?.local_key || asset.local_key });
  };
  for (const candidate of allCandidates(project)) add({ id: candidateAssetId(candidate), kind: candidate.media_type === "video" ? "video" : "image",
    path: candidate.path, mime_type: candidate.media_type === "video" ? "video/mp4" : imageMime(candidate), duration_sec: candidate.duration_sec,
    storage_key: candidate.storage_key, preview_storage_key: candidate.preview_storage_key,
    inline_data: candidate.media_type !== "video" && candidate.preview_url.startsWith("data:image/") ? candidate.preview_url : undefined,
    preview_inline_data: candidate.media_type === "video" && candidate.preview_url.startsWith("data:image/") ? candidate.preview_url : undefined,
    ...(candidate.media_type === "video" ? { local_store: "media" as const, local_key: `${project.id}:scene-video:${candidate.id}` } : {}) });
  for (const scene of project.scenes) {
    const voice = scene.narration_audio;
    if (voice) add({ id: narrationAssetId(scene)!, kind: "audio", path: voice.path, mime_type: voice.mime_type, duration_sec: voice.duration_sec,
      storage_key: voice.storage_key, generation: voice.generation, local_store: "audio", local_key: `${project.id}:narration:${scene.id}${voice.id ? `:${voice.id}` : ""}` });
  }
  const music = project.background_music;
  if (music) add({ id: musicAssetId(project)!, kind: "audio", path: music.path, mime_type: music.mime_type, storage_key: music.storage_key,
    local_store: "audio", local_key: music.id ? `${project.id}:music:${music.id}` : project.id });
  return [...assets.values()];
}

export function sceneTiming(scene: Scene, videoDuration?: number, hasIntro = false, hasSupport = false) {
  const duration = scene.duration ?? 10;
  const intro = hasIntro ? Math.max(0, Math.min(duration - 0.1, scene.video_intro_duration_sec ?? Math.min(1.5, duration / 4))) : 0;
  const trimStart = Math.max(0, Math.min(Math.max(0, (videoDuration ?? duration) - 0.1), scene.video_trim_start_sec ?? 0));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(videoDuration ?? duration, scene.video_trim_end_sec ?? (videoDuration ?? duration)));
  const supportStart = hasSupport ? Math.max(0, Math.min(duration - 0.1, scene.support_start_sec ?? duration / 2)) : undefined;
  return { intro, trimStart, trimEnd, supportStart };
}

export function resolveVideoIntroImage(scene: Scene): ImageCandidate | undefined {
  if (scene.video_intro_candidate_id === null) return undefined;
  if (scene.video_intro_candidate_id) return scene.candidates.find(candidate => candidate.id === scene.video_intro_candidate_id && candidate.media_type !== "video");
  return scene.candidates.filter(candidate => candidate.mode === "uploaded" && candidate.media_type !== "video").at(-1);
}

export function compositionSignature(scene: Scene): string {
  return JSON.stringify([scene.duration ?? 10, scene.selected_candidate_id, scene.support_selected_candidate_id, scene.video_intro_candidate_id,
    scene.video_intro_duration_sec, scene.video_trim_start_sec, scene.video_trim_end_sec, scene.support_start_sec, scene.motion,
    scene.narration_audio && [narrationAssetId(scene), scene.narration_audio.duration_sec],
    scene.candidates.filter(item => item.id === scene.selected_candidate_id).map(item => [item.id, item.media_type, item.duration_sec]), resolveVideoIntroImage(scene)?.id]);
}

export function sceneComposition(scene: Scene): SceneComposition {
  if (scene.composition && (!Array.isArray(scene.composition.visuals) || !Array.isArray(scene.composition.narrations))) throw new Error("장면의 자료 구간 구성이 잘못되었습니다.");
  const signature = compositionSignature(scene);
  const presentationChanged = scene.composition?.visuals.some(section => section.presentation) && (scene.composition.controls?.subtitle !== scene.subtitle || scene.composition.controls?.music_volume !== scene.music_volume);
  if (scene.composition?.source_signature === signature && !presentationChanged) return scene.composition;
  if (scene.composition?.mode === "segments") return updateBoundComposition(scene);
  if (scene.composition && (scene.composition.visuals.length > 1 || scene.composition.narrations.length > 1)) {
    throw new Error("여러 구간으로 구성된 장면은 구간 편집으로 수정해 주세요.");
  }
  const main = scene.candidates.find(candidate => candidate.id === scene.selected_candidate_id);
  const support = scene.support_candidates?.find(candidate => candidate.id === scene.support_selected_candidate_id);
  const intro = main?.media_type === "video" ? resolveVideoIntroImage(scene) : undefined;
  const duration = scene.duration ?? 10;
  const timing = sceneTiming(scene, main?.duration_sec, !!intro, !!support);
  const voice = scene.narration_audio;
  return { ...scene.composition, source_signature: signature, visuals: main ? [{ ...scene.composition?.visuals.find(section => section.asset_id === candidateAssetId(main)), id: `${scene.id}:visual`, start_sec: 0, end_sec: duration, asset_id: candidateAssetId(main),
    source_start_sec: main.media_type === "video" ? timing.trimStart : 0, source_end_sec: main.media_type === "video" ? timing.trimEnd : undefined,
    intro_asset_id: intro ? candidateAssetId(intro) : undefined, intro_duration_sec: intro ? timing.intro : undefined,
    support_asset_id: support ? candidateAssetId(support) : undefined, support_start_sec: timing.supportStart, motion: scene.motion }] : [],
    narrations: voice ? [{ ...scene.composition?.narrations.find(clip => clip.asset_id === narrationAssetId(scene)), id: `${scene.id}:voice`, asset_id: narrationAssetId(scene)!, start_sec: 0, end_sec: Math.min(duration, voice.duration_sec),
      source_start_sec: 0, source_end_sec: Math.min(duration, voice.duration_sec) }] : [] };
}

export const compositionControls = (scene: Scene): NonNullable<SceneComposition["controls"]> => ({ duration: scene.duration ?? 10,
  selected: scene.selected_candidate_id, support: scene.support_selected_candidate_id, motion: scene.motion,
  narration: narrationAssetId(scene), narration_duration: scene.narration_audio?.duration_sec, subtitle: scene.subtitle, music_volume: scene.music_volume });

export function bindComposition(scene: Scene, composition: SceneComposition): SceneComposition {
  return { ...composition, mode: "segments", controls: compositionControls(scene), source_signature: compositionSignature(scene) };
}

// Review a visual choice against the same scene after asynchronous work. Scene
// numbering and unrelated text edits do not invalidate the reviewed screen.
export function visualSelectionFingerprint(scene: Scene): string {
  return JSON.stringify([scene.selected_candidate_id, scene.duration, scene.split_origin, scene.merge_origin, sceneComposition(scene).visuals]);
}

export function cropComposition(composition: SceneComposition, from: number, to: number, clock = (time: number) => time): SceneComposition {
  return { ...composition, visuals: composition.visuals.filter(section => section.end_sec > from && section.start_sec < to).map(section => {
    const start = Math.max(from, section.start_sec); const end = Math.min(to, section.end_sec);
    return { ...section, start_sec: Math.round((start - from) * 1000) / 1000, end_sec: Math.round((end - from) * 1000) / 1000,
      presentation_duration_sec: section.presentation_duration_sec ?? section.end_sec - section.start_sec,
      presentation: section.presentation ? { ...section.presentation, emphasis_offset_sec: section.presentation.emphasis_offset_sec + clock(start) - clock(section.start_sec) } : undefined,
      playback_offset_sec: (section.playback_offset_sec ?? 0) + clock(start) - clock(section.start_sec) };
  }), narrations: composition.narrations.filter(clip => clip.end_sec > from && clip.start_sec < to).map(clip => {
    const start = Math.max(from, clip.start_sec); const end = Math.min(to, clip.end_sec);
    return { ...clip, start_sec: Math.round((start - from) * 1000) / 1000, end_sec: Math.round((end - from) * 1000) / 1000,
      timeline_offset_sec: (clip.timeline_offset_sec ?? 0) + from - clock(from),
      playback_end_sec: clip.playback_end_sec === undefined ? undefined : Math.max(0, Math.min(clip.playback_end_sec, clock(to)) - clock(from)),
      source_start_sec: clip.source_start_sec + start - clip.start_sec, source_end_sec: clip.source_start_sec + end - clip.start_sec };
  }) };
}

function updateBoundComposition(scene: Scene): SceneComposition {
  let composition = structuredClone(scene.composition!);
  const previous = composition.controls;
  if (!previous) throw new Error("나눈 장면의 편집 기준을 찾지 못했습니다. 최신 작업을 다시 열어 주세요.");
  const current = compositionControls(scene);
  if (current.duration !== previous.duration) {
    if (current.duration < previous.duration) composition = cropComposition(composition, 0, current.duration);
    else if (composition.visuals.length) {
      const last = composition.visuals.at(-1)!;
      last.end_sec = current.duration;
      last.presentation_duration_sec = Math.max(last.presentation_duration_sec ?? previous.duration, (last.playback_offset_sec ?? 0) + last.end_sec - last.start_sec);
    }
  }
  if (current.selected !== previous.selected) {
    const fresh = { ...scene, composition: undefined, video_intro_candidate_id: null, video_intro_duration_sec: 0, video_trim_start_sec: 0, video_trim_end_sec: undefined };
    composition.visuals = sceneComposition(fresh).visuals;
  }
  if (current.support !== previous.support) {
    const support = scene.support_candidates?.find(candidate => candidate.id === current.support);
    for (const section of composition.visuals) {
      section.support_asset_id = support ? candidateAssetId(support) : undefined;
      section.support_start_sec = support ? (section.playback_offset_sec ?? 0) + (section.end_sec - section.start_sec) / 2 : undefined;
    }
  }
  if (current.motion !== previous.motion) for (const section of composition.visuals) section.motion = current.motion;
  for (const section of composition.visuals) if (section.presentation) {
    if (current.subtitle !== previous.subtitle) section.presentation.subtitle = scene.subtitle || "";
    if (current.music_volume !== previous.music_volume) section.presentation.music_volume = scene.music_volume ?? 45;
  }
  if (current.narration !== previous.narration || current.narration_duration !== previous.narration_duration || (current.duration !== previous.duration && scene.narration_audio)) {
    const duration = Math.min(scene.duration ?? 10, scene.narration_audio?.duration_sec ?? 0);
    composition.narrations = current.narration && duration > 0 ? [{ id: `${scene.id}:voice`, asset_id: current.narration, start_sec: 0, end_sec: duration, source_start_sec: 0, source_end_sec: duration }] : [];
  }
  return bindComposition(scene, composition);
}

// Register old as well as new references before removing anything from a scene.
// This project-lifetime retention also covers history which is not persisted.
export function prepareMediaProject(project: ProjectData, previous?: ProjectData): ProjectData {
  const retained = previous ? collectMediaAssets(previous) : [];
  const combined = new Map(retained.map(asset => [asset.id, asset]));
  for (const asset of project.media?.assets || []) {
    const old = combined.get(asset.id);
    combined.set(asset.id, { ...old, ...asset, storage_key: asset.storage_key || old?.storage_key, preview_storage_key: asset.preview_storage_key || old?.preview_storage_key });
  }
  const assets = collectMediaAssets({ ...project, media: { assets: [...combined.values()] } });
  if (!assets.length && !project.media) return project;
  return { ...project, editor_version: Math.max(3, project.editor_version ?? 0), media: { ...project.media, assets },
    background_music: project.background_music ? { ...project.background_music, asset_id: musicAssetId(project) } : undefined,
    scenes: project.scenes.map(scene => ({ ...scene, narration_audio: scene.narration_audio ? { ...scene.narration_audio, asset_id: narrationAssetId(scene) } : undefined, composition: sceneComposition(scene) })) };
}

export function mediaCompositionErrors(project: ProjectData): string[] {
  const errors: string[] = [];
  if (project.media && (!Array.isArray(project.media.assets) || project.media.assets.some(asset => !asset || typeof asset !== "object"))) return ["원본 자료 목록이 잘못되었습니다."];
  const ids = new Set<string>();
  let assets: MediaAsset[];
  try { assets = collectMediaAssets(project); } catch (error) { return [(error as Error).message]; }
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  for (const asset of project.media?.assets || []) {
    if (!asset.id || ids.has(asset.id)) errors.push("자료 ID가 없거나 중복되었습니다.");
    ids.add(asset.id);
    if (!asset.path || !["image", "video", "audio"].includes(asset.kind) || !asset.mime_type) errors.push("원본 자료 정보가 잘못되었습니다.");
  }
  for (const scene of project.scenes) {
    let composition: SceneComposition;
    try { composition = sceneComposition(scene); } catch (error) { errors.push((error as Error).message); continue; }
    const duration = scene.duration ?? 10;
    const clipIds = new Set<string>();
    const validRange = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + 0.000001;
    let cursor = 0;
    for (const section of composition.visuals) {
      const asset = byId.get(section.asset_id);
      if (!section.id || clipIds.has(section.id) || !validRange(section.start_sec, section.end_sec) || Math.abs(section.start_sec - cursor) > 0.000001
        || !asset || !["image", "video"].includes(asset.kind)) errors.push(`Scene ${scene.number}의 화면 구간 또는 원본 연결이 잘못되었습니다.`);
      clipIds.add(section.id); cursor = section.end_sec;
      if (!Number.isFinite(section.source_start_sec) || section.source_start_sec < 0 || (asset?.kind === "video" && (!Number.isFinite(section.source_end_sec)
        || section.source_end_sec! <= section.source_start_sec || section.source_end_sec! > (asset.duration_sec ?? Infinity) + 0.001))) errors.push(`Scene ${scene.number}의 동영상 원본 구간이 잘못되었습니다.`);
      for (const id of [section.intro_asset_id, section.support_asset_id]) if (id && byId.get(id)?.kind !== "image") errors.push(`Scene ${scene.number}의 보조 화면 원본을 찾지 못했습니다.`);
      const presentation = section.presentation_duration_sec ?? section.end_sec - section.start_sec;
      const offset = section.playback_offset_sec ?? 0;
      if (!Number.isFinite(presentation) || presentation <= 0 || !Number.isFinite(offset) || offset < 0 || offset + section.end_sec - section.start_sec > presentation + 2 / 15 + 0.001) errors.push(`Scene ${scene.number}의 원본 재생 위치가 잘못되었습니다.`);
      if (section.presentation && (typeof section.presentation.title !== "string" || typeof section.presentation.subtitle !== "string" || !Number.isFinite(section.presentation.emphasis_offset_sec) || section.presentation.emphasis_offset_sec < 0 || !Number.isFinite(section.presentation.music_volume) || section.presentation.music_volume < 0 || section.presentation.music_volume > 100)) errors.push(`Scene ${scene.number}의 구간별 강조 자막·음악 설정이 잘못되었습니다.`);
      if (section.intro_asset_id && (!Number.isFinite(section.intro_duration_sec) || section.intro_duration_sec! < 0 || section.intro_duration_sec! >= presentation)) errors.push(`Scene ${scene.number}의 앞 이미지 구간이 잘못되었습니다.`);
      if (section.support_asset_id && (!Number.isFinite(section.support_start_sec) || section.support_start_sec! < 0 || section.support_start_sec! >= presentation)) errors.push(`Scene ${scene.number}의 보조 이미지 구간이 잘못되었습니다.`);
    }
    if (composition.visuals.length && Math.abs(cursor - duration) > 0.000001) errors.push(`Scene ${scene.number}의 화면 구간이 장면 길이와 다릅니다.`);
    let voiceEnd = 0;
    for (const clip of composition.narrations) {
      const asset = byId.get(clip.asset_id);
      if (!clip.id || clipIds.has(clip.id) || asset?.kind !== "audio" || !validRange(clip.start_sec, clip.end_sec) || clip.start_sec < voiceEnd
        || !Number.isFinite(clip.timeline_offset_sec ?? 0) || Math.abs(clip.timeline_offset_sec ?? 0) > 2 / 15 + 0.001
        || (clip.playback_end_sec !== undefined && (!Number.isFinite(clip.playback_end_sec) || clip.playback_end_sec < 0 || clip.playback_end_sec > duration + 2 / 15 + 0.001))
        || !Number.isFinite(clip.source_start_sec) || !Number.isFinite(clip.source_end_sec) || clip.source_start_sec < 0 || clip.source_end_sec <= clip.source_start_sec
        || clip.source_end_sec > (asset?.duration_sec ?? Infinity) + 0.001 || Math.abs(clip.end_sec - clip.start_sec - (clip.source_end_sec - clip.source_start_sec)) > 0.001) errors.push(`Scene ${scene.number}의 녹음 구간 또는 원본 연결이 잘못되었습니다.`);
      clipIds.add(clip.id); voiceEnd = clip.end_sec;
    }
  }
  return errors;
}
