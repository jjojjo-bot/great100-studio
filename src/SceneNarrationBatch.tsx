import { useEffect, useRef, useState } from "react";
import { FileAudio, LoaderCircle, Trash2, Upload } from "lucide-react";
import { getSceneNarration } from "./platform";
import { batchNarrationFingerprint, narrationRowState, type NarrationBatchRow } from "./scene-narration-batch";
import { proposeNarrationTiming, timingFingerprint, type CaptionTimingMode } from "./timeline";
import type { SceneNarrationBatchController } from "./useSceneNarrationBatch";
import type { ProjectData, Scene } from "./types";

const seconds = (value: number) => `${Number(value.toFixed(3))}초`;

function CurrentVoice({ project, scene }: { project: ProjectData; scene: Scene }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const active = useRef(true), objectUrl = useRef(""), requestVersion = useRef(0);
  const key = batchNarrationFingerprint(scene);
  useEffect(() => { active.current = true; setUrl(""); setError(""); setLoading(false); return () => { active.current = false; requestVersion.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ""; }; }, [project.id, key]);
  const load = async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const blob = await getSceneNarration(project, scene);
      if (!blob?.size) throw new Error("기존 녹음을 찾지 못했습니다.");
      if (!active.current || version !== requestVersion.current) return;
      const nextUrl = URL.createObjectURL(blob); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = nextUrl; setUrl(nextUrl);
    } catch { if (active.current && version === requestVersion.current) setError("기존 녹음을 불러오지 못했습니다. 다시 확인해 주세요."); }
    finally { if (active.current && version === requestVersion.current) setLoading(false); }
  };
  return <div>{url ? <audio controls preload="none" src={url} aria-label={`Scene ${scene.number} 기존 녹음 미리듣기`} /> : <button type="button" className="btn ghost" disabled={loading} onClick={() => void load()}>{loading ? <LoaderCircle size={13} className="spin" /> : null}기존 녹음 듣기</button>}{error && <small>{error}</small>}</div>;
}

