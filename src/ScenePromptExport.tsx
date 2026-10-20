import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, LoaderCircle, ScrollText } from "lucide-react";
import { downloadBlob } from "./platform";
import { scenePromptBundle } from "./scene-prompt-export";
import type { ProjectData } from "./types";

type Selection = { open: boolean; ids: string[] };
const empty = (): Selection => ({ open: false, ids: [] });

// UI selections stay outside project JSON and survive opening a scene editor.
export function useScenePromptExport(project: ProjectData | null) {
  const drafts = useRef(new Map<string, Selection>());
  const [, redraw] = useState(0);
  const id = project?.id || "", selection = drafts.current.get(id) || empty();
  const update = (change: Partial<Selection>) => { if (!id) return; drafts.current.set(id, { ...selection, ...change }); redraw(value => value + 1); };
  return { ...selection, setOpen: (open: boolean) => update({ open }), select: (ids: string[]) => update({ ids: [...new Set(ids)] }) };
}
export type ScenePromptExportController = ReturnType<typeof useScenePromptExport>;

export function ScenePromptExport({ project, selection }: { project: ProjectData; selection: ScenePromptExportController }) {
  const bundle = useMemo(() => scenePromptBundle(project, selection.ids), [project, selection.ids]);
  const [receipt, setReceipt] = useState<{ text: string; action: "copy" | "download" }>(), [error, setError] = useState(""), [copying, setCopying] = useState(false);
  const alive = useRef(true), working = useRef(false), preview = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const missing = bundle.rows.filter(row => row.valid && row.hasVisual === false);
  const copy = async () => {
    if (!bundle.text || working.current) return;
    working.current = true; setCopying(true); setError(""); setReceipt(undefined);
    const text = bundle.text;
    try { await navigator.clipboard.writeText(text); if (alive.current) setReceipt({ text, action: "copy" }); }
    catch { if (alive.current) { setError("자동 복사에 실패했습니다. 아래 프롬프트 묶음을 직접 복사하거나 TXT로 내려받아 주세요."); preview.current?.focus(); preview.current?.select(); } }
    finally { working.current = false; if (alive.current) setCopying(false); }
  };
  const download = () => {
    if (!bundle.text) return;
    try { downloadBlob(new Blob([bundle.text], { type: "text/plain;charset=utf-8" }), bundle.filename); setReceipt({ text: bundle.text, action: "download" }); setError(""); }
    catch { setError("TXT를 내려받지 못했습니다. 프롬프트 묶음을 복사하거나 다시 시도해 주세요."); }
  };
  const latestReceipt = !!receipt && receipt.text === bundle.text;
  return <section className="panel scene-prompt-export" aria-label="이미지 제작 프롬프트 묶음">
    <div className="prompt-export-heading"><div><h3><ScrollText size={18} /> 이미지 제작 프롬프트 묶음</h3><p>필요한 장면의 최신 프롬프트를 모아 이미지 제작에 사용하세요.</p></div><button type="button" className="btn ghost" aria-expanded={selection.open} aria-controls="scene-prompt-export-content" onClick={() => selection.setOpen(!selection.open)}>{selection.open ? "프롬프트 접기" : "프롬프트 모으기"}</button></div>
    {selection.open && <div id="scene-prompt-export-content">
      <div className="prompt-export-selection"><button type="button" className="btn ghost" disabled={!missing.length} onClick={() => selection.select(missing.map(row => row.scene.id))}>화면 미선택 장면 선택 · {missing.length}개</button><button type="button" className="btn ghost" disabled={!bundle.rows.some(row => row.valid)} onClick={() => selection.select(bundle.rows.filter(row => row.valid).map(row => row.scene.id))}>전체 장면 선택</button><button type="button" className="btn ghost" disabled={!selection.ids.length} onClick={() => selection.select([])}>선택 해제</button><span aria-live="polite">선택 {bundle.selected.length}/{bundle.rows.length}개 장면</span></div>
      <p className="prompt-export-hint">화면 미선택 선택과 전체 선택은 현재 선택 목록을 바꿉니다. 원하는 장면은 개별 선택할 수 있습니다. 인물 외형·구도·공통 스타일을 현재 편집 내용으로 조합합니다.</p>
      <div className="prompt-export-rows" role="group" aria-label="프롬프트를 내보낼 장면">{bundle.rows.map(row => <div className="prompt-export-row" key={row.scene.id}>
        <label><input type="checkbox" aria-label={`Scene ${row.scene.number} 프롬프트 선택`} checked={selection.ids.includes(row.scene.id)} disabled={!row.valid} onChange={event => selection.select(event.target.checked ? [...selection.ids, row.scene.id] : selection.ids.filter(id => id !== row.scene.id))} /><span><strong>Scene {row.scene.number} · {row.scene.title}</strong><small>{!row.valid ? "장면 이미지 내용을 먼저 입력해 주세요." : row.hasVisual === undefined ? "화면 연결 확인 필요" : row.hasVisual ? "현재 화면 있음" : "현재 화면 미선택"}</small></span></label>
        <label className="prompt-export-filename"><span>권장 이미지 파일명</span><input readOnly aria-label={`Scene ${row.scene.number} 권장 이미지 파일명`} value={row.filename} onFocus={event => event.currentTarget.select()} /></label>
      </div>)}</div>
      {!!bundle.excluded.length && <p className="prompt-export-warning" role="alert">선택한 장면 {bundle.excluded.length}개가 없어졌거나 이미지 내용이 비어 있어 묶음에서 제외했습니다. 선택 목록을 확인해 주세요.</p>}
      <div className="prompt-export-actions"><button type="button" className="btn ghost" disabled={!bundle.text || copying} onClick={() => void copy()}>{copying ? <LoaderCircle size={14} className="spin" /> : latestReceipt && receipt.action === "copy" ? <Check size={14} /> : <Copy size={14} />}{copying ? "복사 중…" : latestReceipt && receipt.action === "copy" ? "묶음 복사됨" : "프롬프트 묶음 복사"}</button><button type="button" className="btn ghost" disabled={!bundle.text} onClick={download}><Download size={14} /> 프롬프트 TXT 다운로드</button></div>
      {error && <p className="prompt-export-warning" role="alert">{error}</p>}
      {receipt && <p className="prompt-export-feedback" role="status">{latestReceipt ? receipt.action === "copy" ? "현재 프롬프트 묶음을 복사했습니다." : "현재 프롬프트 묶음의 TXT 다운로드를 시작했습니다." : "선택이나 제작 내용이 바뀌었습니다. 최신 묶음을 다시 복사하거나 내려받아 주세요."}</p>}
      {bundle.text ? <label className="prompt-export-preview">내보낼 프롬프트 묶음<textarea ref={preview} aria-label="내보낼 프롬프트 묶음" readOnly value={bundle.text} /></label> : <p className="prompt-export-empty">이미지를 제작할 장면을 선택하세요.</p>}
      <p className="prompt-export-hint">권장 파일명의 식별 부분을 유지하고 실제 이미지 형식에 맞게 확장자를 바꾸세요. 결과 이미지는 아래 ‘이미지 일괄 배치’에서 연결안을 확인한 뒤 적용합니다. 선택 목록은 앱을 열어 둔 동안 프로젝트별로 유지됩니다.</p>
    </div>}
  </section>;
}
