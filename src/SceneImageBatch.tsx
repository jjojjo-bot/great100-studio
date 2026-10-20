import { useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { reviewScenes } from "./scene-review";
import type { ProjectData } from "./types";
import type { SceneImageBatchController } from "./useSceneImageBatch";

export function SceneImageBatch({ project, batch }: { project: ProjectData; batch: SceneImageBatchController }) {
  const [open, setOpen] = useState(batch.rows.length > 0);
  const [stopping, setStopping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => new Map(reviewScenes(project).map(item => [item.scene.id, item])), [project]);
  const ready = batch.rows.filter(row => row.status === "ready" && !!row.sceneId && items.has(row.sceneId));
  const failed = batch.rows.filter(row => row.status === "error" && !row.invalid && !!row.sceneId);
  const done = batch.rows.filter(row => row.status === "done").length;
  const locked = batch.busy || batch.preparing;
  return <section className="panel scene-image-batch" aria-label="이미지 일괄 배치">
    <div className="batch-heading"><div><h3><ImagePlus size={18} /> 이미지 일괄 배치</h3><p>준비한 이미지를 장면별로 연결합니다. 기존 후보와 원본 파일은 보존합니다.</p></div><button type="button" className="btn ghost" aria-expanded={open} aria-controls="batch-image-content" onClick={() => setOpen(value => !value)}>{open ? "접기" : "이미지 가져오기"}</button></div>
    {open && <div id="batch-image-content">
      <div className="batch-toolbar"><input ref={input} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="일괄 배치 이미지 파일 선택" disabled={locked} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void batch.addFiles(files); }} /><button type="button" className="btn ghost" disabled={locked} onClick={() => input.current?.click()}><Upload size={15} /> 파일 추가</button><small>PNG·JPEG·WebP · 각 12MB · 최대 40장·합계 120MB</small>{!!batch.rows.length && <button type="button" className="btn ghost" disabled={locked} onClick={() => batch.remove()}>목록 비우기</button>}</div>
      <p className="batch-hint">scene_01.png, 장면2.jpg, 03_서재.webp처럼 이름을 붙이면 장면을 제안합니다. 연결되지 않은 파일은 장면을 직접 선택해 주세요. 선택하지 않은 파일은 적용하지 않습니다.</p>
      <p className="batch-hint">프롬프트 묶음의 권장 파일명은 장면 순서가 바뀌어도 같은 장면을 찾습니다. 다른 프로젝트이거나 없어진 장면이면 직접 연결을 확인해 주세요.</p>
      {batch.error && <p className="error-banner" role="alert">{batch.error}</p>}
      {!!batch.rows.length && <>
        <fieldset className="batch-selection" disabled={locked}><legend>현재 화면 처리</legend><label><input type="radio" name="batch-selection" checked={batch.selection === "keep"} onChange={() => batch.setSelection("keep")} /> 기존 화면 유지 · 화면이 없으면 새 이미지 선택</label><label><input type="radio" name="batch-selection" checked={batch.selection === "replace"} onChange={() => batch.setSelection("replace")} /> 새 이미지로 교체</label></fieldset>
        <p className="batch-hint">같은 장면에 여러 파일을 연결하면 첫 이미지를 선택하고 나머지는 후보로 추가합니다. 교체는 장면 전체 화면에 적용되며, 실행 취소해도 업로드한 후보는 남습니다.</p>
        <ol className="batch-rows">{batch.rows.map((row, index) => {
          const target = items.get(row.sceneId);
          const primary = batch.rows.find(item => item.sceneId === row.sceneId && !item.invalid)?.id === row.id;
          const label = row.status === "checking" ? "이미지 확인 중" : row.status === "uploading" ? "업로드 중" : row.status === "done" ? "연결 완료" : row.status === "error" ? "확인 필요" : target ? "적용 대기" : "장면 선택 필요";
          return <li className={`batch-row batch-${row.status}`} key={row.id}>
            <div className="batch-file">{row.invalid ? <span className="batch-invalid-image">미리보기 없음</span> : <img src={row.previewUrl} alt={`업로드할 이미지 ${index + 1}`} />}<div><strong>{row.file.name}</strong><small>{(row.file.size / 1_000_000).toFixed(2)} MB</small></div></div>
            <label className="batch-target">연결할 장면<select aria-label={`파일 ${index + 1} 연결 장면`} value={row.sceneId} disabled={locked || row.status === "done" || row.invalid} onChange={event => batch.setScene(row.id, event.target.value)}><option value="">연결 안 함</option>{row.sceneId && !target && <option value={row.sceneId}>없어진 장면 · 다시 선택</option>}{project.scenes.map(scene => <option key={scene.id} value={scene.id}>Scene {scene.number} · {scene.title.slice(0, 60)}</option>)}</select></label>
            <div className="batch-current">{target?.previewUrl ? <img src={target.previewUrl} alt={`파일 ${index + 1} 연결 장면의 현재 화면`} loading="lazy" /> : <span>{target?.hasVisual ? "여러 화면 또는 동영상" : "현재 화면 없음"}</span>}<small>{target ? row.status === "done" ? "적용 후 현재 화면" : !primary || target.hasVisual && batch.selection === "keep" ? "후보로 추가 · 기존 화면 유지" : "새 이미지 선택 예정" : "연결할 장면을 선택하세요"}</small></div>
            <div className="batch-row-status"><strong>{row.status === "checking" || row.status === "uploading" ? <LoaderCircle size={13} className="spin" /> : null}{label}</strong>{row.message && <small>{row.message}</small>}</div>
            <button type="button" className="btn ghost" disabled={locked} aria-label={`파일 ${index + 1} 목록에서 제거`} title="목록에서만 제거하며 이미 연결한 후보는 유지합니다" onClick={() => batch.remove(row.id)}><Trash2 size={14} /></button>
          </li>;
        })}</ol>
        <div className="batch-apply"><p role="status" aria-live="polite">연결 완료 {done}/{batch.rows.length} · 적용 대기 {ready.length} · 재시도 가능 {failed.length}{batch.preparing ? " · 이미지 확인 중…" : ""}{batch.busy ? batch.workingProjectId === project.id ? " · 업로드 중…" : " · 다른 프로젝트 업로드 중…" : ""}</p><div><button type="button" className="btn primary" disabled={locked || !ready.length} onClick={() => { setStopping(false); void batch.run(); }}>연결안 적용 · {ready.length}개</button>{!!failed.length && <button type="button" className="btn ghost" disabled={locked} onClick={() => { setStopping(false); void batch.run(true); }}>실패한 파일만 재시도</button>}{batch.busy && <button type="button" className="btn ghost" disabled={stopping} onClick={() => { batch.stop(); setStopping(true); }}>{stopping ? "현재 파일 완료 후 중단합니다" : "현재 파일 완료 후 중단"}</button>}</div></div>
        <p className="batch-hint">목록과 실패 재시도 상태는 앱을 열어 둔 동안 유지합니다. 적용 전 장면 연결과 현재 화면을 확인해 주세요. 프로젝트 저장 실패는 상단의 ‘저장 다시 시도’로 처리하며 이미 연결한 파일은 다시 업로드하지 않습니다.</p>
      </>}
    </div>}
  </section>;
}
