import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, Trash2, Upload } from "lucide-react";
import { discardSceneNarration, getSceneNarration, inspectSceneNarration, removeSceneNarration, savePreparedNarration, type PreparedNarration } from "./platform";
import { proposeNarrationTiming, timingFingerprint, type CaptionTimingMode, type TimingRequest } from "./timeline";
import type { EditOptions } from "./editor-history";
import type { ProjectData, Scene, SceneNarrationAudio } from "./types";
import { hasSceneNarration } from "./scene-audio";
import { bindComposition, sceneComposition } from "./media-composition";
import { SceneNarrationGenerator } from "./SceneNarrationGenerator";
import type { GeneratedNarrationRequest } from "./narration-generation";

type Pending = { project: ProjectData; scene: Scene; duration: number; name: string; prepared?: PreparedNarration; saved?: SceneNarrationAudio };
const seconds = (value: number) => `${Number(value.toFixed(3))}초`;

export function SceneNarrationPanel({ project, scene, onChange, onTimingChange, onGeneratedNarration }: {
  project: ProjectData; scene: Scene; onChange: (scene: Scene, options?: EditOptions) => void; onTimingChange: (request: TimingRequest) => void;
  onGeneratedNarration: (request: GeneratedNarrationRequest) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const active = useRef(true);
  const latest = useRef({ project, scene, onChange }); latest.current = { project, scene, onChange };
  const pendingRef = useRef<Pending | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [pendingUrl, setPendingUrl] = useState("");
  const [pending, setPendingState] = useState<Pending | null>(null);
  const [mode, setMode] = useState<CaptionTimingMode>("keep");
  const duration = scene.duration ?? 10;
  const hasNarration = hasSceneNarration(scene);
  const compositionKey = JSON.stringify(scene.composition?.narrations);
  const setPending = (value: Pending | null) => { pendingRef.current = value; if (active.current) setPendingState(value); };
  const discard = (value: Pending) => value.saved ? discardSceneNarration(value.project, value.scene, value.saved).catch(() => {}) : Promise.resolve();

  useEffect(() => {
    let current = true;
    let url = "";
    setPreviewUrl("");
    if (hasNarration) {
      getSceneNarration(project, scene).then(blob => {
        if (!blob) throw new Error("저장된 녹음을 찾지 못했습니다. 다시 녹음하거나 업로드해 주세요.");
        url = URL.createObjectURL(blob);
        if (current) setPreviewUrl(url); else URL.revokeObjectURL(url);
      }).catch(cause => { if (current) setError(String(cause)); });
    }
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [project.id, scene.id, scene.narration_audio?.path, scene.narration_audio?.storage_key, compositionKey, duration, hasNarration]);

  useEffect(() => {
    if (!pending?.prepared) { setPendingUrl(""); return; }
    const url = URL.createObjectURL(pending.prepared.file); setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending?.prepared?.file]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (timer.current !== null) window.clearInterval(timer.current);
      if (recorder.current && recorder.current.state !== "inactive") { recorder.current.onstop = null; recorder.current.stop(); }
      stream.current?.getTracks().forEach(track => track.stop());
      if (pendingRef.current) void discard(pendingRef.current);
    };
  }, []);

  const upload = async (file: File) => {
    setBusy(true); setError("");
    const owner = latest.current;
    try {
      const prepared = await inspectSceneNarration(file);
      if (!active.current) return;
      const current = latest.current;
      if (prepared.duration > (current.scene.duration ?? 10)) {
        setMode("keep"); setPending({ ...current, duration: prepared.duration, name: file.name, prepared }); return;
      }
      const narration = await savePreparedNarration(current.project, current.scene, prepared);
      const value = { ...current, duration: prepared.duration, name: file.name, prepared, saved: narration };
      if (!active.current) { await discard(value); return; }
      const fresh = latest.current;
      if (fresh.project.id !== owner.project.id || fresh.scene.id !== owner.scene.id) { await discard(value); return; }
      if (prepared.duration > (fresh.scene.duration ?? 10) || fresh.scene.narration_audio?.path !== current.scene.narration_audio?.path) {
        setMode("keep"); setPending(value); return;
      }
      fresh.onChange({ ...fresh.scene, narration_audio: narration }, { history: false });
    } catch (cause) { if (active.current) setError(String(cause)); }
    finally { if (active.current) setBusy(false); }
  };

  let proposal: ReturnType<typeof proposeNarrationTiming> | undefined;
  let proposalError = "";
  if (pending) {
    try { proposal = proposeNarrationTiming(project, scene.id, pending.duration, mode); }
    catch (cause) { proposalError = (cause as Error).message; }
  }
  const apply = async () => {
    if (!pending || !proposal) return;
    const expected = timingFingerprint(project);
    const owner = pending;
    setBusy(true); setError("");
    try {
      let narration = pending.saved;
      if (pending.prepared && !narration) {
        narration = await savePreparedNarration(project, proposal.project.scenes.find(item => item.id === scene.id)!, pending.prepared);
        const next = { ...pending, saved: narration };
        if (!active.current) { await discard(next); return; }
        setPending(next);
      }
      // The callback validates this fingerprint against the latest project and
      // updates it synchronously; persistence uses the existing save-error flow.
      onTimingChange({ projectId: owner.project.id, sceneId: owner.scene.id, narrationDuration: pending.duration, mode, expected, narration });
      setPending(null);
    } catch (cause) { if (active.current) setError(String(cause)); }
    finally { if (active.current) setBusy(false); }
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("이 브라우저에서는 마이크 녹음을 사용할 수 없습니다. 오디오 파일을 업로드해 주세요."); return; }
    setBusy(true);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(microphone, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null; microphone.getTracks().forEach(track => track.stop()); stream.current = null; recorder.current = null; setRecording(false);
        if (!chunks.length) return setError("녹음된 소리가 없습니다. 다시 시도해 주세요.");
        const mime = current.mimeType.split(";")[0];
        const extension = mime === "audio/mp4" ? "m4a" : mime === "audio/webm" ? "webm" : "";
        if (!extension) return setError("이 브라우저의 녹음 형식을 사용할 수 없습니다. 오디오 파일을 업로드해 주세요.");
        void upload(new File(chunks, `scene${String(scene.number).padStart(2, "0")}.${extension}`, { type: mime }));
      };
      current.start(); recorder.current = current; setElapsed(0); setRecording(true);
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const value = (Date.now() - started) / 1000; setElapsed(value);
        if (value >= 119.75 && current.state === "recording") current.stop();
      }, 100);
    } catch (cause) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (active.current) setError(`마이크를 사용할 수 없습니다: ${String(cause)}`); }
    finally { if (active.current) setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Scene ${scene.number} 녹음을 제거할까요?`)) return;
    setBusy(true); setError("");
    try {
      const current = latest.current;
      await removeSceneNarration(current.project, current.scene);
      if (active.current) {
        const next = { ...latest.current.scene, narration_audio: undefined };
        if (next.composition?.mode === "segments") next.composition = bindComposition(next, { ...sceneComposition(next), narrations: [] });
        latest.current.onChange(next, { history: false });
      }
    } catch (cause) { if (active.current) setError(String(cause)); }
    finally { if (active.current) setBusy(false); }
  };

  const blocked = busy || recording || !!pending || generationBusy;
  return <div className="panel narration-panel">
    <div className="narration-head"><div><strong>이 장면의 내레이션</strong><small>{scene.composition?.mode === "segments" ? "각 원본 녹음의 편집 구간을 사용합니다. 새로 녹음하거나 업로드하면 이 장면의 녹음을 교체합니다." : "녹음은 장면 시작에 맞춰 들어갑니다. 길이가 다르면 장면과 자막 시간을 함께 조정할 수 있습니다."}</small></div><span>{seconds(duration)} 장면</span></div>
    <div className="narration-actions"><input ref={input} className="file-input" type="file" disabled={blocked} accept=".mp3,.wav,.m4a,.mp4,.webm,audio/*,video/mp4" aria-label={`Scene ${scene.number} 내레이션 파일 선택`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      {recording ? <button className="btn primary" onClick={() => recorder.current?.stop()}><Square size={15} /> 녹음 마치기 · {elapsed.toFixed(1)}초</button> : <button className="btn primary" disabled={blocked} onClick={() => void startRecording()}><Mic size={16} /> {hasNarration ? "다시 녹음" : "녹음 시작"}</button>}
      <button className="btn ghost" disabled={blocked} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} 파일 업로드</button>
      {scene.narration_audio && <button className="btn ghost" disabled={blocked} onClick={() => { setError(""); setMode("keep"); setPending({ project, scene, duration: scene.narration_audio!.duration_sec, name: scene.narration_audio!.name }); }}>녹음 길이에 맞추기</button>}
    </div>
    {scene.narration_audio && <div className="narration-file"><span>{scene.narration_audio.name} · {seconds(scene.narration_audio.duration_sec)}</span>{previewUrl && <audio controls preload="metadata" src={previewUrl} aria-label={`Scene ${scene.number} 내레이션 미리듣기`} />}<button className="btn ghost" disabled={blocked} onClick={() => void remove()}><Trash2 size={15} /> 제거</button></div>}
    {!scene.narration_audio && hasNarration && <div className="narration-file"><span>원본 녹음의 편집 구간 · {seconds(duration)}</span>{previewUrl && <audio controls preload="metadata" src={previewUrl} aria-label={`Scene ${scene.number} 내레이션 미리듣기`} />}<button className="btn ghost" disabled={blocked} onClick={() => void remove()}><Trash2 size={15} /> 제거</button></div>}
    {scene.narration_audio && scene.narration_audio.duration_sec > duration + 0.15 && <div className="error-banner" role="alert">녹음이 장면보다 깁니다. 녹음은 보관되어 있으며, 영상 출력 전에 녹음 길이에 맞추기를 적용해 주세요.</div>}
    {pending && <section className="narration-adjustment" aria-label="녹음 길이 조정안">
      <strong>녹음 길이에 맞춰 시간 조정</strong><p>{pending.name} · {seconds(pending.duration)} 녹음</p>
      {pendingUrl && <audio controls preload="metadata" src={pendingUrl} aria-label="적용할 녹음 미리듣기" />}
      <fieldset disabled={busy}><legend>이 장면의 자막 시간</legend><label><input type="radio" name={`caption-timing-${project.id}-${scene.id}`} checked={mode === "keep"} onChange={() => setMode("keep")} /> 자막 시간 유지</label><label><input type="radio" name={`caption-timing-${project.id}-${scene.id}`} checked={mode === "scale"} onChange={() => setMode("scale")} /> 자막 비율 재배치</label></fieldset>
      <small>비율 재배치는 현재 자막의 위치를 장면 길이에 비례해 조정합니다. 실제 발화 시점을 인식하는 정렬은 아닙니다.</small>
      {proposal && <><p>장면 {seconds(duration)} → <b>{seconds(proposal.duration)}</b> · 전체 영상 {seconds(proposal.before.totalDuration)} → <b>{seconds(proposal.after.totalDuration)}</b></p>
        <div className="narration-adjustment-table"><table><caption>장면 시간 변경 전후</caption><thead><tr><th>장면</th><th>현재</th><th>변경 후</th></tr></thead><tbody>{proposal.after.scenes.map((entry, index) => <tr key={entry.scene.id}><th>Scene {entry.scene.number}</th><td>{seconds(proposal!.before.scenes[index].sourceStartMs / 1000)}–{seconds(proposal!.before.scenes[index].sourceEndMs / 1000)}</td><td>{seconds(entry.sourceStartMs / 1000)}–{seconds(entry.sourceEndMs / 1000)}</td></tr>)}</tbody></table></div>
        {!!scene.captions?.length && <div className="narration-adjustment-table"><table><caption>이 장면 안의 자막 시간 변경 전후</caption><thead><tr><th>자막</th><th>현재</th><th>변경 후</th></tr></thead><tbody>{scene.captions.map((block, index) => {
          const next = proposal!.project.scenes.find(item => item.id === scene.id)!.captions![index]; const start = scene.start_sec ?? 0;
          return <tr key={block.id || index}><th>{block.text}</th><td>{seconds(block.start_sec - start)}–{seconds(block.end_sec - start)}</td><td>{seconds(next.start_sec - start)}–{seconds(next.end_sec - start)}</td></tr>;
        })}</tbody></table></div>}
      </>}
      {proposalError && <div className="error-banner" role="alert">{proposalError}</div>}
      <div className="narration-actions"><button className="btn primary" disabled={busy || !proposal} onClick={() => void apply()}>{busy && <LoaderCircle className="spin" size={15} />}시간 조정 적용</button><button className="btn ghost" disabled={busy} onClick={() => { const value = pendingRef.current; setPending(null); setError(""); if (value) void discard(value); }}>취소</button></div>
      <small>시간 변경은 실행 취소 한 번으로 되돌립니다. 적용한 녹음 파일은 보관됩니다.</small>
    </section>}
    <small className="narration-hint">MP3·WAV·M4A·MP4·WebM · 30MB·120초 이하. 긴 녹음은 저장 전 시간 조정안을 확인합니다. 목소리가 나올 때 배경음악은 자동으로 작아집니다.</small>
    <SceneNarrationGenerator project={project} scene={scene} disabled={busy || recording || !!pending} onChange={onChange} onApply={onGeneratedNarration} onBusyChange={setGenerationBusy} />
    {error && <div className="error-banner" role="alert">{error}</div>}
  </div>;
}
