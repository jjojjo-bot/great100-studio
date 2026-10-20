import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { candidateAssetId } from "./media-composition";
import { getMediaAsset } from "./platform";
import { filterLibraryImages, libraryImages, originalImageIdentity, type LibraryFilter, type LibraryImage, type RestoreImageRequest, type RestoreImageResult } from "./image-library";
import { orderedScenes } from "./scene-order";
import type { ProjectData } from "./types";

const PAGE_SIZE = 9;
const FILTERS = [{ id: "all", label: "모든 이미지" }, { id: "used", label: "화면 연결됨" }, { id: "unused", label: "화면 연결 없음" }, { id: "detached", label: "후보 목록에서 빠짐" }] as const;

function OriginalPreview({ project, item }: { project: ProjectData; item: LibraryImage }) {
  const [url, setUrl] = useState(item.previewUrl || ""), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, objectUrl = "";
    setError(""); setUrl("");
    if (!attempt && item.previewUrl) { setUrl(item.previewUrl); return; }
    void getMediaAsset(project, item.asset).then(blob => {
      if (!active) return;
      if (!blob?.size) throw new Error("원본을 찾지 못했습니다.");
      objectUrl = URL.createObjectURL(new Blob([blob], { type: item.asset.mime_type })); setUrl(objectUrl);
    }).catch(() => { if (active) setError("원본 미리보기를 불러오지 못했습니다."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [project.id, item.previewUrl, originalImageIdentity(item.asset), attempt]);
  return <div className="library-preview">{error ? <div><ImageIcon size={22} /><span>{error}</span><button type="button" className="btn ghost" onClick={() => setAttempt(value => value + 1)}>미리보기 다시 불러오기</button></div> : url ? <img src={url} alt={`원본 이미지 ${item.number}`} loading="lazy" onError={() => setError("원본 미리보기를 불러오지 못했습니다.")} /> : <div><LoaderCircle className="spin" size={22} /><span>미리보기 준비 중…</span></div>}</div>;
}

function OriginalCard({ project, item, complete, targetId, busy, onRestore, onCompare }: { project: ProjectData; item: LibraryImage; complete: boolean; targetId: string; busy: boolean; onRestore: (request: RestoreImageRequest) => Promise<RestoreImageResult>; onCompare: (sceneId: string, origin: HTMLElement) => void }) {
  const [result, setResult] = useState<RestoreImageResult>(), [pending, setPending] = useState(false);
  const alive = useRef(true), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const target = project.scenes.find(scene => scene.id === targetId);
  const contains = (id: string) => project.scenes.find(scene => scene.id === id)?.candidates.some(candidate => candidateAssetId(candidate) === item.asset.id);
  const exists = !!target && contains(target.id);
  const reviewTarget = exists ? target : result && contains(result.sceneId) ? project.scenes.find(scene => scene.id === result.sceneId) : undefined;
  const restore = async () => {
    if (!target || !item.candidateId || busy || working.current) return;
    working.current = true; setPending(true); setResult(undefined);
    try { const response = await onRestore({ projectId: project.id, sceneId: target.id, assetId: item.asset.id, expectedOriginal: originalImageIdentity(item.asset) }); if (alive.current) setResult(response); }
    catch { /* The library reports restore errors above the grid. */ }
    finally { working.current = false; if (alive.current) setPending(false); }
  };
  return <div className="library-card" data-library-asset={item.asset.id}>
    <OriginalPreview project={project} item={item} />
    <div className="library-card-title"><strong>원본 이미지 {item.number}</strong><span>{item.uses.length ? "화면 연결됨" : complete ? "화면 연결 없음" : "연결 확인 필요"}</span></div>
    <small className="library-filename" title={item.asset.path}>{item.asset.path.split(/[\\/]/).at(-1)}</small>
    <div className="library-uses"><strong>현재 사용 위치</strong>{item.uses.length ? <ul>{item.uses.slice(0, 2).map(label => <li key={label}>{label}</li>)}</ul> : <p>{complete ? "현재 화면에 연결되지 않았습니다." : "일부 장면의 연결을 확인하지 못했습니다."}</p>}{item.uses.length > 2 && <details><summary>사용 위치 {item.uses.length - 2}개 더 보기</summary><ul>{item.uses.slice(2).map(label => <li key={label}>{label}</li>)}</ul></details>}</div>
    <details className="library-locations"><summary>후보 보관 위치 · {item.locations.length}곳</summary>{item.locations.length ? <ul>{item.locations.map(label => <li key={label}>{label}</li>)}</ul> : <p>후보 목록에서 빠졌지만 원본은 보관되어 있습니다.</p>}</details>
    {!item.candidateId && <p className="library-warning">후보 식별 정보가 없는 자료입니다. ZIP에서 원본 파일을 확인해 주세요.</p>}
    <div className="library-card-actions"><button type="button" className="btn ghost" aria-label={`원본 이미지 ${item.number} 후보로 추가`} disabled={busy || pending || !target || !item.candidateId || exists} onClick={() => void restore()}>{pending ? <LoaderCircle className="spin" size={14} /> : <ArchiveRestore size={14} />}{pending ? "원본 확인·연결 중…" : exists ? "이미 장면 후보에 있음" : "장면 후보로 추가"}</button>{reviewTarget && <button type="button" className="btn ghost" aria-label={`원본 이미지 ${item.number} · Scene ${reviewTarget.number} 후보 비교`} onClick={event => onCompare(reviewTarget.id, event.currentTarget)}>Scene {reviewTarget.number} 후보 비교</button>}</div>
  </div>;
}

export function ImageLibrary({ project, busy, onRestore, onCompare }: { project: ProjectData; busy: boolean; onRestore: (request: RestoreImageRequest) => Promise<RestoreImageResult>; onCompare: (sceneId: string, origin: HTMLElement) => void }) {
  const [open, setOpen] = useState(false), [filter, setFilter] = useState<LibraryFilter>("all"), [search, setSearch] = useState(""), [targetId, setTargetId] = useState(""), [page, setPage] = useState(0);
  const [feedback, setFeedback] = useState<{ result?: RestoreImageResult; error?: string }>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const restore = async (request: RestoreImageRequest) => {
    setFeedback({});
    try { const result = await onRestore(request); if (alive.current) setFeedback({ result }); return result; }
    catch (cause) { if (alive.current) setFeedback({ error: (cause as Error).message }); throw cause; }
  };
  const catalog = useMemo(() => { try { return { ...libraryImages(project), error: "" }; } catch (cause) { return { images: [], warnings: [], error: (cause as Error).message }; } }, [project]);
  const complete = !catalog.warnings.length;
  const visible = filterLibraryImages(catalog.images, filter, search, complete), pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const slice = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return <section className="panel image-library" aria-label="이미지 원본 보관함">
    <div className="library-heading"><div><h3><ArchiveRestore size={18} /> 이미지 원본 보관함 <small>{catalog.images.length}개</small></h3><p>보관한 이미지를 찾아 장면 후보로 다시 추가합니다. 현재 선택한 화면은 유지합니다.</p></div><button type="button" className="btn ghost" aria-expanded={open} aria-controls="image-library-content" onClick={() => setOpen(value => !value)}>{open ? "보관함 접기" : "보관함 열기"}</button></div>
    {open && <div id="image-library-content">
      {catalog.error ? <p className="library-warning" role="alert">{catalog.error}</p> : <>
        <div className="library-toolbar"><label>후보를 추가할 장면<select aria-label="원본 후보를 추가할 장면" value={targetId} disabled={busy} onChange={event => setTargetId(event.target.value)}><option value="">장면을 선택하세요</option>{targetId && !project.scenes.some(scene => scene.id === targetId) && <option value={targetId}>없어진 장면 · 다시 선택</option>}{orderedScenes(project).map(scene => <option key={scene.id} value={scene.id}>Scene {scene.number} · {scene.title}</option>)}</select></label><label>원본 검색<input type="search" aria-label="원본 이미지 검색" placeholder="파일명·장면 제목 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label></div>
        <div className="library-filters" role="group" aria-label="원본 이미지 필터">{FILTERS.map(option => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => { setFilter(option.id); setPage(0); }}>{option.label} <b>{filterLibraryImages(catalog.images, option.id, "", complete).length}</b></button>)}</div>
        <p className="library-hint">화면 연결과 후보 보관은 다릅니다. 연결 없음도 원본과 후보를 삭제하지 않습니다. 복원 후 ‘후보 비교’에서 사용할 이미지를 확정하세요.</p>
        {busy && <p className="library-hint" role="status">원본 이미지를 확인해 장면 후보에 연결하고 있습니다…</p>}
        {feedback.result && <div className="library-feedback library-message" role="status"><span>{feedback.result.message}</span>{project.scenes.some(scene => scene.id === feedback.result!.sceneId) && <button type="button" className="btn ghost" aria-label="복원한 장면 후보 비교" onClick={event => onCompare(feedback.result!.sceneId, event.currentTarget)}>복원한 장면 후보 비교</button>}</div>}
        {feedback.error && <p className="library-warning" role="alert">{feedback.error}</p>}
        {!!catalog.warnings.length && <p className="library-warning" role="alert">{catalog.warnings.join(" ")} 연결 정보가 불완전해 ‘화면 연결 없음’으로 판정하지 않습니다.</p>}
        {visible.length ? <div className="library-grid">{slice.map(item => <OriginalCard key={item.asset.id} project={project} item={item} complete={complete} targetId={targetId} busy={busy} onRestore={restore} onCompare={onCompare} />)}</div> : <p className="library-empty">{catalog.images.length ? "이 조건에 해당하는 이미지 원본이 없습니다." : "아직 보관한 이미지 원본이 없습니다."}</p>}
        <div className="library-pagination"><span>{visible.length}개 이미지 · {currentPage + 1}/{pages}페이지</span><div><button type="button" className="btn ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전 원본 페이지</button><button type="button" className="btn ghost" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>다음 원본 페이지</button></div></div>
      </>}
    </div>}
  </section>;
}
