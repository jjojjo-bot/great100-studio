import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { discardSceneNarration, inspectSceneNarration, isTauri, savePreparedNarration, type PreparedNarration } from "./platform";
import { generateSceneNarration, generatedApplyFingerprint, MAX_NARRATION_CHARACTERS, NARRATION_PACES, NARRATION_VOICES, narrationScript, narrationSelectionFingerprint, sameNarrationText, type GeneratedNarrationRequest } from "./narration-generation";
import { proposeNarrationTiming, type CaptionTimingMode } from "./timeline";
import type { EditOptions } from "./editor-history";
import type { NarrationGeneration, NarrationPace, ProjectData, Scene, SceneNarrationAudio } from "./types";

type Preview = { prepared: PreparedNarration; generation: NarrationGeneration; fingerprint: string; saved?: SceneNarrationAudio };
const seconds = (value: number) => `${Number(value.toFixed(3))}초`;

export function SceneNarrationGenerator({ project, scene, disabled, onChange, onApply, onBusyChange }: {
  project: ProjectData; scene: Scene; disabled: boolean;
  onChange: (scene: Scene, options?: EditOptions) => void;
  onApply: (request: GeneratedNarrationRequest) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [voice, setVoice] = useState(scene.narration_audio?.generation?.voice || "alloy");
  const [pace, setPace] = useState<NarrationPace>(scene.narration_audio?.generation?.pace || "normal");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [mode, setMode] = useState<CaptionTimingMode>("scale");
  const current = useRef({ project, scene, voice, pace, onApply, onBusyChange }); current.current = { project, scene, voice, pace, onApply, onBusyChange };
  const pending = useRef<Preview | null>(null);
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const active = useRef(true);
  const script = narrationScript(scene);
  const changePreview = (value: Preview | null) => { pending.current = value; if (active.current) setPreview(value); };
  const markBusy = (value: boolean) => { working.current = value; if (active.current) { setBusy(value); current.current.onBusyChange(value); } };
  const discard = async (value: Preview | null) => {
    if (value?.saved) await discardSceneNarration(project, scene, value.saved).catch(() => {});
  };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); current.current.onBusyChange(false); void discard(pending.current); };
  }, []);
  useEffect(() => {
    if (!preview) { setUrl(""); return; }
    const value = URL.createObjectURL(preview.prepared.file); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [preview?.prepared.file]);

  const stale = !!preview && (preview.fingerprint !== narrationSelectionFingerprint(project, scene)
    || preview.generation.voice !== voice || preview.generation.pace !== pace);
  const mismatch = scene.narration_audio?.generation && !sameNarrationText(script, scene.narration_audio.generation.input_text);
  let proposal: ReturnType<typeof proposeNarrationTiming> | undefined;
  let proposalError = "";
  if (preview && adjust) {
    try { proposal = proposeNarrationTiming(project, scene.id, preview.prepared.duration, mode); }
    catch (cause) { proposalError = (cause as Error).message; }
  }
  const tooLong = !!preview && preview.prepared.duration > (scene.duration ?? 10);

  const generate = async () => {
    if (working.current || disabled) return;
    markBusy(true); setError("");
    const owner = current.current;
    const fingerprint = narrationSelectionFingerprint(owner.project, owner.scene);
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 115_000);
    try {
      await discard(pending.current); changePreview(null);
      const result = await generateSceneNarration(owner.project, owner.scene, owner.voice, owner.pace, abort.signal);
      if (!active.current || abort.signal.aborted) return;
      const prepared = await inspectSceneNarration(result.file);
      if (!active.current || abort.signal.aborted) return;
      changePreview({ prepared, generation: result.generation, fingerprint });
      setAdjust(prepared.duration > (current.current.scene.duration ?? 10)); setMode("scale");
    } catch (cause) { if (active.current) setError(abort.signal.aborted ? "생성 대기를 중단했습니다. 서버의 요청은 이미 처리됐을 수 있으며, 다시 생성하면 추가 사용량이 발생할 수 있습니다." : (cause as Error).message); }
    finally { window.clearTimeout(timeout); controller.current = null; markBusy(false); }
  };

  const apply = async () => {
    if (!preview || working.current || disabled || stale || adjust && !proposal || !adjust && tooLong) return;
    const owner = current.current;
    const expected = generatedApplyFingerprint(owner.project, owner.scene);
    const selectedOptions = JSON.stringify([owner.voice, owner.pace]);
    const durationProject = adjust ? proposal!.project : owner.project;
    const target = durationProject.scenes.find(item => item.id === owner.scene.id)!;
    markBusy(true); setError("");
    let value = preview;
    try {
      if (!value.saved) {
        const saved = await savePreparedNarration(durationProject, target, value.prepared);
        value = { ...value, saved: { ...saved, generation: value.generation } }; changePreview(value);
      }
      if (!active.current) { await discard(value); return; }
      const fresh = current.current;
      if (generatedApplyFingerprint(fresh.project, fresh.scene) !== expected || JSON.stringify([fresh.voice, fresh.pace]) !== selectedOptions) throw new Error("대본·시간·녹음이 변경되었습니다. 최신 내용을 확인한 뒤 다시 적용해 주세요.");
      fresh.onApply({ projectId: owner.project.id, sceneId: owner.scene.id, expected, narration: value.saved!, adjustDuration: adjust, mode });
      changePreview(null);
    } catch (cause) { if (active.current) setError((cause as Error).message); }
    finally { markBusy(false); }
  };

  const blocked = disabled || busy;
  return <section className="narration-generator" aria-label="AI 내레이션 생성">
    <strong><Sparkles size={15} /> AI 내레이션</strong>
    <label>내레이션 대본<textarea aria-label="AI 내레이션 대본" rows={3} value={script} readOnly={!!scene.captions?.length} disabled={blocked}
      onChange={event => onChange({ ...scene, narration: event.target.value })} /></label>
    <small>{scene.captions?.length ? "현재 자막 문구를 순서대로 읽습니다. 대본은 자막 편집에서 수정하세요." : "대본을 수정해도 원본 제작안은 보존됩니다."} {script.length}/{MAX_NARRATION_CHARACTERS}자</small>
    <div className="narration-generator-options"><label>목소리<select aria-label="AI 내레이션 목소리" value={voice} disabled={blocked} onChange={event => setVoice(event.target.value)}>{NARRATION_VOICES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>낭독 속도<select aria-label="AI 내레이션 낭독 속도" value={pace} disabled={blocked} onChange={event => setPace(event.target.value as NarrationPace)}>{NARRATION_PACES.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label></div>
    <small>속도는 낭독 방식에 대한 지시입니다. 실제 음성 길이는 생성 후 확인합니다. 생성·재생성할 때 사용량이 발생하며 자동 재시도하지 않습니다.</small>
    <div className="narration-actions"><button className="btn primary" disabled={blocked || isTauri() || !script || script.length > MAX_NARRATION_CHARACTERS} onClick={() => void generate()}>{busy && <LoaderCircle className="spin" size={15} />}{busy ? "처리 중" : preview || scene.narration_audio?.generation ? "이 장면 음성 다시 생성" : "이 장면 음성 생성"}</button>{controller.current && busy && <button className="btn ghost" onClick={() => controller.current?.abort()}>생성 대기 중단</button>}</div>
    {isTauri() && <small>AI 내레이션 생성은 로그인한 웹에서 사용할 수 있습니다. 데스크톱에서는 녹음·파일 업로드를 사용하세요.</small>}
    {mismatch && <div className="error-banner" role="status">대본이 변경되어 현재 AI 음성과 다릅니다. 이 장면 음성을 다시 생성해 주세요.</div>}
    {preview && <section className="narration-adjustment" aria-label="생성한 AI 음성 검토">
      <strong>생성한 AI 음성 · {seconds(preview.prepared.duration)}</strong><p>AI가 생성한 음성입니다. 내용을 듣고 적용해 주세요. 적용 전까지 기존 녹음은 유지됩니다.</p>
      {url && <audio controls preload="metadata" src={url} aria-label="생성한 AI 내레이션 미리듣기" />}
      <details><summary>생성 대본과 사용량</summary><p>{preview.generation.transcript}</p><small>{preview.generation.model} · {preview.generation.voice} · 요청 {preview.generation.request_id}{preview.generation.usage ? ` · 입력 ${preview.generation.usage.input_tokens} / 출력 ${preview.generation.usage.output_tokens} 토큰` : " · 사용량 미제공"}</small></details>
      {stale && <div className="error-banner" role="alert">생성 이후 대본·녹음·목소리·속도가 변경되었습니다. 현재 내용으로 다시 생성해 주세요.</div>}
      <label className="narration-check"><input type="checkbox" checked={adjust} disabled={blocked} onChange={event => setAdjust(event.target.checked)} /> 음성 길이에 맞추기</label>
      {tooLong && !adjust && <div className="error-banner" role="alert">음성이 장면보다 깁니다. 음성 길이에 맞추기를 선택해 주세요.</div>}
      {adjust && <><fieldset disabled={blocked}><legend>자막 시간</legend><label><input type="radio" name={`ai-timing-${scene.id}`} checked={mode === "keep"} onChange={() => setMode("keep")} /> 자막 시간 유지</label><label><input type="radio" name={`ai-timing-${scene.id}`} checked={mode === "scale"} onChange={() => setMode("scale")} /> 자막 비율 재배치</label></fieldset><small>비율 재배치는 추정 시간입니다. 실제 발화 시점을 인식하는 정렬은 아닙니다.</small>
        {proposal && <p>장면 {seconds(scene.duration ?? 10)} → {seconds(proposal.duration)} · 전체 영상 {seconds(proposal.before.totalDuration)} → {seconds(proposal.after.totalDuration)}</p>}{proposalError && <div className="error-banner" role="alert">{proposalError}</div>}</>}
      <div className="narration-actions"><button className="btn primary" disabled={blocked || stale || adjust && !proposal || !adjust && tooLong} onClick={() => void apply()}>이 음성 적용</button><button className="btn ghost" disabled={blocked} onClick={() => { const value = pending.current; changePreview(null); setError(""); void discard(value); }}>생성한 음성 취소</button></div>
    </section>}
    {scene.narration_audio?.generation && <small>적용된 AI 음성 · {scene.narration_audio.generation.voice} · {scene.narration_audio.generation.model}</small>}
    {error && <div className="error-banner" role="alert">{error}</div>}
  </section>;
}
