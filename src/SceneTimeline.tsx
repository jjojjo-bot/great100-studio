import { useEffect, useRef, useState } from "react";
import { CaptionWaveform, resetCaptionTiming } from "./CaptionWaveform";
import { FullVideoPreview } from "./FullVideoPreview";
import { getSceneNarration } from "./platform";
import { resolveVideoIntroImage, sceneTiming } from "./video";
import type { ProjectData, Scene } from "./types";

export type TimelineSection = { label: string; kind: "image" | "video" | "hold"; start: number; end: number };

export function sceneVisualSections(scene: Scene): TimelineSection[] {
  const duration = Math.max(0.1, scene.duration ?? 10);
  const selected = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
  if (!selected) return [];
  if (selected.media_type !== "video") return [{ label: "이미지", kind: "image", start: 0, end: duration }];
  const intro = resolveVideoIntroImage(scene);
  const timing = sceneTiming(scene, selected.duration_sec, !!intro, !!scene.support_selected_candidate_id);
  const videoEnd = Math.min(duration, timing.intro + timing.trimEnd - timing.trimStart);
  const sections: TimelineSection[] = [];
  if (timing.intro > 0) sections.push({ label: "이미지", kind: "image", start: 0, end: timing.intro });
  if (videoEnd > timing.intro) sections.push({ label: "동영상", kind: "video", start: timing.intro, end: videoEnd });
  if (videoEnd < duration) sections.push({ label: "마지막 화면", kind: "hold", start: videoEnd, end: duration });
  return sections;
}

const percent = (time: number, duration: number) => `${Math.max(0, Math.min(100, time / duration * 100))}%`;

export function ScenePreviewPane({ project, scene, onChange }: { project: ProjectData; scene: Scene; onChange: (scene: Scene) => void }) {
  const [position, setPosition] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ id: number; time: number }>();
  const [narrationBlob, setNarrationBlob] = useState<Blob | null>(null);
  const seekId = useRef(0);
  const duration = Math.max(0.1, scene.duration ?? 10);
  const sections = sceneVisualSections(scene);
  const sourceCaptions = project.source?.scenes.find((item) => item.id === (scene.source_scene_id || scene.id))?.captions;
  const canReset = !!sourceCaptions && sourceCaptions.length === scene.captions?.length && scene.captions.some((block, index) => block.start_sec !== sourceCaptions[index].start_sec || block.end_sec !== sourceCaptions[index].end_sec);
  const seek = (time: number) => setSeekRequest({ id: ++seekId.current, time: Math.max(0, Math.min(duration, time)) });

  useEffect(() => {
    let active = true;
    if (!scene.narration_audio) { setNarrationBlob(null); return; }
    void getSceneNarration(project, scene).then((blob) => { if (active) setNarrationBlob(blob); }).catch(() => { if (active) setNarrationBlob(null); });
    return () => { active = false; };
  }, [project.id, scene.id, scene.narration_audio?.path]);

  return <div className="scene-workspace-preview">
    {scene.selected_candidate_id ? <FullVideoPreview project={project} sceneId={scene.id} seekRequest={seekRequest} onPositionChange={setPosition} /> : <div className="panel scene-preview-empty"><strong>이 장면의 미리보기</strong><p>이미지나 동영상을 선택하면 이곳에서 자막과 화면을 확인할 수 있습니다.</p></div>}
    <div className="panel scene-timeline">
      <div className="scene-timeline-head"><div><strong>장면 시간축</strong><small>막대나 눈금을 누르면 미리보기가 그 시점으로 이동합니다.</small></div><span>{position.toFixed(1)} / {duration.toFixed(1)}초</span></div>
      <div className="scene-timeline-row scene-timeline-ruler"><span>시간</span><div role="button" tabIndex={0} aria-label="장면 시간축에서 이동" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); seek((event.clientX - box.left) / box.width * duration); }} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); seek(position + (event.key === "ArrowRight" ? 0.5 : -0.5)); } }}><i style={{ left: percent(position, duration) }} />{[0, 0.25, 0.5, 0.75, 1].map((fraction) => <em key={fraction} style={{ left: percent(fraction * duration, duration) }}>{(fraction * duration).toFixed(1)}</em>)}</div></div>
      <div className="scene-timeline-row"><span>화면</span><div className="scene-timeline-track visual">{sections.map((section) => <button key={`${section.kind}-${section.start}`} className={`timeline-section ${section.kind}`} style={{ left: percent(section.start, duration), width: percent(section.end - section.start, duration) }} title={`${section.label} · ${section.start.toFixed(1)}–${section.end.toFixed(1)}초`} onClick={() => seek(section.start)}>{section.label}</button>)}{!sections.length && <small>화면 미선택</small>}<i className="timeline-playhead" style={{ left: percent(position, duration) }} /></div></div>
      {scene.support_selected_candidate_id && <div className="scene-timeline-row"><span>보조</span><div className="scene-timeline-track support"><button className="timeline-section support" style={{ left: percent(sceneTiming(scene, undefined, false, true).supportStart ?? duration / 2, duration), right: 0 }} onClick={() => seek(sceneTiming(scene, undefined, false, true).supportStart ?? duration / 2)}>보조 이미지</button><i className="timeline-playhead" style={{ left: percent(position, duration) }} /></div></div>}
      <div className="scene-timeline-row"><span>자막</span>{project.schema_version === "2.1" ? <CaptionWaveform embedded blob={narrationBlob} scene={scene} originalCaptions={sourceCaptions} onChange={onChange} playhead={position} onSelectCaption={seek} /> : <div className="scene-timeline-track captions"><button className="timeline-section caption" style={{ left: 0, width: "100%" }} onClick={() => seek(0)}>{scene.caption?.trim() ? "장면 자막" : "자막 없음"}</button><i className="timeline-playhead" style={{ left: percent(position, duration) }} /></div>}</div>
      <div className="scene-timeline-row"><span>녹음</span><div className="scene-timeline-track audio">{scene.narration_audio ? <button className="timeline-section narration" style={{ left: 0, width: percent(Math.min(duration, scene.narration_audio.duration_sec), duration) }} onClick={() => seek(0)}>내레이션</button> : <small>녹음 없음</small>}<i className="timeline-playhead" style={{ left: percent(position, duration) }} /></div></div>
      <div className="scene-timeline-row"><span>음악</span><div className="scene-timeline-track audio">{project.background_music ? <button className="timeline-section music" style={{ left: 0, width: "100%" }} onClick={() => seek(0)}>배경음악 {scene.music_volume ?? 45}%</button> : <small>음악 없음</small>}<i className="timeline-playhead" style={{ left: percent(position, duration) }} /></div></div>
      {project.schema_version === "2.1" && <div className="scene-timeline-foot"><small>자막 막대 가운데를 끌면 위치 이동 · 양끝을 끌면 나머지 줄의 시간 자동 재분배</small><button className="btn ghost" type="button" disabled={!canReset} onClick={() => onChange({ ...scene, captions: resetCaptionTiming(scene.captions || [], sourceCaptions) })}>제작안 시간으로 초기화</button></div>}
    </div>
  </div>;
}
