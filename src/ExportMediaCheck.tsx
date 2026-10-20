import { CheckCircle2, ClipboardCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { currentCheckResult, type CheckLocation } from "./export-media-check";
import type { ExportMediaCheckController } from "./useExportMediaCheck";

export function ExportMediaCheck({ check, onOpen }: { check: ExportMediaCheckController; onOpen: (location: CheckLocation) => void }) {
  const { plan, busy, progress, checked, stale, stopped, passed, failed, results } = check;
  const remaining = plan.items.length - passed - failed;
  const open = (location: CheckLocation) => <button type="button" className="btn ghost" onClick={() => onOpen(location)}>{location.target === "scene" ? `${location.label} 편집` : location.target === "thumbnail" ? "썸네일 편집" : location.target === "music" ? "배경음악 편집" : "제작안 확인"}</button>;
  const failedItems = plan.items.filter(item => currentCheckResult(item, results[item.key]) && results[item.key]?.status === "error");
  return <section className="panel export-media-check" aria-label="MP4 출력 전 자료 점검">
    <div className="media-check-heading"><div><h3><ClipboardCheck size={18} /> MP4 출력 전 자료 점검</h3><p>출력에 연결된 원본과 동영상 대표 이미지·사용 구간을 확인합니다. 녹음은 선택 사항입니다.</p></div><div className="media-check-actions"><button type="button" className="btn ghost" disabled={busy} aria-label="전체 출력 자료 점검" onClick={() => void check.run()}>{busy ? <LoaderCircle className="spin" size={14} /> : <ClipboardCheck size={14} />}{checked || stale ? "전체 다시 점검" : "자료 점검"}</button>{failed > 0 && <button type="button" className="btn ghost" disabled={busy || stale} onClick={() => void check.run(true)}><RefreshCw size={14} /> 실패한 자료만 재검사</button>}{busy && <button type="button" className="btn ghost" onClick={check.stop}>점검 중단</button>}</div></div>
    <p className={`media-check-summary${checked && !failed && !plan.issues.length ? " media-check-ok" : ""}`} role={busy || checked || stale || stopped ? "status" : undefined}>{busy ? `${progress!.done}/${progress!.total}개 점검 중 · ${progress!.label}` : checked ? <>{!failed && !plan.issues.length && <CheckCircle2 size={14} />}점검 완료 · 통과 {passed} · 파일 문제 {failed} · 연결·설정 문제 {plan.issues.length}</> : stale ? "자료 연결이나 사용 구간이 바뀌었거나 점검이 중단되었습니다. 전체 자료를 다시 점검해 주세요." : stopped ? "점검을 중단했습니다. 다시 점검해 주세요." : "아직 점검하지 않았습니다. 자료 점검을 눌러 실제 파일을 확인하세요."}</p>
    {!!remaining && (busy || checked || stale || stopped) && <p className="media-check-note">미검사 또는 변경된 자료 {remaining}개</p>}
    {!!plan.issues.length && <div className="media-check-problems"><h4>연결·설정 확인</h4>{plan.issues.map((issue, index) => <div className="media-check-problem" key={index}><p>{issue.message}</p><div>{open(issue.location)}</div></div>)}</div>}
    {!!failedItems.length && <div className="media-check-problems" role="alert"><h4>읽지 못한 자료 · {failedItems.length}개</h4>{failedItems.map(item => <div className="media-check-problem" key={item.key}><strong>{item.asset.path.split(/[\\/]/).at(-1)}{item.kind === "poster" ? " · 동영상 대표 이미지" : ""}</strong><p>{results[item.key].message}</p><div>{item.locations.map((location, index) => <span key={index}>{open(location)}</span>)}</div></div>)}</div>}
    {!!plan.items.length && <details className="media-check-details"><summary>자료별 검사 결과 · {plan.items.length}개 검사 항목</summary><p className="media-check-note">여러 장면의 공통 원본은 한 번 검사합니다. 동영상 원본과 대표 이미지는 각각 확인합니다.</p><div className="media-check-list">{plan.items.map(item => {
      const result = results[item.key], current = currentCheckResult(item, result);
      return <div key={item.key}><strong>{current ? result.status === "passed" ? "통과" : "문제" : "미검사"}</strong><span>{item.asset.path.split(/[\\/]/).at(-1)}{item.kind === "poster" ? " · 대표 이미지" : ""}<small>{item.locations.map(location => location.label).join(" / ")}{current && result.status === "passed" ? ` · ${result.message}` : ""}</small></span></div>;
    })}</div></details>}
    <p className="media-check-note">점검 결과는 이 앱을 열어 둔 동안 유지됩니다. 파일은 점검 뒤에도 바뀔 수 있으며, MP4 인코딩 성공 여부는 실제 출력에서 확인합니다.</p>
  </section>;
}
