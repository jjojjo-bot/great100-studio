import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Image as ImageIcon, X } from "lucide-react";
import { allCandidates, candidateAssetId, collectMediaAssets, sceneComposition, visualSelectionFingerprint } from "./media-composition";
import { imageCandidates, imageUsage, initialComparisonIds, isCurrentImage, type ImageComparisonRequest, type ImageComparisonResult } from "./image-comparison";
import type { ImageCandidate, ProjectData, Scene } from "./types";
import { orderedScenes } from "./scene-order";

type Apply = (request: ImageComparisonRequest) => Promise<ImageComparisonResult>;

function CandidatePreview({ candidate, number, usage, picked, disabled, onPick, onReady }: { candidate: ImageCandidate; number: number; usage: string; picked: boolean; disabled: boolean; onPick: () => void; onReady: (ready: boolean) => void }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => { onReady(false); }, []);
  return <div className={`comparison-candidate${picked ? " is-picked" : ""}`}>
    <button type="button" className="comparison-pick" aria-label={`후보 ${number} 검토 선택`} aria-pressed={picked} disabled={failed || disabled} onClick={onPick}>
      {failed ? <span className="comparison-image-error"><ImageIcon size={24} />이미지를 불러오지 못했습니다.</span> : <img key={attempt} src={candidate.preview_url} alt={`비교 후보 ${number}`} onLoad={() => onReady(true)} onError={() => { setFailed(true); onReady(false); }} />}
      <span className="comparison-candidate-label"><strong>후보 {number}</strong><span>{usage && <em>{usage}</em>}{picked && <em><CheckCircle2 size={13} /> 검토 선택</em>}</span></span>
    </button>
    {failed && <button type="button" className="btn ghost" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>후보 {number} 이미지 다시 불러오기</button>}
  </div>;
}

function CurrentPreview({ url, number }: { url?: string; number: number }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt={`현재 화면 구간 ${number}`} onError={() => setFailed(true)} /> : <span><ImageIcon size={20} />미리보기 없음</span>;
}

function CurrentVisuals({ project, scene }: { project: ProjectData; scene: Scene }) {
  const byId = new Map(collectMediaAssets(project).map(asset => [asset.id, asset]));
  const candidates = new Map(allCandidates(project).map(candidate => [candidateAssetId(candidate), candidate]));
  const visuals = sceneComposition(scene).visuals;
  const seconds = (value: number) => Number.isFinite(value) ? Number(value.toFixed(3)) : "?";
  return <div className="comparison-current"><strong>현재 화면{visuals.length > 1 ? ` · ${visuals.length}구간` : ""}</strong>{visuals.length ? <div className="comparison-current-strip">{visuals.map((section, index) => {
    const asset = byId.get(section.asset_id), preview = candidates.get(section.asset_id)?.preview_url || asset?.preview_url || asset?.inline_data || asset?.preview_inline_data;
    return <figure key={section.id}><div><CurrentPreview key={preview} url={preview} number={index + 1} /></div><figcaption>{index + 1} · {asset?.kind === "video" ? "동영상 대표 이미지" : "이미지"} · {seconds(section.start_sec)}–{seconds(section.end_sec)}초</figcaption></figure>;
  })}</div> : <p>아직 선택한 화면이 없습니다.</p>}</div>;
}

