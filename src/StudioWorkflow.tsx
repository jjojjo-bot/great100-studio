import { useMemo } from "react";
import { ArrowRight, CheckCircle2, ClipboardCheck, Image as ImageIcon, Mic, Play, Upload } from "lucide-react";
import { completionErrors, reportForProject } from "./app-data";
import { reviewScenes } from "./scene-review";
import type { ProjectData } from "./types";
import "./workflow.css";

export const STUDIO_STEPS = ["대시보드", "프로젝트", "파싱 확인", "사전 점검", "기준 이미지", "Scene 검토", "썸네일", "전체 검토", "완료"];
export const NEXT_STEP_LABELS: Record<number, string> = { 2: "사전 점검으로", 3: "기준 이미지 준비", 4: "장면 편집으로", 5: "썸네일 준비", 6: "전체 검토로", 7: "MP4 출력으로" };

export function nextStepBlock(project: ProjectData, step: number): string {
  if (step === 2) {
    if (!project.scenes.length) return "장면을 하나 이상 준비해 주세요.";
    const missing = project.scenes.filter(scene => !scene.prompt.trim()).length;
    if (missing) return `장면 ${missing}개의 이미지 내용을 먼저 입력해 주세요.`;
  }
  if (step === 3) { const errors = reportForProject(project).errors; if (errors.length) return `품질 점검의 오류 ${errors.length}개를 먼저 수정해 주세요.`; }
  if (step === 7) {
    const errors = completionErrors(project);
    if (errors.length) return `출력 전에 확인할 항목 ${errors.length}개가 있습니다. 위의 제작 현황을 확인해 주세요.`;
  }
  return "";
}

// A loaded project can move directly between its editing tools. Only export
// requires the same completion checks as the footer; an enabled item always acts.
export const canVisitStudioStep = (project: ProjectData | null, step: number) => Number.isInteger(step) && step >= 0 && step <= 8
  && (step <= 1 || !!project && (step < 8 || !completionErrors(project).length));

export function focusReviewSection(id: string, controls: string[] = []) {
  for (const control of controls) {
    const button = document.querySelector<HTMLButtonElement>(`button[aria-controls="${control}"]`);
    if (button?.getAttribute("aria-expanded") === "false") button.click();
  }
  window.requestAnimationFrame(() => {
    const target = document.getElementById(id);
    if (!target?.isConnected) return;
    target.scrollIntoView?.({ block: "start", behavior: "instant" });
    target.focus({ preventScroll: true });
  });
}

export function ReviewOverview({ project, errors, onOpenScene, onThumbnail }: { project: ProjectData; errors: string[]; onOpenScene: (id: string) => void; onThumbnail: () => void }) {
  const items = useMemo(() => reviewScenes(project), [project]);
  const missing = items.filter(item => !item.hasVisual), recorded = items.filter(item => item.hasNarration).length;
  const thumbnail = project.thumbnail.candidates.some(item => item.id === project.thumbnail.selected_candidate_id);
  const needsThumbnail = project.schema_version !== 1 && !thumbnail;
  const firstIssue = items.find(item => !item.hasCaption || item.timingIssues.length || item.mediaIssues.length);
  const title = missing.length ? `장면 화면 ${missing.length}개를 선택해 주세요` : needsThumbnail ? "썸네일을 선택해 주세요" : errors.length ? `출력 전 ${errors.length}개 항목을 확인해 주세요` : "장면 선택을 마쳤어요";
  const action = missing.length ? () => onOpenScene(missing[0].scene.id) : needsThumbnail ? onThumbnail : errors.length && firstIssue ? () => onOpenScene(firstIssue.scene.id) : () => focusReviewSection(errors.length ? "review-required-fixes" : "review-preview");
  return <section className={`review-overview${errors.length ? " needs-attention" : ""}`} aria-label="영상 제작 현황">
    <div className="review-overview-main"><div><span className="workflow-eyebrow">지금 할 일</span><h3>{title}</h3><p>{errors.length ? "화면·자막·시간을 확인하고 필요한 장면만 바로 수정하세요." : "전체 미리보기와 자료 점검을 확인한 뒤 MP4를 만드세요."}</p></div><button type="button" className="btn primary" onClick={action}>{missing.length ? "첫 미선택 장면 열기" : needsThumbnail ? "썸네일 준비하기" : firstIssue && errors.length ? "확인할 장면 열기" : errors.length ? "확인할 항목 보기" : "전체 미리보기 보기"}<ArrowRight size={16} /></button></div>
    <dl className="review-overview-metrics"><div><dt><ImageIcon size={15} /> 화면 선택</dt><dd>{items.length - missing.length}<small> / {items.length}개 장면</small></dd></div><div><dt><Mic size={15} /> 녹음 연결 <small>선택 사항</small></dt><dd>{recorded}<small> / {items.length}개 장면</small></dd></div><div><dt><CheckCircle2 size={15} /> 썸네일</dt><dd>{thumbnail ? "선택됨" : needsThumbnail ? "선택 필요" : "선택 사항"}</dd></div></dl>
    <p className="review-overview-note">녹음 없이도 영상을 만들 수 있습니다. 실제 파일이 열리는지는 자료 점검에서 확인하세요.</p>
  </section>;
}

export function ReviewToolLinks() {
  return <nav className="review-tool-links" aria-label="전체 검토 바로가기">
    <button type="button" onClick={() => focusReviewSection("review-image-tools", ["batch-image-content"])}><Upload size={16} /><span>이미지 준비로 이동<small>프롬프트 · 일괄 가져오기</small></span></button>
    <button type="button" onClick={() => focusReviewSection("review-narration-tools", ["scene-narration-export-content"])}><Mic size={16} /><span>녹음 준비로 이동<small>대본 모으기 · 파일 연결</small></span></button>
    <button type="button" onClick={() => focusReviewSection("review-check-tools")}><ClipboardCheck size={16} /><span>자료 점검으로 이동<small>이미지 · 영상 · 소리 확인</small></span></button>
    <button type="button" onClick={() => focusReviewSection("review-preview")}><Play size={16} /><span>미리보기로 이동<small>전체 영상 재생</small></span></button>
  </nav>;
}
