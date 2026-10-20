import { useEffect, useMemo, useRef, useState } from "react";
import { checkResult, currentCheckResult, exportMediaCheckPlan, sameMediaCheckPlan, type MediaCheckPlan, type MediaCheckResult } from "./export-media-check";
import { inspectExportMedia } from "./export-media-reader";
import type { ProjectData } from "./types";

type CheckDraft = { results: Record<string, MediaCheckResult>; checkedFingerprint: string; stopped: boolean };
const empty = (): CheckDraft => ({ results: {}, checkedFingerprint: "", stopped: false });

// Kept at the Studio root so opening an editor does not lose the diagnosis.
// Only small results are retained; file bytes and decoded media are released.
export function useExportMediaCheck(project: ProjectData | null) {
  const plan = useMemo(() => project ? exportMediaCheckPlan(project) : { items: [], issues: [], fingerprint: "" }, [project]);
  const drafts = useRef(new Map<string, CheckDraft>()), active = useRef<{ controller: AbortController; plan: MediaCheckPlan } | undefined>(undefined);
  const current = useRef({ id: project?.id, plan }); current.current = { id: project?.id, plan };
  const alive = useRef(true);
  const [, redraw] = useState(0), [progress, setProgress] = useState<{ id: string; plan: MediaCheckPlan; done: number; total: number; label: string }>();
  const update = (id: string, draft: CheckDraft) => { drafts.current.set(id, draft); if (alive.current) redraw(value => value + 1); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.controller.abort(); }; }, []);
  useEffect(() => { if (active.current && !sameMediaCheckPlan(active.current.plan, plan)) active.current.controller.abort(); }, [plan]);
  const run = async (failedOnly = false) => {
    if (!project || active.current) return;
    const id = project.id, fingerprint = plan.fingerprint, previous = drafts.current.get(id) || empty();
    const results: Record<string, MediaCheckResult> = failedOnly ? { ...previous.results } : {};
    const work = plan.items.filter(item => !failedOnly || !currentCheckResult(item, results[item.key]) || results[item.key]?.status !== "passed");
    const controller = new AbortController(); active.current = { controller, plan };
    const valid = () => alive.current && !controller.signal.aborted && current.current.id === id && sameMediaCheckPlan(current.current.plan, plan);
    update(id, { results: { ...results }, checkedFingerprint: "", stopped: false });
    setProgress({ id, plan, done: 0, total: work.length, label: "점검 준비 중…" });
    let done = 0;
    try {
      for (const item of work) {
        if (!valid()) break;
        setProgress({ id, plan, done, total: work.length, label: item.locations[0]?.label || "원본 자료" });
        const file = new AbortController(), abort = () => file.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        const timer = window.setTimeout(() => file.abort(new Error("자료 점검 시간이 초과되었습니다. 연결 상태를 확인하고 다시 점검해 주세요.")), 60_000);
        try {
          const message = await inspectExportMedia(project, item, file.signal);
          if (valid()) results[item.key] = checkResult(item, "passed", message);
        } catch (cause) {
          if (valid()) results[item.key] = checkResult(item, "error", /[가-힣]/.test((cause as Error).message || "") ? (cause as Error).message : "자료를 읽거나 디코딩하지 못했습니다. 파일을 확인한 뒤 다시 업로드하거나 재검사해 주세요.");
        } finally { window.clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
        if (!valid()) break;
        done++; update(id, { results: { ...results }, checkedFingerprint: "", stopped: false });
      }
      update(id, { results: { ...results }, checkedFingerprint: valid() ? fingerprint : "", stopped: !valid() });
    } finally { if (active.current?.controller === controller) active.current = undefined; if (alive.current) setProgress(undefined); }
  };
  const id = project?.id || "", draft = drafts.current.get(id) || empty();
  const passed = plan.items.filter(item => currentCheckResult(item, draft.results[item.key]) && draft.results[item.key]?.status === "passed").length;
  const failed = plan.items.filter(item => currentCheckResult(item, draft.results[item.key]) && draft.results[item.key]?.status === "error").length;
  const busy = progress?.id === id && sameMediaCheckPlan(progress.plan, plan);
  const checked = draft.checkedFingerprint === plan.fingerprint && passed + failed === plan.items.length;
  return { plan, ...draft, passed, failed, busy, progress: busy ? progress : undefined,
    checked,
    stale: !!Object.keys(draft.results).length && !checked && !busy,
    run, stop: () => active.current?.controller.abort(),
  };
}
export type ExportMediaCheckController = ReturnType<typeof useExportMediaCheck>;
