import { useEffect, useRef, useState } from "react";
import { batchVisualFingerprint, inspectBatchImage, MAX_BATCH_BYTES, MAX_BATCH_IMAGES, suggestedSceneId, type BatchImageRequest, type BatchSelection } from "./scene-image-batch";
import type { ProjectData } from "./types";

export type BatchRow = { id: string; file: File; previewUrl: string; sceneId: string; status: "checking" | "ready" | "uploading" | "done" | "error"; invalid?: boolean; message?: string };
type Draft = { rows: BatchRow[]; selection: BatchSelection; error: string };
const emptyDraft = (): Draft => ({ rows: [], selection: "keep", error: "" });

// Kept at the Studio root: scene navigation and project switching do not lose
// upload results or turn a retry into a second upload of successful files.
export function useSceneImageBatch(project: ProjectData | null, onImport: (request: BatchImageRequest) => Promise<string>) {
  const drafts = useRef(new Map<string, Draft>());
  const importer = useRef(onImport); importer.current = onImport;
  const working = useRef(false), stop = useRef(false), alive = useRef(true);
  const [, redraw] = useState(0);
  const [workingProjectId, setWorkingProjectId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const update = (id: string, change: (draft: Draft) => Draft) => {
    drafts.current.set(id, change(drafts.current.get(id) || emptyDraft()));
    if (alive.current) redraw(value => value + 1);
  };
  const updateRow = (id: string, rowId: string, patch: Partial<BatchRow>) => update(id, draft => ({ ...draft, rows: draft.rows.map(row => row.id === rowId ? { ...row, ...patch } : row) }));
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stop.current = true; for (const draft of drafts.current.values()) for (const row of draft.rows) URL.revokeObjectURL(row.previewUrl); };
  }, []);
  useEffect(() => {
    if (!workingProjectId) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [workingProjectId]);

  const addFiles = async (files: File[]) => {
    if (!project || !files.length || working.current || preparingRef.current) return;
    const id = project.id, draft = drafts.current.get(id) || emptyDraft();
    if (draft.rows.length + files.length > MAX_BATCH_IMAGES || draft.rows.reduce((sum, row) => sum + row.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      update(id, current => ({ ...current, error: "한 묶음은 최대 40장·합계 120MB입니다. 목록을 비우거나 파일 수를 줄여 주세요." }));
      return;
    }
    preparingRef.current = true; setPreparing(true);
    const rows: BatchRow[] = files.map(file => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), sceneId: suggestedSceneId(file.name, project.scenes), status: "checking" }));
    update(id, current => ({ ...current, rows: [...current.rows, ...rows], error: "" }));
    try {
      for (const row of rows) {
        if (!alive.current) break;
        try { await inspectBatchImage(row.file); updateRow(id, row.id, { status: "ready" }); }
        catch (error) { updateRow(id, row.id, { status: "error", invalid: true, message: (error as Error).message }); }
      }
    } finally { preparingRef.current = false; if (alive.current) setPreparing(false); }
  };

  const run = async (retryOnly = false) => {
    if (!project || working.current || preparingRef.current) return;
    const id = project.id, draft = drafts.current.get(id) || emptyDraft();
    const rows = draft.rows.filter(row => row.sceneId && !row.invalid && row.status === (retryOnly ? "error" : "ready"));
    if (!rows.length) return;
    working.current = true; stop.current = false; setWorkingProjectId(id);
    try {
      update(id, current => ({ ...current, error: "" }));
      const first = new Map<string, string>();
      for (const row of draft.rows) if (row.sceneId && !row.invalid && !first.has(row.sceneId)) first.set(row.sceneId, row.id);
      const requests = rows.map(row => {
        const scene = project.scenes.find(item => item.id === row.sceneId);
        const selection: BatchImageRequest["selection"] = first.get(row.sceneId) !== row.id ? "candidate" : draft.selection === "replace" ? "replace" : "fill";
        return { row, request: scene ? { projectId: id, sceneId: scene.id, file: row.file, selection, expectedVisual: batchVisualFingerprint(scene) } : null };
      });
      for (const { row, request } of requests) {
        if (stop.current || !alive.current) break;
        if (!request) { updateRow(id, row.id, { status: "error", message: "장면이 없어졌습니다. 연결할 장면을 다시 선택해 주세요." }); continue; }
        updateRow(id, row.id, { status: "uploading", message: undefined });
        try { const message = await importer.current(request); updateRow(id, row.id, { status: "done", message }); }
        catch (error) { updateRow(id, row.id, { status: "error", message: (error as Error).message }); }
      }
    } catch (error) { update(id, current => ({ ...current, error: (error as Error).message })); }
    finally { working.current = false; if (alive.current) setWorkingProjectId(""); }
  };
  const id = project?.id || "", draft = drafts.current.get(id) || emptyDraft();
  return { ...draft, preparing, busy: !!workingProjectId, workingProjectId, addFiles, run,
    stop: () => { stop.current = true; },
    setSelection: (selection: BatchSelection) => { if (!working.current) update(id, current => ({ ...current, selection })); },
    setScene: (rowId: string, sceneId: string) => {
      if (working.current) return;
      const row = draft.rows.find(row => row.id === rowId);
      updateRow(id, rowId, { sceneId, ...(row?.status === "error" && !row.invalid ? { status: "ready", message: undefined } : {}) });
    },
    remove: (rowId?: string) => {
      if (working.current || preparingRef.current) return;
      update(id, current => { const removed = current.rows.filter(row => !rowId || row.id === rowId); for (const row of removed) URL.revokeObjectURL(row.previewUrl); return { ...current, rows: current.rows.filter(row => rowId && row.id !== rowId), error: "" }; });
    },
  };
}

export type SceneImageBatchController = ReturnType<typeof useSceneImageBatch>;
