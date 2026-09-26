import { resolveVideoIntroImage, sceneTiming } from "./video";
import type { Scene } from "./types";

export function SceneTimingPanel({ scene, onChange }: { scene: Scene; onChange: (scene: Scene) => void }) {
  const selected = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
  const video = selected?.media_type === "video" ? selected : undefined;
  const intro = !!video && !!resolveVideoIntroImage(scene);
  const support = !!scene.support_candidates?.some((candidate) => candidate.id === scene.support_selected_candidate_id);
  if (!video && !support) return null;
  const duration = scene.duration ?? 10;
  const timing = sceneTiming(scene, video?.duration_sec, intro, support);
  const slider = (label: string, value: number, min: number, max: number, set: (value: number) => void) => <label className="timing-control"><span>{label} <b>{value.toFixed(1)}초</b></span><input aria-label={label} type="range" min={min} max={Math.max(min, max)} step="0.1" value={value} onChange={(event) => set(Number(event.target.value))} /></label>;
  return <div className="panel scene-timing-panel"><div><strong>장면 시간 조절</strong><small>전체 {duration.toFixed(1)}초 안에서 화면 전환을 조절합니다. 동영상 원본 소리는 사용하지 않습니다.</small></div>
    <div className="timing-strip" aria-label="장면 시간 구성"><span style={{ width: `${timing.intro / duration * 100}%` }}>이미지</span><span style={{ width: `${(duration - timing.intro) / duration * 100}%` }}>{video ? "동영상" : "주 이미지"}</span>{support && <i style={{ left: `${(timing.supportStart ?? 0) / duration * 100}%` }} title="보조 이미지 시작" />}</div>
    {video && intro && slider("이미지에서 동영상으로 전환", timing.intro, 0, duration - 0.1, (value) => onChange({ ...scene, video_intro_duration_sec: value }))}
    {video && <div className="timing-trim"><small>원본 동영상에서 사용할 구간 · 이후는 마지막 화면을 유지합니다</small>{slider("원본 시작", timing.trimStart, 0, timing.trimEnd - 0.1, (value) => onChange({ ...scene, video_trim_start_sec: value }))}{slider("원본 끝", timing.trimEnd, timing.trimStart + 0.1, video.duration_sec ?? duration, (value) => onChange({ ...scene, video_trim_end_sec: value }))}</div>}
    {support && slider("보조 이미지 전환", timing.supportStart ?? duration / 2, 0, duration - 0.1, (value) => onChange({ ...scene, support_start_sec: value }))}
  </div>;
}
