import { useEffect, useRef, useState } from "react";
import { detectNarrationFormat, inspectSceneNarration } from "./platform";
import { suggestedSceneId } from "./scene-image-batch";
import { batchNarrationFingerprint, MAX_BATCH_NARRATIONS, MAX_BATCH_NARRATION_BYTES, narrationRowState, type BatchNarrationRequest, type BatchNarrationResult, type NarrationBatchRow, type NarrationBatchSelection } from "./scene-narration-batch";
import type { ProjectData } from "./types";

type Draft = { rows: NarrationBatchRow[]; selection: NarrationBatchSelection; error: string };
const empty = (): Draft => ({ rows: [], selection: "keep", error: "" });

export function useSceneNarrationBatch(project: ProjectData | null, onApply: (request: BatchNarrationRequest) => Promise<BatchNarrationResult>) {
  const drafts = useRef(new Map<string, Draft>()), alive = useRef(true), working = useRef(false), preparingRef = useRef(false), stopped = useRef(false);
  const importer = useRef(onApply); importer.current = onApply;
  const [, redraw] = useState(0), [workingProjectId, setWorkingProjectId] = useState(""), [preparing, setPreparing] = useState(false);
  const update = (id: string, change: (draft: Draft) => Draft) => { drafts.current.set(id, change(drafts.current.get(id) || empty())); if (alive.current) redraw(value => value + 1); };
  const patch = (id: string, rowId: string, change: Partial<NarrationBatchRow>) => update(id, draft => ({ ...draft, rows: draft.rows.map(row => row.id === rowId ? { ...row, ...change } : row) }));
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopped.current = true; for (const draft of drafts.current.values()) for (const row of draft.rows) if (row.previewUrl) URL.revokeObjectURL(row.previewUrl); }; }, []);
  useEffect(() => {
    if (!workingProjectId) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [workingProjectId]);
  const addFiles = async (files: File[]) => {
    if (!project || !files.length || working.current || preparingRef.current) return;
    const id = project.id, draft = drafts.current.get(id) || empty();
    if (draft.rows.length + files.length > MAX_BATCH_NARRATIONS || draft.rows.reduce((sum, row) => sum + row.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_NARRATION_BYTES) {
      update(id, current => ({ ...current, error: "녹음 한 묶음은 최대 40개·합계 120MB입니다. 목록을 비우거나 파일 수를 줄여 주세요." })); return;
    }
    preparingRef.current = true; setPreparing(true);
    const rows: NarrationBatchRow[] = files.map(file => ({ id: crypto.randomUUID(), file, sceneId: suggestedSceneId(file.name, project.scenes, project.id), previewUrl: "", status: "checking" }));
    update(id, current => ({ ...current, rows: [...current.rows, ...rows], error: "" }));
    try {
      for (const row of rows) {
        if (!alive.current) break;
        try {
          detectNarrationFormat(row.file); const prepared = await inspectSceneNarration(row.file);
          if (!alive.current) break;
          patch(id, row.id, { prepared, previewUrl: URL.createObjectURL(new Blob([prepared.file], { type: prepared.mime })), status: "ready" });
        } catch (cause) { patch(id, row.id, { status: "error", invalid: true, message: (cause as Error).message }); }
      }
    } finally { preparingRef.current = false; if (alive.current) setPreparing(false); }
  };
  const run = async (failedOnly = false, single?: { id: string; timing: NonNullable<BatchNarrationRequest["timing"]> }) => {
    if (!project || working.current || preparingRef.current) return;
    const id = project.id, draft = drafts.current.get(id) || empty();
    const work = draft.rows.flatMap(row => {
      const state = narrationRowState(project, draft.rows, row, draft.selection);
      if (!state.ready || (single ? row.id !== single.id : state.long || row.status !== (failedOnly ? "error" : "ready"))) return [];
      return [{ row, request: { projectId: id, sceneId: row.sceneId, prepared: row.prepared!, selection: draft.selection, expected: batchNarrationFingerprint(state.scene!), saved: row.saved, timing: single?.timing } satisfies BatchNarrationRequest }];
    });
    if (!work.length) return;
    working.current = true; stopped.current = false; setWorkingProjectId(id);
    try {
      for (const { row, request } of work) {
        if (stopped.current || !alive.current) break;
        patch(id, row.id, { status: "applying", message: undefined });
        try { const result = await importer.current(request); patch(id, row.id, { saved: result.saved, status: result.applied ? "done" : "error", message: result.note }); }
        catch (cause) { patch(id, row.id, { status: "error", message: (cause as Error).message }); }
      }
    } finally { working.current = false; if (alive.current) setWorkingProjectId(""); }
  };
  const id = project?.id || "", draft = drafts.current.get(id) || empty();
  return { ...draft, preparing, busy: !!workingProjectId, workingProjectId, addFiles, run, stop: () => { stopped.current = true; },
    setSelection: (selection: NarrationBatchSelection) => { if (!working.current) update(id, current => ({ ...current, selection })); },
    setScene: (rowId: string, sceneId: string) => { if (!working.current) patch(id, rowId, { sceneId, status: "ready", message: undefined }); },
    remove: (rowId?: string) => {
      if (working.current || preparingRef.current) return;
      update(id, current => { for (const row of current.rows.filter(item => !rowId || item.id === rowId)) if (row.previewUrl) URL.revokeObjectURL(row.previewUrl); return { ...current, rows: rowId ? current.rows.filter(row => row.id !== rowId) : [], error: "" }; });
    },
  };
}
export type SceneNarrationBatchController = ReturnType<typeof useSceneNarrationBatch>;
