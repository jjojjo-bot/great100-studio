import { useEffect, useRef, useState } from "react";
import type { CaptionBlock, Scene } from "./types";

type Drag = { index: number; mode: "move" | "start" | "end"; x: number; initial: CaptionBlock[] };
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function moveCaption(blocks: CaptionBlock[], index: number, mode: Drag["mode"], delta: number, sceneStart: number, duration: number): CaptionBlock[] {
  const block = blocks[index];
  if (!block) return blocks;
  const previousEnd = index ? blocks[index - 1].end_sec : sceneStart;
  const nextStart = index < blocks.length - 1 ? blocks[index + 1].start_sec : sceneStart + duration;
  const length = block.end_sec - block.start_sec;
  let start = block.start_sec; let end = block.end_sec;
  if (mode === "move") { start = round(clamp(block.start_sec + delta, previousEnd, nextStart - length)); end = round(start + length); }
  if (mode === "start") start = round(clamp(block.start_sec + delta, previousEnd, end - 0.1));
  if (mode === "end") end = round(clamp(block.end_sec + delta, start + 0.1, nextStart));
  return blocks.map((item, position) => position === index ? { ...item, start_sec: start, end_sec: end } : item);
}

export function redistributeCaptions(blocks: CaptionBlock[], index: number, desiredDuration: number, sceneStart: number, sceneDuration: number): CaptionBlock[] {
  if (!blocks[index] || !Number.isFinite(desiredDuration)) return blocks;
  const totalTicks = Math.round(sceneDuration * 10);
  if (totalTicks < blocks.length) return blocks;
  const chosenTicks = clamp(Math.round(desiredDuration * 10), 1, totalTicks - blocks.length + 1);
  const otherIndexes = blocks.map((_, position) => position).filter((position) => position !== index);
  const remaining = totalTicks - chosenTicks - otherIndexes.length;
  const weights = otherIndexes.map((position) => Math.max(0.1, blocks[position].end_sec - blocks[position].start_sec));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const fractional = weights.map((weight) => weight / weightSum * remaining);
  const extra = fractional.map(Math.floor);
  let leftover = remaining - extra.reduce((sum, value) => sum + value, 0);
  const order = otherIndexes.map((_, position) => position).sort((a, b) => (fractional[b] - extra[b]) - (fractional[a] - extra[a]));
  for (const position of order) { if (!leftover) break; extra[position]++; leftover--; }
  const ticks = blocks.map((_, position) => position === index ? chosenTicks : 1 + extra[otherIndexes.indexOf(position)]);
  let cursor = Math.round(sceneStart * 10);
  return blocks.map((block, position) => {
    const start_sec = cursor / 10;
    cursor += ticks[position];
    return { ...block, start_sec, end_sec: cursor / 10 };
  });
}

export function CaptionWaveform({ blob, scene, onChange, playhead = 0 }: { blob?: Blob | null; scene: Scene; onChange: (scene: Scene) => void; playhead?: number }) {
  const [bars, setBars] = useState<number[]>([]);
  const [draft, setDraft] = useState<CaptionBlock[] | null>(null);
  const draftRef = useRef<CaptionBlock[] | null>(null);
  const [error, setError] = useState("");
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const duration = scene.duration ?? 10;
  const start = scene.start_sec ?? 0;
  const blocks = draft ?? scene.captions ?? [];
  useEffect(() => {
    if (!blob) { setBars([]); setError(""); return; }
    let active = true;
    const context = new AudioContext();
    const decode = async () => {
      try {
        const buffer = ["audio/mp4", "video/mp4"].includes(blob.type) ? await (await import("./music")).decodeMpeg4Audio(blob, context) : await context.decodeAudioData(await blob.arrayBuffer());
        const samples = buffer.getChannelData(0);
        const count = 120;
        const peaks = Array.from({ length: count }, (_, index) => {
          const from = Math.floor(index * samples.length / count);
          const to = Math.max(from + 1, Math.floor((index + 1) * samples.length / count));
          let peak = 0;
          for (let sample = from; sample < to; sample += 16) peak = Math.max(peak, Math.abs(samples[sample] ?? 0));
          return peak;
        });
        const max = Math.max(0.05, ...peaks);
        if (active) setBars(peaks.map((peak) => Math.max(0.05, peak / max)));
      } catch { if (active) setError("파형을 표시하지 못했습니다. 녹음 재생과 숫자 입력은 계속 사용할 수 있습니다."); }
      finally { void context.close(); }
    };
    void decode();
    return () => { active = false; };
  }, [blob]);
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !track.current) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(drag.current.x)) return;
    const delta = (event.clientX - drag.current.x) / track.current.getBoundingClientRect().width * duration;
    const { initial, index, mode } = drag.current;
    const next = mode === "move"
      ? moveCaption(initial, index, mode, delta, start, duration)
      : redistributeCaptions(initial, index, initial[index].end_sec - initial[index].start_sec + (mode === "start" ? -delta : delta), start, duration);
    draftRef.current = next;
    setDraft(next);
  };
  const onPointerUp = () => {
    if (drag.current && draftRef.current) onChange({ ...scene, captions: draftRef.current });
    drag.current = null; draftRef.current = null; setDraft(null);
  };
  const begin = (event: React.PointerEvent, index: number, mode: Drag["mode"]) => {
    event.preventDefault(); event.stopPropagation();
    if (!Number.isFinite(event.clientX)) return;
    drag.current = { index, mode, x: event.clientX, initial: [...blocks] };
    track.current?.setPointerCapture(event.pointerId);
  };
  return <div className="caption-waveform"><strong>{blob ? "녹음 파형과 자막 시간" : "자막 시간 막대"}</strong><small>양끝 손잡이로 한 자막의 노출 시간을 바꾸면 나머지 자막이 남은 시간을 비율대로 나눠 갖습니다. 가운데를 끌면 해당 자막 위치만 옮깁니다.</small>
    <div className="waveform-track" ref={track} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setDraft(null); }}>
      <div className="waveform-bars">{bars.map((height, index) => <i key={index} style={{ height: `${Math.round(height * 100)}%` }} />)}</div>
      {blocks.map((block, index) => <div key={index} className="waveform-caption" style={{ left: `${(block.start_sec - start) / duration * 100}%`, width: `${(block.end_sec - block.start_sec) / duration * 100}%` }} title={`${index + 1}. ${block.text} · ${block.start_sec.toFixed(1)}–${block.end_sec.toFixed(1)}초`} onPointerDown={(event) => begin(event, index, "move")}><span className="waveform-handle" role="slider" aria-label={`자막 ${index + 1} 시작 손잡이`} aria-valuemin={start} aria-valuemax={block.end_sec - 0.1} aria-valuenow={block.start_sec} onPointerDown={(event) => begin(event, index, "start")} /><b>{index + 1}</b><span className="waveform-handle" role="slider" aria-label={`자막 ${index + 1} 종료 손잡이`} aria-valuemin={block.start_sec + 0.1} aria-valuemax={start + duration} aria-valuenow={block.end_sec} onPointerDown={(event) => begin(event, index, "end")} /></div>)}
      <div className="waveform-playhead" style={{ left: `${clamp(playhead / duration, 0, 1) * 100}%` }} />
    </div><div className="waveform-ruler"><span>{start.toFixed(1)}초</span><span>{(start + duration).toFixed(1)}초</span></div>{error && <small>{error}</small>}{!blocks.length && <small>이 장면에는 시간 지정 자막이 없습니다.</small>}
  </div>;
}
