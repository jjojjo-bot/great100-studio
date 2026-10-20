import { sceneComposition } from "./media-composition";
import { OPENING_DURATION, projectTimeline, VIDEO_FPS } from "./timeline";
import type { AudioClip, ProjectData } from "./types";

export interface NarrationPlacement extends AudioClip { scene_id: string }

// A split voice keeps a common source clock across adjacent scenes. Joining its
// continuous windows before frame clipping prevents a new fade or silent gap
// at a caption boundary which lies between two video frames.
export function narrationTimeline(project: ProjectData, sceneId?: string): NarrationPlacement[] {
  const entries = projectTimeline(project).scenes.filter(entry => !sceneId || entry.scene.id === sceneId);
  const tracks: Array<NarrationPlacement & { limit: number }> = [];
  for (const entry of entries) {
    const origin = sceneId ? 0 : OPENING_DURATION + entry.start;
    for (const clip of sceneComposition(entry.scene).narrations) {
      const next = { ...clip, id: `${entry.scene.id}:${clip.id}`, scene_id: entry.scene.id,
        start_sec: origin + clip.start_sec + (clip.timeline_offset_sec ?? 0), end_sec: origin + clip.end_sec + (clip.timeline_offset_sec ?? 0), limit: origin + Math.min(entry.duration, clip.playback_end_sec ?? entry.duration) };
      const previous = tracks.at(-1);
      if (previous && clip.continuity_id && previous.continuity_id === clip.continuity_id && previous.asset_id === clip.asset_id
        && Math.abs(previous.source_end_sec - clip.source_start_sec) < 0.00001 && Math.abs(previous.end_sec - next.start_sec) <= 1 / VIDEO_FPS + 0.001) {
        previous.source_end_sec = next.source_end_sec;
        previous.end_sec = previous.start_sec + previous.source_end_sec - previous.source_start_sec;
        previous.limit = next.limit;
      } else tracks.push(next);
    }
  }
  return tracks.map(({ limit, ...track }) => {
    const end = Math.min(track.end_sec, limit);
    return { ...track, end_sec: end, source_end_sec: track.source_start_sec + end - track.start_sec };
  }).filter(track => track.end_sec > track.start_sec);
}
