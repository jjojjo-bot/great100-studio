import { useEffect, useMemo, useRef, useState } from "react";
import { getBackgroundMusic, getMediaAsset } from "./platform";
import { activeTimedCaption, buildSceneSegments, buildVideoPlan, captionParts, drawFrame, musicGainAtTime, visualPlayback, VIDEO_HEIGHT, VIDEO_WIDTH, type VideoSegment } from "./video";
import type { ProjectData } from "./types";
import { frameTimeline, playbackPosition, segmentProgress } from "./timeline";
import { narrationTimeline } from "./narration-timeline";

type Media = { image: HTMLImageElement | null; support: HTMLImageElement | null; video: HTMLVideoElement | null };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const loadImage = async (url?: string) => {
  if (!url) return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  return image;
};

export function FullVideoPreview({ project, sceneId, seekRequest, onPositionChange }: { project: ProjectData; sceneId?: string; seekRequest?: { id: number; time: number }; onPositionChange?: (time: number) => void }) {
  const planResult = useMemo(() => { try {
    const scene = sceneId ? project.scenes.find((item) => item.id === sceneId) : undefined;
    if (sceneId && !scene) throw new Error("장면을 찾지 못했습니다.");
    return { plan: scene ? buildSceneSegments(project, scene, Math.max(0, scene.number - 1)) : buildVideoPlan(project), error: "" };
  } catch (error) { return { plan: [] as VideoSegment[], error: String(error) }; } }, [project, sceneId]);
  const plan = planResult.plan;
  const voices = useMemo(() => { try { return narrationTimeline(project, sceneId); } catch { return []; } }, [project, sceneId]);
  const total = frameTimeline(plan.map(segment => segment.duration), true).at(-1)?.end ?? 0;
  const mediaKey = useMemo(() => JSON.stringify({ project: project.id, sceneId, music: project.background_music,
    assets: plan.map(segment => [segment.imageUrl, segment.supportImageUrl, segment.videoAssetId]), voices: voices.map(clip => [clip.id, clip.asset_id]) }), [project, sceneId, plan, voices]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<Media[]>([]);
  const voicesRef = useRef<HTMLAudioElement[]>([]);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const positionRef = useRef(0);
  const playbackStartRef = useRef(0);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  const renderRef = useRef<(time: number) => void>(() => {});
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const reportedPositionRef = useRef(-1);
  const reportPosition = (time: number, force = false) => {
    if (onPositionChange && (force || Math.abs(time - reportedPositionRef.current) >= 0.1)) {
      reportedPositionRef.current = time;
      onPositionChange(time);
    }
  };

  const renderAt = (time: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !mediaRef.current.length) return;
    const location = playbackPosition(plan.map(segment => segment.duration), time);
    if (!location) return;
    const { index, seconds } = location;
    const segment = plan[index];
    const media = mediaRef.current[index];
    if (!media) return;
    const progress = segmentProgress(seconds, segment.duration);
    const state = visualPlayback(segment, seconds);
    let visual: HTMLImageElement | HTMLVideoElement | null = media.image;
    if (media.video && state.videoActive) {
      const videoTime = Math.min(state.videoTime, Math.max(0, media.video.duration - 0.001));
      if (Math.abs(media.video.currentTime - videoTime) > (playingRef.current ? 0.15 : 0.03)) media.video.currentTime = videoTime;
      if (media.video.readyState >= 2) visual = media.video;
      if (playingRef.current && media.video.paused && videoTime < (segment.videoTrimEnd ?? media.video.duration) - 0.04) void media.video.play().catch(() => {});
    }
    mediaRef.current.forEach((item, itemIndex) => { if (itemIndex !== index || !state.videoActive || state.videoTime >= (segment.videoTrimEnd ?? Infinity) - 0.04) item.video?.pause(); });
    const parts = captionParts(segment.caption);
    const caption = segment.timedCaptions ? activeTimedCaption(segment.timedCaptions, seconds) : parts[Math.min(parts.length - 1, Math.floor(progress * parts.length))];
    drawFrame(ctx, visual, caption, state.motionProgress, project.person, segment.motion, segment.emphasisSubtitle && state.emphasisAge < 3 ? segment.emphasisSubtitle : "", state.emphasisAge, media.support, state.supportOpacity, state.supportProgress, segment.opening ? clamp((1 - progress) * segment.duration / 0.8, 0, 1) : 0, !!segment.ending, index === 1 ? clamp(seconds / 0.5, 0, 1) : 1, state.introOpacity ? media.image : null, state.introOpacity);
    voicesRef.current.forEach((audio, clipIndex) => {
      const clip = voices[clipIndex];
      if (clip && time >= clip.start_sec && time < clip.end_sec && playingRef.current) {
        const sourceTime = clip.source_start_sec + time - clip.start_sec;
        if (Math.abs(audio.currentTime - sourceTime) > 0.15) audio.currentTime = sourceTime;
        if (audio.paused) void audio.play().catch(() => {});
      } else audio.pause();
    });
    const music = musicRef.current;
    if (music) {
      const narrationActive = voices.some(clip => time >= clip.start_sec && time < clip.end_sec);
      music.volume = clamp(musicGainAtTime(plan, time) * (narrationActive ? 0.28 : 1), 0, 1);
      if (playingRef.current && music.paused) void music.play().catch(() => {});
    }
  };
  renderRef.current = renderAt;

  useEffect(() => {
    if (!plan.length) return;
    let cancelled = false;
    const urls: string[] = [];
    playingRef.current = false; setPlaying(false); cancelAnimationFrame(rafRef.current);
    setReady(false); setError(""); setPosition(0); positionRef.current = 0; reportPosition(0, true);
    const load = async () => {
      const media: Media[] = [];
      for (const segment of plan) {
        const image = await loadImage(segment.imageUrl);
        const support = await loadImage(segment.supportImageUrl);
        let video: HTMLVideoElement | null = null;
        if (segment.videoAssetId) {
          const blob = await getMediaAsset(project, segment.videoAssetId);
          if (!blob) throw new Error(`${segment.title} 동영상 파일을 찾지 못했습니다.`);
          const url = URL.createObjectURL(blob); urls.push(url);
          video = document.createElement("video"); video.src = url; video.muted = true; video.preload = "auto"; video.playsInline = true;
          await new Promise<void>((resolve, reject) => { video!.onloadeddata = () => resolve(); video!.onerror = () => reject(new Error("동영상을 읽지 못했습니다.")); });
          video.onseeked = () => { if (!cancelled) renderRef.current(positionRef.current); };
        }
        media.push({ image, support, video });
      }
      const narrations: HTMLAudioElement[] = [];
      for (const clip of voices) {
        const blob = await getMediaAsset(project, clip.asset_id);
        if (!blob) throw new Error("녹음 원본 파일을 찾지 못했습니다.");
        const url = URL.createObjectURL(blob); urls.push(url);
        const audio = new Audio(url); audio.preload = "auto"; narrations.push(audio);
      }
      if (project.background_music) {
        const blob = await getBackgroundMusic(project);
        if (!blob) throw new Error("배경음악 파일을 찾지 못했습니다.");
        const url = URL.createObjectURL(blob); urls.push(url);
        musicRef.current = new Audio(url); musicRef.current.loop = true;
      }
      if (cancelled) { media.forEach(item => item.video?.pause()); narrations.forEach(audio => audio.pause()); return; }
      mediaRef.current = media;
      voicesRef.current = narrations;
      setReady(true);
      requestAnimationFrame(() => renderRef.current(0));
    };
    void load().catch((cause) => { if (!cancelled) setError(String(cause)); });
    return () => {
      cancelled = true; playingRef.current = false; cancelAnimationFrame(rafRef.current);
      mediaRef.current.forEach((item) => { item.video?.pause(); item.video?.removeAttribute("src"); });
      voicesRef.current.forEach(audio => { audio.pause(); audio.removeAttribute("src"); }); voicesRef.current = [];
      mediaRef.current = []; musicRef.current?.pause(); musicRef.current = null;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  // Media is reloaded only when a selected file changes; text and timing edits redraw in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(() => { if (ready && plan.length) renderRef.current(positionRef.current); }, [plan, ready]);

  const timingKey = JSON.stringify([voices, plan.map(segment => [segment.duration, segment.videoTrimStart, segment.videoTrimEnd, segment.playbackOffset])]);
  useEffect(() => {
    playingRef.current = false; setPlaying(false); cancelAnimationFrame(rafRef.current);
    musicRef.current?.pause();
    mediaRef.current.forEach(item => item.video?.pause()); voicesRef.current.forEach(audio => audio.pause());
    const next = Math.min(positionRef.current, total);
    positionRef.current = next; setPosition(next); reportPosition(next, true);
    if (ready && plan.length) renderRef.current(next);
  }, [timingKey]);

  const seek = (time: number) => {
    positionRef.current = clamp(time, 0, total);
    if (playingRef.current) playbackStartRef.current = performance.now() - positionRef.current * 1000;
    setPosition(positionRef.current);
    reportPosition(positionRef.current, true);
    if (musicRef.current) musicRef.current.currentTime = positionRef.current % (musicRef.current.duration || 1);
    renderRef.current(positionRef.current);
  };
  const toggle = () => {
    if (playingRef.current) { playingRef.current = false; setPlaying(false); musicRef.current?.pause(); mediaRef.current.forEach(item => item.video?.pause()); voicesRef.current.forEach(audio => audio.pause()); cancelAnimationFrame(rafRef.current); return; }
    if (positionRef.current >= total) seek(0);
    playingRef.current = true; setPlaying(true);
    playbackStartRef.current = performance.now() - positionRef.current * 1000;
    const tick = () => {
      const next = Math.min(total, (performance.now() - playbackStartRef.current) / 1000);
      positionRef.current = next; setPosition(next); renderRef.current(next);
      reportPosition(next, next === total);
      if (next < total && playingRef.current) rafRef.current = requestAnimationFrame(tick);
      else { playingRef.current = false; setPlaying(false); musicRef.current?.pause(); mediaRef.current.forEach(item => item.video?.pause()); voicesRef.current.forEach(audio => audio.pause()); }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => { if (seekRequest && ready) seek(seekRequest.time); }, [seekRequest?.id, ready]);
  const title = sceneId ? "이 장면의 자막·영상 미리보기" : "MP4 만들기 전 전체 미리보기";
  if (planResult.error) return <div className="panel"><strong>{title}</strong><p>{sceneId ? "이 장면의 이미지 또는 동영상을 선택하면 재생할 수 있습니다." : "장면과 썸네일을 모두 선택하면 재생할 수 있습니다."} {planResult.error}</p></div>;
  return <div className="panel full-video-preview"><div><strong>{title}</strong><small>{sceneId ? "이 장면의 자막·화면·녹음을 함께 확인하세요. 자막 시간을 바꾸면 이 화면에 바로 반영됩니다." : "장면 전환·자막·배경음악·녹음을 재생하며 확인하세요."}</small></div><canvas ref={canvasRef} width={VIDEO_WIDTH} height={VIDEO_HEIGHT} aria-label={sceneId ? "장면 자막 영상 미리보기 화면" : "전체 영상 미리보기 화면"} />
    <div className="preview-controls"><button className="btn primary" disabled={!ready} onClick={toggle}>{playing ? "일시정지" : "재생"}</button><input aria-label={sceneId ? "장면 미리보기 위치" : "전체 영상 위치"} type="range" min="0" max={total} step="0.05" value={position} disabled={!ready} onChange={(event) => seek(Number(event.target.value))} /><span>{position.toFixed(1)} / {total.toFixed(1)}초</span></div>
    {!ready && !error && <small>영상 자료를 불러오는 중…</small>}{error && <div className="error-banner">미리보기를 열지 못했습니다: {error}</div>}
  </div>;
}