function NarrationTimingReview({ project, row, batch, onClose }: { project: ProjectData; row: NarrationBatchRow; batch: SceneNarrationBatchController; onClose: () => void }) {
  const [mode, setMode] = useState<CaptionTimingMode>("keep");
  const state = narrationRowState(project, batch.rows, row, batch.selection), scene = state.scene;
  let proposal: ReturnType<typeof proposeNarrationTiming> | undefined, error = state.problem;
  if (!error && scene && row.prepared) { try { proposal = proposeNarrationTiming(project, scene.id, row.prepared.duration, mode); } catch (cause) { error = (cause as Error).message; } }
  return <section className="narration-adjustment narration-batch-timing" aria-label="일괄 녹음 시간 조정 검토">
    <div className="batch-heading"><div><strong>{scene ? `Scene ${scene.number} · ${scene.title}` : "연결할 장면 확인"} · 시간 조정 검토</strong><p>{row.file.name} · {seconds(row.prepared?.duration || 0)}</p></div><button type="button" className="btn ghost" disabled={batch.busy} onClick={onClose}>시간 조정 닫기</button></div>
    {proposal && scene && <><p>장면 {seconds(scene.duration ?? 10)} → <b>{seconds(proposal.duration)}</b> · 전체 영상 {seconds(proposal.before.totalDuration)} → <b>{seconds(proposal.after.totalDuration)}</b></p><fieldset disabled={batch.busy}><legend>이 장면의 자막 시간</legend><label><input type="radio" name="batch-narration-timing" checked={mode === "keep"} onChange={() => setMode("keep")} /> 자막 시간 유지</label><label><input type="radio" name="batch-narration-timing" checked={mode === "scale"} onChange={() => setMode("scale")} /> 자막 비율 재배치</label></fieldset>
      <small>뒤 장면과 자막 시간도 함께 이동합니다. 비율 재배치는 실제 발화 시점을 인식하는 정렬이 아닙니다.</small>
      <details><summary>장면·자막 시간 변경 보기</summary><div className="narration-adjustment-table"><table><caption>장면 시간 변경 전후</caption><thead><tr><th>장면</th><th>현재</th><th>변경 후</th></tr></thead><tbody>{proposal.after.scenes.map((entry, index) => <tr key={entry.scene.id}><th>Scene {entry.scene.number}</th><td>{seconds(proposal!.before.scenes[index].sourceStartMs / 1000)}–{seconds(proposal!.before.scenes[index].sourceEndMs / 1000)}</td><td>{seconds(entry.sourceStartMs / 1000)}–{seconds(entry.sourceEndMs / 1000)}</td></tr>)}</tbody></table></div>
      {!!scene.captions?.length && <div className="narration-adjustment-table"><table><caption>이 장면 안의 자막 시간 변경</caption><thead><tr><th>자막</th><th>현재</th><th>변경 후</th></tr></thead><tbody>{scene.captions.map((caption, index) => { const next = proposal!.project.scenes.find(item => item.id === scene.id)!.captions![index], origin = scene.start_sec ?? 0; return <tr key={caption.id || index}><th>{caption.text}</th><td>{seconds(caption.start_sec - origin)}–{seconds(caption.end_sec - origin)}</td><td>{seconds(next.start_sec - origin)}–{seconds(next.end_sec - origin)}</td></tr>; })}</tbody></table></div>}</details></>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <button type="button" className="btn primary" disabled={batch.busy || batch.preparing || !proposal || !state.ready || !state.long} onClick={() => void batch.run(false, { id: row.id, timing: { expected: timingFingerprint(project), mode } })}>{row.status === "applying" ? <LoaderCircle size={14} className="spin" /> : null}시간 조정·녹음 적용</button><small>녹음 교체와 시간 변경을 함께 실행 취소할 수 있습니다. 이전 녹음과 새 원본은 보관합니다.</small>
  </section>;
}

export function SceneNarrationBatch({ project, batch }: { project: ProjectData; batch: SceneNarrationBatchController }) {
  const [open, setOpen] = useState(batch.rows.length > 0), [reviewId, setReviewId] = useState("");
  const input = useRef<HTMLInputElement>(null), locked = batch.busy || batch.preparing;
  const ready = batch.rows.filter(row => row.status === "ready" && narrationRowState(project, batch.rows, row, batch.selection).ready && !narrationRowState(project, batch.rows, row, batch.selection).long);
  const failed = batch.rows.filter(row => row.status === "error" && narrationRowState(project, batch.rows, row, batch.selection).ready && !narrationRowState(project, batch.rows, row, batch.selection).long);
  const done = batch.rows.filter(row => row.status === "done").length;
  const review = batch.rows.find(row => row.id === reviewId && row.status !== "done");
  return <section className="panel scene-narration-batch" aria-label="내레이션 일괄 배치">
    <div className="batch-heading"><div><h3><FileAudio size={18} /> 내레이션 일괄 배치</h3><p>녹음 파일의 장면과 길이를 확인한 뒤 적용합니다. 기존 원본과 편집 이력을 보존합니다.</p></div><button type="button" className="btn ghost" aria-expanded={open} aria-controls="batch-narration-content" onClick={() => setOpen(value => !value)}>{open ? "녹음 목록 접기" : "녹음 가져오기"}</button></div>
    {open && <div id="batch-narration-content"><div className="batch-toolbar"><input ref={input} className="file-input" type="file" multiple disabled={locked} accept=".mp3,.wav,.m4a,.mp4,.webm,audio/*,video/mp4" aria-label="일괄 내레이션 파일 선택" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void batch.addFiles(files); }} /><button type="button" className="btn ghost" disabled={locked} onClick={() => input.current?.click()}><Upload size={15} /> 녹음 파일 추가</button><small>MP3·WAV·M4A·MP4·WebM · 각 30MB·120초 · 최대 40개·합계 120MB</small>{!!batch.rows.length && <button type="button" className="btn ghost" disabled={locked} onClick={() => batch.remove()}>녹음 목록 비우기</button>}</div>
      <p className="batch-hint">scene_01.wav, 장면2.mp3처럼 이름을 붙이면 현재 장면 번호로 연결안을 제안합니다. Great100 권장 파일명의 식별 정보도 사용할 수 있습니다. 연결안을 확인한 뒤 적용하세요.</p>
      {batch.error && <p className="error-banner" role="alert">{batch.error}</p>}
      {!!batch.rows.length && <><fieldset className="batch-selection" disabled={locked}><legend>현재 녹음 처리</legend><label><input type="radio" name="narration-batch-selection" checked={batch.selection === "keep"} onChange={() => batch.setSelection("keep")} /> 기존 녹음 유지 · 녹음 없는 장면만 적용</label><label><input type="radio" name="narration-batch-selection" checked={batch.selection === "replace"} onChange={() => batch.setSelection("replace")} /> 새 녹음으로 교체</label></fieldset><p className="batch-hint">교체는 장면의 모든 녹음 구간을 파일 하나로 바꿉니다. 장면보다 긴 파일은 시간 조정 검토에서 개별 확정하세요. 같은 장면에는 파일 하나만 연결합니다.</p>
      <ol className="narration-batch-rows">{batch.rows.map((row, index) => { const state = narrationRowState(project, batch.rows, row, batch.selection); return <li className={`narration-batch-row narration-batch-${row.status}`} key={row.id}>
        <div className="narration-batch-file"><strong>{row.file.name}</strong><small>{(row.file.size / 1_000_000).toFixed(2)}MB{row.prepared ? ` · 새 녹음 ${seconds(row.prepared.duration)}` : ""}</small>{row.previewUrl && <audio controls preload="none" src={row.previewUrl} aria-label={`녹음 파일 ${index + 1} 새 녹음 미리듣기`} />}</div>
        <div className="narration-batch-target"><label>연결할 장면<select aria-label={`녹음 파일 ${index + 1} 연결 장면`} disabled={locked || row.invalid || row.status === "done"} value={row.sceneId} onChange={event => batch.setScene(row.id, event.target.value)}><option value="">연결 안 함</option>{row.sceneId && !state.scene && <option value={row.sceneId}>없어진 장면 · 다시 선택</option>}{project.scenes.map(scene => <option key={scene.id} value={scene.id}>Scene {scene.number} · {scene.title}</option>)}</select></label>{state.scene && <small>장면 {seconds(state.scene.duration ?? 10)} · {state.hasNarration ? "기존 녹음 있음" : "기존 녹음 없음"}</small>}{state.scene && state.hasNarration && <CurrentVoice key={`${project.id}:${state.scene.id}`} project={project} scene={state.scene} />}</div>
        <div className="narration-batch-status"><strong>{row.status === "checking" || row.status === "applying" ? <LoaderCircle size={13} className="spin" /> : null}{row.status === "done" ? "녹음 적용 완료" : row.status === "checking" ? "녹음 확인 중" : row.status === "applying" ? "녹음 저장·연결 중" : state.problem ? "연결 확인 필요" : state.long ? "시간 조정 필요" : row.status === "error" ? "재시도 가능" : "적용 대기"}</strong><small>{row.message || (row.status === "done" ? "" : state.problem)}</small>{state.ready && state.long && <button type="button" className="btn ghost" disabled={locked} aria-label={`녹음 파일 ${index + 1} 시간 조정 검토`} onClick={() => setReviewId(row.id)}>시간 조정 검토</button>}</div>
        <button type="button" className="btn ghost" disabled={locked} aria-label={`녹음 파일 ${index + 1} 목록에서 제거`} onClick={() => batch.remove(row.id)}><Trash2 size={14} /></button>
      </li>; })}</ol>
      <div className="batch-apply"><p role="status">녹음 적용 {done}/{batch.rows.length} · 적용 대기 {ready.length} · 재시도 가능 {failed.length}{batch.preparing ? " · 파일 확인 중…" : ""}{batch.busy ? batch.workingProjectId === project.id ? " · 녹음 연결 중…" : " · 다른 프로젝트 녹음 연결 중…" : ""}</p><div><button type="button" className="btn primary" disabled={locked || !ready.length} onClick={() => void batch.run()}>녹음 연결안 적용 · {ready.length}개</button>{!!failed.length && <button type="button" className="btn ghost" disabled={locked} onClick={() => void batch.run(true)}>실패한 녹음만 재시도</button>}{batch.busy && <button type="button" className="btn ghost" onClick={batch.stop}>현재 녹음 완료 후 중단</button>}</div></div>
      {review && <NarrationTimingReview key={review.id} project={project} row={review} batch={batch} onClose={() => setReviewId("")} />}
      <p className="batch-hint">목록은 앱을 열어 둔 동안 프로젝트별로 유지합니다. 프로젝트 저장만 실패했다면 상단 ‘저장 다시 시도’를 사용하세요. 저장한 원본은 재시도에서 재사용하며 목록 제거는 보관된 원본을 삭제하지 않습니다.</p></>}
    </div>}
  </section>;
}
