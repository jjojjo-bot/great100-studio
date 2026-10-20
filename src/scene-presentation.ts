import { sceneComposition } from "./media-composition";
import { milliseconds, OPENING_DURATION, projectTimeline, VIDEO_FPS } from "./timeline";
import { resolveImageMotion, sceneMusicVolume } from "./video";
import type { ProjectData, Scene } from "./types";

// Capture the current frame clock before a structural edit changes scene bounds.
export function captureSceneComposition(project: ProjectData, scene: Scene, index: number, presentation = false) {
  const entry = projectTimeline(project).scenes.find(item => item.scene.id === scene.id)!;
  const clock = (seconds: number) => (Math.round((entry.startMs + milliseconds(seconds)) * VIDEO_FPS / 1000) - entry.startFrame) / VIDEO_FPS;
  const composition = structuredClone(sceneComposition(scene));
  composition.visuals = composition.visuals.map((section, sectionIndex) => {
    const duration = clock(section.end_sec) - clock(section.start_sec);
    const first = index === 0 && sectionIndex === 0 && composition.mode !== "segments";
    return { ...section, motion: resolveImageMotion(section.motion, index),
      intro_duration_sec: composition.mode === "segments" || !section.intro_asset_id ? section.intro_duration_sec : Math.min(duration - 1 / VIDEO_FPS, clock(section.start_sec + (section.intro_duration_sec ?? 0)) - clock(section.start_sec)),
      support_start_sec: composition.mode === "segments" || section.support_start_sec === undefined ? section.support_start_sec : clock(section.start_sec + section.support_start_sec) - clock(section.start_sec),
      presentation_duration_sec: section.presentation_duration_sec ?? duration,
      playback_offset_sec: section.playback_offset_sec ?? 0,
      motion_start: first ? OPENING_DURATION / (OPENING_DURATION + duration) : section.motion_start,
      ...(presentation ? { presentation: section.presentation || { title: scene.title, subtitle: scene.subtitle || "", emphasis_offset_sec: (scene.emphasis_offset_sec ?? 0) + section.start_sec, music_volume: sceneMusicVolume(scene.music_volume) } } : {}),
    };
  });
  return { composition, clock, entry };
}
