import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Image as ImageIcon, Mic } from "lucide-react";
import { matchesReviewFilter, REVIEW_FILTERS, reviewScenes, type ReviewFilter, type ReviewView, type SceneReview } from "./scene-review";
import type { ProjectData } from "./types";

function ReviewCard({ item, onOpen }: { item: SceneReview; onOpen: () => void }) {
  const [failedImage, setFailedImage] = useState("");
  return <article className="panel review-image-card scene-review-card" data-scene-id={item.scene.id} aria-label={`Scene ${item.scene.number} 작업 상태`}>
    <div className="scene-review-image">{item.previewUrl && failedImage !== item.previewUrl ? <img src={item.previewUrl} loading="lazy" alt={`Scene ${item.scene.number} 대표 화면`} onError={() => setFailedImage(item.previewUrl!)} /> : <div className="candidate-empty"><ImageIcon size={24} /><span>{item.hasVisual ? "미리보기 없음" : "화면 미선택"}</span></div>}</div>
    <div className="scene-review-title"><strong>Scene {item.scene.number} · {item.scene.title}</strong>{item.core && <em>★ 핵심 업적</em>}</div>
    {!!item.supportPreviewUrls.length && <div className="review-support">{item.supportPreviewUrls.slice(0, 2).map((url, index) => <img key={url} src={url} loading="lazy" alt={`Scene ${item.scene.number} 보조 화면 ${index + 1}`} />)}<small>보조 화면{item.supportPreviewUrls.length > 2 ? ` ${item.supportPreviewUrls.length}개` : ""}</small></div>}
    <dl className="scene-review-facts">
      <div><dt><ImageIcon size={13} /> 화면</dt><dd className={item.hasVisual ? "" : "needs-work"}>{item.visualLabel}</dd></div>
      <div><dt>자막</dt><dd className={item.hasCaption ? "" : "needs-work"}>{item.hasCaption ? `${item.captionCount}개` : "자막 확인"}</dd></div>
      <div><dt><Mic size={13} /> 녹음</dt><dd>{item.hasNarration ? `${item.narrationCount}구간` : "없음 · 선택 사항"}</dd></div>
      <div><dt><Clock3 size={13} /> 길이</dt><dd className={item.timingIssues.length ? "needs-work" : ""}>{Number.isFinite(item.duration) ? `${Number(item.duration.toFixed(3))}초` : "확인 필요"}</dd></div>
    </dl>
    {!!item.timingIssues.length && <details className="scene-review-issues"><summary>시간 오류 {item.timingIssues.length}개</summary><ul>{item.timingIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
    {!!item.mediaIssues.length && <p className="scene-review-note">{item.mediaIssues.join(" ")}</p>}
    {!!failedImage && failedImage === item.previewUrl && <p className="scene-review-note">미리보기를 불러오지 못했습니다. 장면 편집에서 자료를 확인해 주세요.</p>}
    <button type="button" className="btn ghost" aria-label={`Scene ${item.scene.number} 편집`} onClick={onOpen}>장면 편집 <ArrowRight size={14} /></button>
  </article>;
}

export function SceneReviewBoard({ project, view, onOpenScene }: { project: ProjectData; view: ReviewView; onOpenScene: (sceneId: string) => void }) {
  const [filter, setFilter] = useState<ReviewFilter>(view.filter);
  const [returned, setReturned] = useState(!!view.returning);
  const region = useRef<HTMLElement>(null);
  const items = useMemo(() => reviewScenes(project), [project]);
  const visible = items.filter(item => matchesReviewFilter(item, filter));
  const anchorMissing = returned && !!view.anchor && !visible.some(item => item.scene.id === view.anchor!.sceneId);

  useLayoutEffect(() => {
    const savedY = view.scrollY, anchor = view.returning ? view.anchor : undefined;
    view.returning = false;
    const restore = () => {
      const card = anchor && [...(region.current?.querySelectorAll<HTMLElement>("[data-scene-id]") || [])].find(item => item.dataset.sceneId === anchor.sceneId);
      window.scrollTo({ top: card ? window.scrollY + card.getBoundingClientRect().top - anchor!.offset : savedY, behavior: "instant" });
      if (card && anchor) card.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      else if (anchor) region.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus({ preventScroll: true });
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    const remember = () => { view.scrollY = window.scrollY; };
    window.addEventListener("scroll", remember, { passive: true });
    return () => { window.cancelAnimationFrame(frame); remember(); window.removeEventListener("scroll", remember); };
  }, [view]);

  const selectFilter = (value: ReviewFilter) => { view.filter = value; view.anchor = undefined; setReturned(false); setFilter(value); };
  const open = (sceneId: string) => {
    const card = [...(region.current?.querySelectorAll<HTMLElement>("[data-scene-id]") || [])].find(item => item.dataset.sceneId === sceneId);
    view.scrollY = window.scrollY; view.anchor = { sceneId, offset: card?.getBoundingClientRect().top ?? 0 }; view.returning = true;
    onOpenScene(sceneId);
  };
  return <section ref={region} className="scene-review-board" aria-label="장면 작업 보드">
    <div className="scene-review-heading"><div><h3>장면 작업 보드</h3><p>필요한 장면을 찾아 수정하고 이 보드로 돌아올 수 있습니다. 녹음은 선택 사항입니다.</p></div><span aria-live="polite">{visible.length} / {items.length}개 장면</span></div>
    <div className="scene-review-filters" role="group" aria-label="장면 상태 필터">{REVIEW_FILTERS.map(option => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => selectFilter(option.id)}>{option.label} <b>{items.filter(item => matchesReviewFilter(item, option.id)).length}</b></button>)}</div>
    {anchorMissing && <p className="scene-review-return-note" role="status">수정한 장면이 현재 필터에 없거나 다른 장면과 합쳐졌습니다. 필터는 유지했습니다.</p>}
    {visible.length ? <div className="review-image-grid">{visible.map(item => <ReviewCard key={item.scene.id} item={item} onOpen={() => open(item.scene.id)} />)}</div> : <div className="panel scene-review-empty"><p>이 조건에 해당하는 장면이 없습니다.</p><button type="button" className="btn ghost" onClick={() => selectFilter("all")}>모든 장면 보기</button></div>}
  </section>;
}