function ComparisonScene({ project, scene, onApply, onNext, onClose, setBusy }: { project: ProjectData; scene: Scene; onApply: Apply; onNext?: () => void; onClose: () => void; setBusy: (busy: boolean) => void }) {
  const [shown, setShown] = useState(() => initialComparisonIds(scene));
  const [choice, setChoice] = useState<{ id: string; expected: string }>();
  const [loaded, setLoaded] = useState<Record<string, { url: string; ready: boolean }>>({});
  const [pending, setPending] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const alive = useRef(true);
  const inFlight = useRef(false);
  const nextScene = useRef(onNext); nextScene.current = onNext;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const candidates = imageCandidates(scene), visible = shown.map(id => candidates.find(candidate => candidate.id === id)).filter((candidate): candidate is ImageCandidate => !!candidate);
  const fingerprint = visualSelectionFingerprint(scene);
  const selected = candidates.find(candidate => candidate.id === choice?.id);
  const stale = !!choice && choice.expected !== fingerprint;
  const ready = !!selected && loaded[selected.id]?.url === selected.preview_url && loaded[selected.id]?.ready;
  const unchanged = !!selected && isCurrentImage(scene, selected);
  const canApply = !!selected && !stale && ready && !unchanged && !pending;
  const choose = (candidate: ImageCandidate) => { setChoice({ id: candidate.id, expected: fingerprint }); setNotice(""); setError(""); };
  const toggle = (id: string) => {
    if (shown.includes(id)) { setShown(value => value.filter(item => item !== id)); if (choice?.id === id) setChoice(undefined); }
    else setShown(value => [...value.filter(item => candidates.some(candidate => candidate.id === item)), id].slice(0, 4));
  };
  const confirm = async (next: boolean) => {
    if (!canApply || !choice || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setBusy(true); setNotice(""); setError("");
    try {
      const result = await onApply({ projectId: project.id, sceneId: scene.id, candidateId: choice.id, expectedVisual: choice.expected });
      if (!alive.current) return;
      setChoice(undefined);
      if (result === "changed") setError("적용 후 화면이 다시 변경되었습니다. 현재 화면을 확인해 주세요.");
      else if (result === "unsaved") setError("선택은 반영했지만 프로젝트를 저장하지 못했습니다. 비교 창을 닫고 상단의 ‘저장 다시 시도’를 눌러 주세요.");
      else if (next && nextScene.current) nextScene.current();
      else setNotice("선택을 확정했습니다. 실행 취소로 이전 화면을 복원할 수 있습니다.");
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { inFlight.current = false; setBusy(false); if (alive.current) setPending(false); }
  };
  return <>
    <div className="comparison-content">
      <CurrentVisuals project={project} scene={scene} />
      <p className="comparison-hint">선택 확정 시 이 장면 전체 화면을 고른 이미지로 교체합니다. 자막·녹음·길이와 기존 후보·원본은 보존합니다.</p>
      <div className="comparison-picker"><strong>비교할 이미지 · 최대 4장</strong><div role="group" aria-label="비교할 후보 이미지">{candidates.map(candidate => { const number = scene.candidates.indexOf(candidate) + 1, usage = imageUsage(scene, candidate); return <button type="button" key={candidate.id} aria-label={`후보 ${number} 비교에 포함`} aria-pressed={shown.includes(candidate.id)} disabled={pending || !shown.includes(candidate.id) && visible.length >= 4} onClick={() => toggle(candidate.id)}><img src={candidate.preview_url} alt="" loading="lazy" /><span>후보 {number}{usage ? ` · ${usage}` : ""}</span></button>; })}</div></div>
      {visible.length ? <div className={`comparison-grid${visible.length === 1 ? " is-single" : ""}`}>{visible.map(candidate => <CandidatePreview key={`${candidate.id}:${candidate.preview_url}`} candidate={candidate} number={scene.candidates.indexOf(candidate) + 1} usage={imageUsage(scene, candidate)} picked={choice?.id === candidate.id} disabled={pending} onPick={() => { if (!pending) choose(candidate); }} onReady={value => setLoaded(previous => ({ ...previous, [candidate.id]: { url: candidate.preview_url, ready: value } }))} />)}</div> : <p className="comparison-empty">{candidates.length ? "위 목록에서 비교할 이미지를 골라 주세요." : "이 장면에는 이미지 후보가 없습니다. 장면 편집이나 이미지 일괄 배치에서 추가해 주세요."}</p>}
      {!pending && stale && <p className="comparison-warning" role="alert">현재 화면이 변경되었습니다. 최신 화면을 확인하고 후보를 다시 골라 주세요.</p>}
      {choice && !selected && <p className="comparison-warning" role="alert">고른 후보가 없어졌습니다. 최신 후보를 다시 골라 주세요.</p>}
      {unchanged && !stale && <p className="comparison-hint">이미 현재 화면으로 사용 중인 이미지입니다.</p>}
      {notice && <p className="comparison-notice" role="status">{notice}</p>}
      {error && <div className="comparison-warning" role="alert"><p>{error}</p><button type="button" className="btn ghost" onClick={onClose}>비교 닫고 작업 보드 확인</button></div>}
    </div>
    <footer className="comparison-footer"><p>{pending ? "선택 저장 중…" : "후보를 고른 뒤 선택을 확정하세요. 장면을 이동하거나 닫으면 미확정 선택은 초기화됩니다."}</p><div><button type="button" className="btn primary" disabled={!canApply} onClick={() => void confirm(false)}>선택 확정</button>{onNext && <button type="button" className="btn ghost" disabled={!canApply} onClick={() => void confirm(true)}>선택 확정 후 다음 장면 <ArrowRight size={14} /></button>}</div></footer>
  </>;
}

export function ImageComparison({ project, sceneId, sceneIds, onSceneChange, onApply, onClose, scopeLabel = "열 때의 필터에 포함된 장면" }: { project: ProjectData; sceneId: string; sceneIds: string[]; onSceneChange: (id: string) => void; onApply: Apply; onClose: () => void; scopeLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const queue = useMemo(() => orderedScenes(project).filter(scene => sceneIds.includes(scene.id)), [project, sceneIds]);
  const index = queue.findIndex(scene => scene.id === sceneId), scene = project.scenes.find(item => item.id === sceneId);
  useLayoutEffect(() => {
    const element = dialog.current!; element.showModal();
    element.querySelector<HTMLButtonElement>("button[aria-label='후보 비교 닫기']")?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; element.close(); };
  }, []);
  const go = (offset: number) => { const target = queue[index + offset]; if (target) onSceneChange(target.id); };
  let invalid = "";
  try { collectMediaAssets(project); if (scene) sceneComposition(scene); }
  catch (cause) { invalid = (cause as Error).message; }
  return <dialog ref={dialog} className="image-comparison-dialog" aria-labelledby="image-comparison-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="comparison-heading"><div><h2 id="image-comparison-title">후보 이미지 비교</h2><p>{scene ? `Scene ${scene.number} · ${scene.title}` : "비교하던 장면이 없어졌습니다."}</p><small>{scopeLabel} · {index >= 0 ? index + 1 : 0}/{queue.length}</small></div><div><button type="button" className="btn ghost" disabled={busy || index <= 0} onClick={() => go(-1)}><ArrowLeft size={14} /> 이전 비교 장면</button><button type="button" className="btn ghost" disabled={busy || index < 0 || index >= queue.length - 1} onClick={() => go(1)}>다음 비교 장면 <ArrowRight size={14} /></button><button type="button" className="btn ghost" aria-label="후보 비교 닫기" onClick={onClose}><X size={18} /></button></div></header>
    {scene && !invalid ? <ComparisonScene key={scene.id} project={project} scene={scene} onApply={onApply} onNext={index >= 0 && index < queue.length - 1 ? () => go(1) : undefined} onClose={onClose} setBusy={setBusy} /> : <div className="comparison-empty"><p role="alert">{invalid || "작업 보드에서 최신 장면을 다시 선택해 주세요."}</p><button type="button" className="btn ghost" onClick={onClose}>작업 보드로 돌아가기</button></div>}
  </dialog>;
}
