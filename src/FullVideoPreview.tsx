import { useEffect, useMemo, useRef, useState } from "react";
import { getBackgroundMusic, getSceneNarration, getSceneVideo } from "./platform";
import { activeTimedCaption, buildVideoPlan, captionParts, drawFrame, musicGainAtTime, VIDEO_HEIGHT, VIDEO_WIDTH, type VideoSegment } from "./video";
import type { ProjectData } from "./types";

type Media = { image: HTMLImageElement | null; support: HTMLImageElement | null; video: HTMLVideoElement | null; narration: HTMLAudioElement | null };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const loadImage = async (url?: string) => {
  if (!url) return null;
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};

export function FullVideoPreview({ project }: { project: ProjectData }) {
  const planResult = useMemo(() => { try { return { plan: buildVideoPlan(project), error: "" }; } catch (error) { return { plan: [] as VideoSegment[], error: String(error) }; } }, [project]);
  const plan = planResult.plan;
  const total = plan.reduce((sum, segment) => sum + segment.duration, 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<Media[]>([]);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const positionRef = useRef(0);
  const playbackStartRef = useRef(0);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const renderAt = (time: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !mediaRef.current.length) return;
    let start = 0;
    let index = plan.length - 1;
    for (let i = 0; i < plan.length; i++) { if (time < start + plan[i].duration || i === plan.length - 1) { index = i; break; } start += plan[i].duration; }
    const segment = plan[index];
    const media = mediaRef.current[index];
    if (!media) return;
    const seconds = clamp(time - start, 0, segment.duration);
    const progress = segment.duration ? seconds / segment.duration : 0;
    let visual: HTMLImageElement | HTMLVideoElement | null = media.image;
    if (media.video && seconds >= (segment.videoIntroDuration ?? 0)) {
      const videoTime = clamp((segment.videoTrimStart ?? 0) + seconds - (segment.videoIntroDuration ?? 0), 0, Math.max(0, (segment.videoTrimEnd ?? media.video.duration) - 0.02));
      if (Math.abs(media.video.currentTime - videoTime) > (playingRef.current ? 0.15 : 0.03)) media.video.currentTime = videoTime;
      if (media.video.readyState >= 2) visual = media.video;
      if (playingRef.current && media.video.paused && videoTime < (segment.videoTrimEnd ?? media.video.duration) - 0.04) void media.video.play().catch(() => {});
    }
    mediaRef.current.forEach((item, itemIndex) => { if (itemIndex !== index || seconds < (segment.videoIntroDuration ?? 0) || seconds >= (segment.videoTrimEnd ?? Infinity) - (segment.videoTrimStart ?? 0) + (segment.videoIntroDuration ?? 0)) item.video?.pause(); });
    const parts = captionParts(segment.caption);
    const caption = segment.timedCaptions ? activeTimedCaption(segment.timedCaptions, seconds) : parts[Math.min(parts.length - 1, Math.floor(progress * parts.length))];
    const supportStart = segment.supportStartsAt ?? Infinity;
    const supportOpacity = media.support ? clamp((seconds - supportStart) / Math.min(0.6, segment.duration / 8), 0, 1) : 0;
    const supportProgress = media.support ? clamp((seconds - supportStart) / Math.max(0.01, segment.duration - supportStart), 0, 1) : 0;
    const motionProgress = (segment.motionStart ?? 0) + progress * ((segment.motionEnd ?? 1) - (segment.motionStart ?? 0));
    const introOpacity = media.video && media.image && seconds >= (segment.videoIntroDuration ?? 0) ? clamp(1 - (seconds - (segment.videoIntroDuration ?? 0)) / 0.3, 0, 1) : 0;
    drawFrame(ctx, visual, caption, motionProgress, project.person, segment.motion, segment.emphasisSubtitle && seconds < 3 ? segment.emphasisSubtitle : "", seconds, media.support, supportOpacity, supportProgress, segment.opening ? clamp((segment.duration - seconds) / 0.8, 0, 1) : 0, !!segment.ending, index === 1 ? clamp(seconds / 0.5, 0, 1) : 1, introOpacity ? media.image : null, introOpacity);
    mediaRef.current.forEach((item, itemIndex) => {
      if (!item.narration) return;
      if (itemIndex === index && seconds < item.narration.duration && playingRef.current) {
        if (Math.abs(item.narration.currentTime - seconds) > 0.15) item.narration.currentTime = seconds;
        if (item.narration.paused) void item.narration.play().catch(() => {});
      } else item.narration.pause();
    });
    const music = musicRef.current;
    if (music) {
      const narrationActive = !!media.narration && seconds < media.narration.duration;
      music.volume = clamp(musicGainAtTime(plan, time) * (narrationActive ? 0.28 : 1), 0, 1);
      if (playingRef.current && music.paused) void music.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (!plan.length) return;
    let cancelled = false;
    const urls: string[] = [];
    setReady(false); setError(""); setPosition(0); positionRef.current = 0;
    const load = async () => {
      const media: Media[] = [];
      for (const segment of plan) {
        const image = await loadImage(segment.imageUrl);
        const support = await loadImage(segment.supportImageUrl);
        let video: HTMLVideoElement | null = null;
        let narration: HTMLAudioElement | null = null;
        const scene = project.scenes.find((item) => item.id === segment.sceneId);
        if (segment.videoCandidateId && scene) {
          const candidate = scene.candidates.find((item) => item.id === segment.videoCandidateId);
          const blob = candidate && await getSceneVideo(project, scene, candidate);
          if (!blob) throw new Error(`${segment.title} 동영상 파일을 찾지 못했습니다.`);
          const url = URL.createObjectURL(blob); urls.push(url);
          video = document.createElement("video"); video.src = url; video.muted = true; video.preload = "auto"; video.playsInline = true;
          await new Promise<void>((resolve, reject) => { video!.onloadeddata = () => resolve(); video!.onerror = () => reject(new Error("동영상을 읽지 못했습니다.")); });
          video.onseeked = () => { if (!cancelled) renderAt(positionRef.current); };
        }
        if (scene?.narration_audio) {
          const blob = await getSceneNarration(project, scene);
          if (!blob) throw new Error(`${segment.title} 녹음 파일을 찾지 못했습니다.`);
          const url = URL.createObjectURL(blob); urls.push(url);
          narration = new Audio(url); narration.preload = "auto";
        }
        media.push({ image, support, video, narration });
      }
      if (project.background_music) {
        const blob = await getBackgroundMusic(project);
        if (!blob) throw new Error("배경음악 파일을 찾지 못했습니다.");
        const url = URL.createObjectURL(blob); urls.push(url);
        musicRef.current = new Audio(url); musicRef.current.loop = true;
      }
      if (cancelled) { media.forEach((item) => { item.video?.pause(); item.narration?.pause(); }); return; }
      mediaRef.current = media;
      setReady(true);
      requestAnimationFrame(() => renderAt(0));
    };
    void load().catch((cause) => { if (!cancelled) setError(String(cause)); });
    return () => {
      cancelled = true; playingRef.current = false; cancelAnimationFrame(rafRef.current);
      mediaRef.current.forEach((item) => { item.video?.pause(); item.narration?.pause(); item.video?.removeAttribute("src"); });
      mediaRef.current = []; musicRef.current?.pause(); musicRef.current = null;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  // Assets and settings are refreshed when the review page is reopened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const seek = (time: number) => {
    positionRef.current = clamp(time, 0, total);
    if (playingRef.current) playbackStartRef.current = performance.now() - positionRef.current * 1000;
    setPosition(positionRef.current);
    if (musicRef.current) musicRef.current.currentTime = positionRef.current % (musicRef.current.duration || 1);
    renderAt(positionRef.current);
  };
  const toggle = () => {
    if (playingRef.current) { playingRef.current = false; setPlaying(false); musicRef.current?.pause(); mediaRef.current.forEach((item) => { item.narration?.pause(); item.video?.pause(); }); cancelAnimationFrame(rafRef.current); return; }
    if (positionRef.current >= total) seek(0);
    playingRef.current = true; setPlaying(true);
    playbackStartRef.current = performance.now() - positionRef.current * 1000;
    const tick = () => {
      const next = Math.min(total, (performance.now() - playbackStartRef.current) / 1000);
      positionRef.current = next; setPosition(next); renderAt(next);
      if (next < total && playingRef.current) rafRef.current = requestAnimationFrame(tick);
      else { playingRef.current = false; setPlaying(false); musicRef.current?.pause(); mediaRef.current.forEach((item) => { item.narration?.pause(); item.video?.pause(); }); }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  if (planResult.error) return <div className="panel"><strong>전체 영상 미리보기</strong><p>장면과 썸네일을 모두 선택하면 재생할 수 있습니다. {planResult.error}</p></div>;
  return <div className="panel full-video-preview"><div><strong>MP4 만들기 전 전체 미리보기</strong><small>장면 전환·자막·배경음악·녹음을 재생하며 확인하세요.</small></div><canvas ref={canvasRef} width={VIDEO_WIDTH} height={VIDEO_HEIGHT} aria-label="전체 영상 미리보기 화면" />
    <div className="preview-controls"><button className="btn primary" disabled={!ready} onClick={toggle}>{playing ? "일시정지" : "재생"}</button><input aria-label="전체 영상 위치" type="range" min="0" max={total} step="0.05" value={position} disabled={!ready} onChange={(event) => seek(Number(event.target.value))} /><span>{position.toFixed(1)} / {total.toFixed(1)}초</span></div>
    {!ready && !error && <small>영상 자료를 불러오는 중…</small>}{error && <div className="error-banner">미리보기를 열지 못했습니다: {error}</div>}
  </div>;
}
