import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./v2.css";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  Music2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Undo2,
  Redo2,
  WandSparkles,
} from "lucide-react";
import { createProjectDraft, DEFAULT_STYLE, parseWorkText } from "./parser";
import { completionErrors, createV2ProjectDraft, parseAppData, reportForProject } from "./app-data";
import { composeScenePrompt, composeThumbnailPrompt } from "./prompts";
import { createNumberedProject, getNextProjectEpisode, deleteCandidateAsset, deleteProject, downloadBlob, exportProjectZip, generateImages, getAccessCode, getBackgroundMusic, getRenderedVideo, importImageCandidates, importSceneVideo, isTauri, listProjects, removeBackgroundMusic, removeSceneNarration, resolveReferenceImage, saveBackgroundMusic, savePreparedNarration, saveProject, saveRenderedVideo } from "./platform";
import { findCandidate, withoutAssetCandidate, withoutSceneCandidate } from "./candidates";
import { buildVideoPlan, renderProjectMp4, resolveVideoIntroImage, sceneMusicVolume } from "./video";
import { SceneNarrationPanel } from "./SceneNarrationPanel";
import { applyGeneratedNarration, type GeneratedNarrationRequest } from "./narration-generation";
import { SceneTimingPanel } from "./SceneTimingPanel";
import { FullVideoPreview } from "./FullVideoPreview";
import { SceneReviewBoard } from "./SceneReviewBoard";
import { SceneImageBatch } from "./SceneImageBatch";
import { SceneNarrationBatch } from "./SceneNarrationBatch";
import { SceneNarrationExport } from "./SceneNarrationExport";
import { useProjectExportSelection, type ProjectExportSelection } from "./useProjectExportSelection";
import { useSceneNarrationBatch, type SceneNarrationBatchController } from "./useSceneNarrationBatch";
import { applyBatchNarration, planBatchNarration, retainBatchNarration, type BatchNarrationRequest, type BatchNarrationResult } from "./scene-narration-batch";
import { ScenePromptExport, useScenePromptExport, type ScenePromptExportController } from "./ScenePromptExport";
import { useSceneImageBatch, type SceneImageBatchController } from "./useSceneImageBatch";
import { attachBatchImage, type BatchImageRequest } from "./scene-image-batch";
import { applyComparedImage, type ImageComparisonRequest, type ImageComparisonResult } from "./image-comparison";
import { ImageComparison } from "./ImageComparison";
import { ImageLibrary } from "./ImageLibrary";
import { ExportMediaCheck } from "./ExportMediaCheck";
import { useExportMediaCheck, type ExportMediaCheckController } from "./useExportMediaCheck";
import type { CheckLocation } from "./export-media-check";
import { originalImage, originalCandidateId, restoreImageCandidate, type RestoreImageRequest, type RestoreImageResult } from "./image-library";
import { readOriginalImageCandidate } from "./library-image-reader";
import { createReviewView, type ReviewView } from "./scene-review";
import { ScenePreviewPane } from "./SceneTimeline";
import { SAMPLE_WORK_TEXT } from "./sample";
import { PersonPicker } from "./PersonPicker";
import { useStepHistory } from "./useStepHistory";
import { useEditorHistory } from "./useEditorHistory";
import type { EditOptions } from "./editor-history";
import { assertEditorReadable, assertEditorWrite, isCoreScene, prepareEditorWrite } from "./editor-format";
import { proposeNarrationTiming, timingFingerprint, type TimingRequest } from "./timeline";
import { AccountMenu, AuthGate } from "./Auth";
import { checkCloudStorage, cloudContext } from "./cloud";
import { mergeProjectChanges } from "./project-changes";
import { candidateAssetId, collectMediaAssets, narrationAssetId, prepareMediaProject, visualSelectionFingerprint } from "./media-composition";
import { moveScene, orderedScenes } from "./scene-order";
import { splitBoundaries, splitScene } from "./scene-split";
import { mergeScene, sceneMergeTarget } from "./scene-merge";
import { hasSceneNarration } from "./scene-audio";
import { LocalProjectImport } from "./LocalProjectImport";
import { VisitorTrends } from "./VisitorTrends";
import type { ImageCandidate, ImageMotion, ProjectData, Scene, VisualAsset } from "./types";

import { STUDIO_STEPS as STEPS, NEXT_STEP_LABELS, nextStepBlock, canVisitStudioStep, ReviewOverview, ReviewToolLinks } from "./StudioWorkflow";

function SceneMergePanel({ project, scene, onMerge }: { project: ProjectData; scene: Scene; onMerge: (projectId: string, sceneId: string, nextId: string) => void }) {
  const target = sceneMergeTarget(project, scene.id);
  return <section className="panel scene-split-panel" aria-label="장면 합치기"><div><strong>다음 장면과 합치기</strong><small>두 장면의 화면·녹음·자막을 순서대로 이어 붙입니다. 원본과 전체 영상 길이를 유지하며 실행 취소 한 번으로 되돌립니다.</small></div>
    <p aria-live="polite">{target.error || `Scene ${scene.number} + Scene ${target.second.number} · ${target.second.title} · ${scene.duration ?? 10}초 + ${target.second.duration ?? 10}초 → ${target.duration}초`}</p>
    <button className="btn ghost" disabled={!!target.error} onClick={() => onMerge(project.id, scene.id, target.second.id)}>다음 장면과 합치기</button>
  </section>;
}

function SceneSplitPanel({ project, scene, onSplit }: { project: ProjectData; scene: Scene; onSplit: (projectId: string, sceneId: string, captionId: string) => void }) {
  const boundaries = splitBoundaries(project, scene);
  const [selected, setSelected] = useState("");
  const boundary = boundaries.find(item => item.caption_id === selected) || boundaries.find(item => !item.error) || boundaries[0];
  const format = (value: number) => `${Number(value.toFixed(3))}초`;
  return <section className="panel scene-split-panel" aria-label="장면 나누기"><div><strong>자막 경계에서 장면 나누기</strong><small>선택한 자막부터 다음 장면으로 옮깁니다. 화면·녹음의 원본 구간과 전체 길이는 유지됩니다.</small></div>
    {boundaries.length ? <><label>다음 장면의 첫 자막<select aria-label="장면을 나눌 자막 경계" value={boundary?.caption_id} onChange={event => setSelected(event.target.value)}>{boundaries.map(item => <option key={item.caption_id} value={item.caption_id}>{format(item.seconds)} · {item.after.slice(0, 70)}{item.error ? " · 분할 불가" : ""}</option>)}</select></label>
      <p aria-live="polite">{boundary?.error || `앞 장면 ${format(boundary!.seconds)} · 뒤 장면 ${format((scene.duration ?? 10) - boundary!.seconds)}`}</p></> : <p>{project.schema_version === "2.1" ? "자막이 두 개 이상 있는 장면에서 사용할 수 있습니다." : "APP_DATA 2.1의 자막 경계가 있는 장면에서 사용할 수 있습니다."}</p>}
    <button className="btn ghost" disabled={!boundary || !!boundary.error} onClick={() => boundary && onSplit(project.id, scene.id, boundary.caption_id)}>장면 나누기</button>
  </section>;
}

function App() {
  return <AuthGate><Studio /></AuthGate>;
}

function Studio() {
  const [step, setStep] = useState(0);
  const [episode, setEpisode] = useState(1);
  const [person, setPerson] = useState("");
  const [category, setCategory] = useState("장군 · 지도자");
  const [source, setSource] = useState("");
  const [legacyImport, setLegacyImport] = useState(false);
  const [setupErrors, setSetupErrors] = useState<string[]>([]);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [accessCode] = useState(getAccessCode);
  const cloud = !!cloudContext();
  const [storageReady, setStorageReady] = useState(!cloud);
  const [storageLoading, setStorageLoading] = useState(cloud);
  const [saveCount, setSaveCount] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [importing, setImporting] = useState(false);
  const [restoringImage, setRestoringImage] = useState(false);
  const restoreWorking = useRef(false);
  const narrationWorking = useRef(false), narrationBatchBusy = useRef(false);
  const saveFailures = useRef(new Map<string, string>());
  const projectRef = useRef(project);
  const latestProjects = useRef(new Map<string, ProjectData>());
  const pendingSaves = useRef(0);
  const loadVersion = useRef(0);
  const [activeScenes, setActiveScenes] = useState<Record<string, string>>({});
  const reviewViews = useRef(new Map<string, ReviewView>());
  const reviewView = project ? reviewViews.current.get(project.id) || createReviewView() : undefined;
  if (project && reviewView) reviewViews.current.set(project.id, reviewView);
  const { history, refresh: refreshHistory } = useEditorHistory();
  const selectProject = (value: ProjectData | null) => { history.reset(value?.id || null); projectRef.current = value; setProject(value); };
  const storageStatus = saveError ? "저장 실패 · 확인 필요" : saveCount ? "변경사항 저장 중…"
    : cloud ? storageReady ? "계정에 저장됨" : "계정 저장 연결 확인 필요" : "이 브라우저에 저장됨";

  const reloadProjects = async (discardChanges = false) => {
    if (pendingSaves.current || restoreWorking.current || narrationWorking.current || narrationBatchBusy.current || (saveError && !discardChanges)) { setNotice("저장이 끝난 뒤 새로고침해 주세요. 저장 실패 시 현재 작업의 ZIP을 먼저 보관해 주세요."); return; }
    const version = ++loadVersion.current;
    setStorageLoading(true);
    try {
      if (cloud) {
        const readiness = await checkCloudStorage();
        if (version !== loadVersion.current) return;
        if (!readiness.databaseReady || !readiness.storageReady) { setStorageReady(false); return; }
      }
      const items = await listProjects();
      if (version !== loadVersion.current) return;
      latestProjects.current = new Map(items.map(item => [item.id, item]));
      setProjects(items); setStorageReady(true);
      if (discardChanges) {
        saveFailures.current.clear(); setSaveError(""); setNotice("");
        const selected = items.find(item => item.id === projectRef.current?.id);
        history.reset(selected?.id || null, true); refreshHistory();
        selectProject(selected || null);
        if (!selected) setStep(0);
      }
    } catch (error) {
      if (version === loadVersion.current) { if (cloud) setStorageReady(false); setNotice(`프로젝트 목록을 읽지 못했습니다: ${String(error)}`); }
    } finally { if (version === loadVersion.current) setStorageLoading(false); }
  };

  useStepHistory(step, project?.id, (location) => {
    const saved = location.projectId
      ? projects.find((item) => item.id === location.projectId) || (project?.id === location.projectId ? project : null)
      : null;
    if (saved) {
      try { assertEditorReadable(saved); }
      catch (error) { setNotice((error as Error).message); selectProject(null); setStep(0); return; }
    }
    selectProject(saved);
    if (saved && location.sceneId) setActiveScenes(previous => ({ ...previous, [saved.id]: location.sceneId! }));
    setStep(location.step > 1 && !saved ? 0 : location.step === 8 && saved && !canVisitStudioStep(saved, 8) ? 7 : location.step);
  }, step === 5 && project ? activeScenes[project.id] : undefined);

  useEffect(() => {
    void reloadProjects();
    return () => { loadVersion.current++; };
  }, []);

  useEffect(() => {
    if (!saveCount && !saveError && !restoringImage) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveCount, saveError, restoringImage]);

  useEffect(() => {
    if (step === 1) {
      let active = true;
      getNextProjectEpisode().then((next) => { if (active) setEpisode(next); })
        .catch((error) => { if (active) setNotice(`회차를 확인하지 못했습니다: ${String(error)}`); });
      return () => { active = false; };
    }
  }, [step]);

  const navigationBlock = useMemo(() => project ? nextStepBlock(project, step) : "", [project, step]);
  useLayoutEffect(() => {
    if (step !== 7) window.scrollTo({ top: 0, behavior: "instant" });
    const navigation = document.querySelector<HTMLElement>(".steps"), current = navigation?.querySelector<HTMLElement>("[aria-current='step']");
    const reveal = () => { if (navigation && current && navigation.scrollWidth > navigation.clientWidth) navigation.scrollLeft += current.getBoundingClientRect().left - navigation.getBoundingClientRect().left - (navigation.clientWidth - current.clientWidth) / 2; };
    reveal();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(reveal);
    if (navigation) observer?.observe(navigation);
    return () => observer?.disconnect();
  }, [step, project?.id]);

  const prepareProject = async () => {
    if (!source.trim()) return setNotice("ChatGPT Work 결과를 붙여넣어 주세요.");
    setBusy(true);
    try {
      let draft: ProjectData;
      if (legacyImport) draft = createProjectDraft(episode, person, category, source);
      else {
        const { data, report } = parseAppData(source);
        if (report.errors.length) { setSetupErrors(report.errors); return; }
        if (person.trim() && person.replace(/\s/g, "") !== data.person.name.replace(/\s/g, "")) {
          setSetupErrors([`선택·입력한 인물은 '${person.trim()}'이고 APP_DATA의 인물은 '${data.person.name}'입니다. 같은 인물명으로 맞춰 주세요.`]);
          return;
        }
        draft = createV2ProjectDraft(episode, category, source, data, report);
      }
      setSetupErrors([]);
      draft = await createNumberedProject(draft);
      latestProjects.current.set(draft.id, draft);
      selectProject(draft);
      setProjects((items) => [draft, ...items]);
      setPerson(draft.person);
      setNotice(draft.scenes.length ? `${draft.scenes.length}개 장면을 찾았습니다.` : "");
      setStep(2);
    } catch (error) {
      setSetupErrors([String(error)]);
    } finally {
      setBusy(false);
    }
  };

  const persist = async (next: ProjectData, options: EditOptions = {}) => {
    const current = latestProjects.current.get(next.id) || next;
    // In-flight callbacks from this client may predate an editor-format upgrade.
    // Merge their changed fields into the current version without downgrading it.
    next = { ...next, editor_version: Math.max(next.editor_version ?? 0, current.editor_version ?? 0) };
    let merged: ProjectData;
    try {
      assertEditorReadable(next);
      merged = prepareEditorWrite(prepareMediaProject(mergeProjectChanges(options.base || project, next, current), current));
      assertEditorWrite(merged, current);
    }
    catch (error) { setNotice((error as Error).message); return; }
    const previousTime = Date.parse(current.updated_at);
    const updated = { ...merged, updated_at: new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString(), app_state: merged.schema_version !== 1 ? {
      ...merged.app_state,
      selected_character_image: merged.anchor.selected_candidate_id,
      selected_scene_images: Object.fromEntries(merged.scenes.filter((scene) => scene.selected_candidate_id).map((scene) => [scene.id, scene.selected_candidate_id!])),
      selected_thumbnail: merged.thumbnail.selected_candidate_id,
      warnings: reportForProject(merged).warnings,
    } : merged.app_state };
    if (projectRef.current?.id === updated.id) {
      if (options.history === false) history.reconcile(updated);
      else history.record(current, updated, options.label, options.structure, options.narration);
      refreshHistory();
    }
    latestProjects.current.set(updated.id, updated);
    if (projectRef.current?.id === updated.id) selectProject(updated);
    setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    pendingSaves.current++; setSaveCount(pendingSaves.current);
    try {
      await saveProject(updated);
      if (latestProjects.current.get(updated.id) === updated) saveFailures.current.delete(updated.id);
      setSaveError([...saveFailures.current.values()].join("\n"));
    } catch (error) {
      saveFailures.current.set(updated.id, String(error));
      setSaveError([...saveFailures.current.values()].join("\n")); setNotice(`저장 실패: ${String(error)}`);
    } finally { pendingSaves.current--; setSaveCount(pendingSaves.current); }
  };

  const download = async (item: ProjectData) => {
    try { await exportProjectZip(item); }
    catch (error) { setNotice(`ZIP 내보내기 실패: ${String(error)}`); }
  };

  const removeProject = async (item: ProjectData) => {
    if (batchImages.busy || restoreWorking.current || narrationWorking.current || narrationBatchBusy.current) { setNotice("파일 연결이 끝나거나 중단된 후 프로젝트를 삭제해 주세요."); return; }
    const label = `EP. ${String(item.episode).padStart(3, "0")} · ${item.person} (${item.folder_name})`;
    const consequence = isTauri()
      ? "프로젝트 폴더는 projects/.trash로 이동하며 앱 목록에서 사라집니다."
      : cloud ? "계정에 저장된 프로젝트·이미지·동영상·녹음·완성 MP4가 함께 삭제되며 복구할 수 없습니다."
        : "이 브라우저에 저장된 프로젝트·후보 이미지·완성 MP4가 함께 삭제되며 복구할 수 없습니다.";
    if (!window.confirm(`${label}\n\n${consequence}\n\n정말 삭제할까요?`)) return;
    setDeletingId(item.id);
    try {
      await deleteProject(item);
      setProjects((items) => items.filter((saved) => saved.id !== item.id));
      latestProjects.current.delete(item.id);
      saveFailures.current.delete(item.id); setSaveError([...saveFailures.current.values()].join("\n"));
      if (projectRef.current?.id === item.id) selectProject(null);
      setNotice(isTauri() ? `${label} 프로젝트를 휴지통으로 옮겼습니다.` : `${label} 프로젝트를 삭제했습니다.`);
    } catch (error) { setNotice(`프로젝트 삭제 실패: ${String(error)}`); }
    finally { setDeletingId(""); }
  };

  const updateScene = async (scene: Scene, options?: EditOptions) => {
    if (!project) return;
    const current = latestProjects.current.get(project.id);
    const baseScene = project.scenes.find(item => item.id === scene.id);
    if (current && !current.scenes.some(item => item.id === scene.id) && options?.history === false && baseScene) {
      history.captureDetachedScene(project.id, baseScene, scene);
      const assets = collectMediaAssets({ ...current, scenes: [scene] });
      const retained = new Map(current.media?.assets.map(asset => [asset.id, asset]));
      for (const asset of assets) if (!retained.has(asset.id)) retained.set(asset.id, asset);
      const owner = current.scenes.find(item => item.merge_origin?.scene_ids.includes(scene.id));
      const additions = (before: ImageCandidate[] = [], next: ImageCandidate[] = [], existing: ImageCandidate[] = []) => [...existing, ...next.filter(candidate => !before.some(item => item.id === candidate.id) && !existing.some(item => item.id === candidate.id))];
      const scenes = current.scenes.map(item => item.id === owner?.id ? { ...item, candidates: additions(baseScene.candidates, scene.candidates, item.candidates), support_candidates: additions(baseScene.support_candidates, scene.support_candidates, item.support_candidates) } : item);
      await persist({ ...current, scenes, media: { assets: [...retained.values()] } }, { history: false, base: current });
      return;
    }
    await persist({ ...project, scenes: project.scenes.map((item) => (item.id === scene.id ? scene : item)) }, options);
  };

  const divideScene = (projectId: string, sceneId: string, captionId: string) => {
    const current = latestProjects.current.get(projectId);
    if (!current) return;
    try { void persist(splitScene(current, sceneId, captionId), { base: current, label: "장면 나누기", structure: true }); }
    catch (error) { setNotice((error as Error).message); }
  };

  const combineScene = (projectId: string, sceneId: string, nextId: string) => {
    const current = latestProjects.current.get(projectId);
    if (!current) return;
    try { void persist(mergeScene(current, sceneId, nextId), { base: current, label: "장면 합치기", structure: true }); }
    catch (error) { setNotice((error as Error).message); }
  };

  const changeSceneOrder = (projectId: string, sceneId: string, direction: -1 | 1) => {
    const current = latestProjects.current.get(projectId);
    if (!current) return;
    try {
      const next = moveScene(current, sceneId, direction);
      if (next !== current) void persist(next, { base: current, label: "장면 순서 변경" });
    } catch (error) { setNotice((error as Error).message); }
  };

  const applyNarrationTiming = (request: TimingRequest) => {
    const current = latestProjects.current.get(request.projectId);
    if (!current || timingFingerprint(current) !== request.expected) throw new Error("시간이나 녹음이 변경되었습니다. 최신 조정안을 확인하고 다시 적용해 주세요.");
    assertEditorReadable(current);
    const proposal = proposeNarrationTiming(current, request.sceneId, request.narrationDuration, request.mode);
    const next = request.narration ? { ...proposal.project, scenes: proposal.project.scenes.map(scene => scene.id === request.sceneId ? { ...scene, narration_audio: request.narration } : scene) } : proposal.project;
    void persist(next, { base: current, label: "녹음 길이에 맞추기" });
  };

  const selectGeneratedNarration = (request: GeneratedNarrationRequest) => {
    const current = latestProjects.current.get(request.projectId);
    if (!current) throw new Error("음성을 적용할 프로젝트를 찾지 못했습니다.");
    assertEditorReadable(current);
    void persist(applyGeneratedNarration(current, request), { base: current, label: "AI 내레이션 적용", narration: true });
  };

  const importBatchImage = async (request: BatchImageRequest) => {
    const before = latestProjects.current.get(request.projectId);
    const scene = before?.scenes.find(item => item.id === request.sceneId);
    if (!before || !scene) throw new Error("연결할 장면이 없어졌습니다. 장면을 다시 선택해 주세요.");
    assertEditorReadable(before);
    const [candidate] = await importImageCandidates([request.file], { project_path: before.project_path, asset_kind: "scene", scene_number: scene.number });
    const current = latestProjects.current.get(request.projectId);
    if (!current) throw new Error("프로젝트를 찾지 못했습니다.");
    const result = attachBatchImage(current, request, candidate);
    await persist(result.project, { base: current, history: result.selected ? undefined : false, label: result.selected ? "이미지 일괄 배치" : undefined });
    return result.note + (saveFailures.current.has(current.id) ? " 프로젝트 저장은 상단에서 다시 시도해 주세요." : "");
  };
  const batchImages = useSceneImageBatch(project, importBatchImage);
  const importBatchNarration = async (request: BatchNarrationRequest): Promise<BatchNarrationResult> => {
    if (narrationWorking.current) throw new Error("다른 녹음을 연결하고 있습니다. 완료 후 다시 시도해 주세요.");
    narrationWorking.current = true;
    let saved = request.saved;
    try {
      const before = latestProjects.current.get(request.projectId);
      if (!before) throw new Error("녹음을 연결할 프로젝트가 없습니다.");
      assertEditorReadable(before);
      const planned = planBatchNarration(before, request);
      if (!saved) saved = { originSceneId: request.sceneId, narration: await savePreparedNarration(planned, planned.scenes.find(scene => scene.id === request.sceneId)!, request.prepared) };
      const current = latestProjects.current.get(request.projectId);
      if (!current) throw new Error("녹음을 연결할 프로젝트가 없습니다.");
      const retained = retainBatchNarration(current, saved.originSceneId, saved.narration);
      saved = { ...saved, narration: retained.narration };
      let next: ProjectData;
      try { next = prepareEditorWrite(applyBatchNarration(retained.project, request, saved.narration)); assertEditorWrite(next, current); }
      catch (cause) {
        if (retained.project !== current) { const kept = prepareEditorWrite(retained.project); assertEditorWrite(kept, current); await persist(kept, { base: current, history: false }); }
        return { saved, applied: false, note: `원본은 보관했습니다. ${(cause as Error).message} 저장한 파일은 재시도에서 재사용합니다.` };
      }
      await persist(next, { base: current, label: request.timing ? "일괄 녹음 시간 조정·적용" : "내레이션 일괄 배치", narration: true });
      const latest = latestProjects.current.get(request.projectId)?.scenes.find(scene => scene.id === request.sceneId);
      const applied = !!latest && narrationAssetId(latest) === saved.narration.asset_id;
      return { saved, applied, note: (applied ? "녹음을 적용했습니다." : "연결 후 장면이나 녹음이 바뀌었습니다. 최신 연결안을 확인해 주세요.") + (saveFailures.current.has(request.projectId) ? " 프로젝트 저장은 상단에서 다시 시도해 주세요." : "") };
    } catch (cause) {
      if (saved) return { saved, applied: false, note: `저장한 녹음을 재사용할 수 있습니다. ${(cause as Error).message}` };
      throw cause;
    } finally { narrationWorking.current = false; }
  };
  const batchNarrations = useSceneNarrationBatch(project, importBatchNarration);
  narrationBatchBusy.current = batchNarrations.busy;
  const promptExport = useScenePromptExport(project);
  const narrationExport = useProjectExportSelection(project);
  const mediaCheck = useExportMediaCheck(project);
  const [mediaCheckReturn, setMediaCheckReturn] = useState<{ projectId: string; scrollY: number }>();
  const openMediaCheckLocation = (location: CheckLocation) => {
    if (!project) return;
    setMediaCheckReturn({ projectId: project.id, scrollY: window.scrollY });
    if (location.target === "scene" && location.sceneId) { setActiveScenes(previous => ({ ...previous, [project.id]: location.sceneId! })); setStep(5); }
    else setStep(location.target === "thumbnail" ? 6 : location.target === "music" ? 5 : 2);
  };
  useEffect(() => {
    if (step !== 7 || !mediaCheckReturn || mediaCheckReturn.projectId !== project?.id) return;
    const frame = window.requestAnimationFrame(() => { window.scrollTo({ top: mediaCheckReturn!.scrollY, behavior: "instant" }); document.querySelector<HTMLElement>("button[aria-label='전체 출력 자료 점검']")?.focus({ preventScroll: true }); setMediaCheckReturn(undefined); });
    return () => window.cancelAnimationFrame(frame);
  }, [step, project?.id, mediaCheckReturn]);

  const confirmComparedImage = async (request: ImageComparisonRequest): Promise<ImageComparisonResult> => {
    const current = latestProjects.current.get(request.projectId);
    if (!current) throw new Error("이미지를 선택할 프로젝트를 찾지 못했습니다.");
    const applied = applyComparedImage(current, request);
    if (applied === current) return saveFailures.current.has(current.id) ? "unsaved" : "saved";
    const next = prepareEditorWrite(applied);
    assertEditorWrite(next, current);
    const expected = visualSelectionFingerprint(next.scenes.find(scene => scene.id === request.sceneId)!);
    await persist(next, { base: current, label: "비교 이미지 선택" });
    const latest = latestProjects.current.get(request.projectId)?.scenes.find(scene => scene.id === request.sceneId);
    if (!latest || visualSelectionFingerprint(latest) !== expected) return "changed";
    return saveFailures.current.has(current.id) ? "unsaved" : "saved";
  };

  const restoreOriginalImage = async (request: RestoreImageRequest): Promise<RestoreImageResult> => {
    if (restoreWorking.current) throw new Error("다른 원본 이미지를 연결하고 있습니다. 완료 후 다시 시도해 주세요.");
    restoreWorking.current = true; setRestoringImage(true); setNotice("");
    try {
      const before = latestProjects.current.get(request.projectId);
      if (!before) throw new Error("이미지를 복원할 프로젝트가 없습니다.");
      assertEditorReadable(before);
      const asset = originalImage(before, request);
      const scene = before.scenes.find(item => item.id === request.sceneId)!;
      if (scene.candidates.some(candidate => candidate.id === originalCandidateId(asset))) return { sceneId: scene.id, message: `Scene ${scene.number}의 후보에 이미 있습니다. 현재 화면은 유지했습니다.` };
      const candidate = await readOriginalImageCandidate(before, asset);
      const current = latestProjects.current.get(request.projectId);
      if (!current) throw new Error("이미지를 복원할 프로젝트가 없습니다.");
      const latestAsset = originalImage(current, request);
      if (latestAsset.inline_data !== asset.inline_data) throw new Error("원본 이미지 내용이 변경되었습니다. 보관함에서 다시 선택해 주세요.");
      const restored = restoreImageCandidate(current, request, candidate);
      if (restored !== current) {
        const next = prepareEditorWrite(restored); assertEditorWrite(next, current);
        await persist(next, { base: current, history: false });
      }
      const latest = latestProjects.current.get(request.projectId)?.scenes.find(item => item.id === request.sceneId);
      if (!latest?.candidates.some(item => candidateAssetId(item) === asset.id)) return { sceneId: request.sceneId, message: "원본 연결 후 장면이 변경되었습니다. 최신 작업 보드에서 확인해 주세요." };
      return { sceneId: latest.id, message: `Scene ${latest.number} 후보에 추가했습니다. 현재 화면은 유지했습니다.${saveFailures.current.has(current.id) ? " 프로젝트 저장은 상단에서 다시 시도해 주세요." : ""}` };
    } catch (cause) { setNotice(`원본 후보 추가 실패: ${(cause as Error).message}`); throw cause; }
    finally { restoreWorking.current = false; setRestoringImage(false); }
  };

  const openReviewScene = (sceneId: string) => {
    if (!project) return;
    const current = latestProjects.current.get(project.id) || project;
    if (!current.scenes.some(scene => scene.id === sceneId)) { setNotice("이 장면이 변경되었습니다. 최신 작업 보드에서 다시 선택해 주세요."); return; }
    setActiveScenes(previous => ({ ...previous, [project.id]: sceneId }));
    setStep(5);
  };

  const travelHistory = (direction: "undo" | "redo") => {
    const selected = projectRef.current;
    if (!selected) return;
    const current = latestProjects.current.get(selected.id) || selected;
    const result = history[direction](current);
    refreshHistory();
    if (result.status === "conflict") { setNotice("다른 변경이 반영되어 편집 이력을 초기화했습니다."); return; }
    if (result.status === "applied") void persist(result.project, { history: false, base: current });
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (step <= 1 || !projectRef.current || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      travelHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const reparseSource = async () => {
    if (!project) return;
    if (project.schema_version !== 1) { setNotice("v2 원본은 자동 재분석하지 않습니다. 새 APP_DATA로 별도 프로젝트를 만들어 주세요."); return; }
    const parsed = parseWorkText(project.source_text);
    const anchorPrompt = `${parsed.character_profile.description || `${parsed.person}, 역사적 복식, 차분하고 믿음직한 표정`}. 전신 또는 반신 인물 기준 시트, 정면, 단순한 배경, 동일 인물 유지용.`;
    const anchor = project.anchor.candidates.length ? project.anchor : {
      ...project.anchor,
      prompt: anchorPrompt,
      prompt_history: appendHistory(project.anchor.prompt_history, anchorPrompt),
    };
    await persist({ ...project, ...parsed, anchor });
    setNotice(`${parsed.scenes.length}개 장면을 다시 찾았습니다.`);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span>G</span></div>
          <div><strong>Great100</strong><small>STORY STUDIO</small></div>
        </div>
        <nav className="steps" aria-label="제작 단계">
          {STEPS.map((label, index) => (
            <button key={label} className={`step ${index === step ? "active" : ""}`} aria-current={index === step ? "step" : undefined} aria-describedby={index === 8 && project && !canVisitStudioStep(project, 8) ? "completion-navigation-hint" : undefined} title={index === 8 && project && !canVisitStudioStep(project, 8) ? "전체 검토에서 출력 전 확인 항목을 해결해 주세요." : undefined} onClick={() => setStep(index)} disabled={importing || !!deletingId || (index === 1 && !storageReady) || !canVisitStudioStep(project, index)}>
              <span>{index + 1}</span>{label}
            </button>
          ))}
        </nav>
        {project && !canVisitStudioStep(project, 8) && <span className="visually-hidden" id="completion-navigation-hint">전체 검토에서 출력 전 확인 항목을 해결하면 완료 화면으로 이동할 수 있습니다.</span>}
        <div className="sidebar-foot">
          <div className="mode-dot" />
              <div><strong>{isTauri() ? "내 컴퓨터에 저장" : accessCode ? "이미지 생성 연결됨" : "직접 제작 모드"}</strong><small>{isTauri() ? "프로젝트 폴더에서 보관" : cloud ? "계정에 저장 · 녹음은 선택" : "이미지 업로드 · 녹음은 선택"}</small></div>
        </div>
      </aside>

      <a className="skip-link" href="#studio-workspace">작업 화면으로 바로가기</a>
      <main id="studio-workspace" tabIndex={-1} onFocusCapture={() => history.breakGroup()} onBlurCapture={() => history.breakGroup()} onPointerDownCapture={() => history.breakGroup()} onPointerUpCapture={() => history.breakGroup()}>
        <header className="topbar">
          <div className="breadcrumb">한국을 빛낸 100인 <b>/</b> {project?.person || "새 프로젝트"}</div>
          {project && step > 1 && <div className="editor-history" role="group" aria-label="편집 이력">
            <button className="btn ghost" aria-label="실행 취소" title={history.undoLabel ? `${history.undoLabel} 되돌리기 · Ctrl/⌘ Z` : "되돌릴 편집이 없습니다"} disabled={!history.undoLabel} onClick={() => travelHistory("undo")}><Undo2 size={16} /><span>실행 취소</span></button>
            <button className="btn ghost" aria-label="다시 실행" title={history.redoLabel ? `${history.redoLabel} 다시 적용 · Ctrl/⌘ Shift Z` : "다시 적용할 편집이 없습니다"} disabled={!history.redoLabel} onClick={() => travelHistory("redo")}><Redo2 size={16} /><span>다시 실행</span></button>
          </div>}
          <div className="topbar-actions"><div className="stage-location" aria-label="현재 제작 단계"><small>{step > 1 ? `${step - 1} / 7 단계` : "시작하기"}</small><strong>{STEPS[step]}</strong></div><AccountMenu storageStatus={storageStatus} saving={saveCount > 0 || !!saveError || importing || !!deletingId || busy || batchImages.busy || batchNarrations.busy || restoringImage} /></div>
        </header>

        <section className={`workspace${step === 5 ? " scene-workspace-root" : ""}`}>
          {step !== 7 && mediaCheckReturn && mediaCheckReturn.projectId === project?.id && <div className="review-return-actions"><button type="button" className="btn ghost" onClick={() => setStep(7)}><ArrowLeft size={15} /> 자료 점검으로 돌아가기</button></div>}
          {restoringImage && step !== 7 && <div className="panel batch-toolbar" role="status"><LoaderCircle size={15} className="spin" /><span>원본 이미지를 장면 후보에 연결하고 있습니다. 전체 검토에서 결과를 확인할 수 있습니다.</span></div>}
          {batchNarrations.busy && step !== 7 && <div className="panel batch-toolbar" role="status"><LoaderCircle size={15} className="spin" /><span>녹음을 장면에 연결하고 있습니다. 전체 검토에서 결과를 확인할 수 있습니다.</span><button type="button" className="btn ghost" onClick={batchNarrations.stop}>현재 녹음 완료 후 중단</button></div>}
          {batchImages.busy && step !== 7 && <div className="panel batch-toolbar" role="status"><LoaderCircle size={15} className="spin" /><span>이미지를 장면에 연결하고 있습니다. 전체 검토에서 진행 상태를 확인할 수 있습니다.</span><button type="button" className="btn ghost" onClick={batchImages.stop}>현재 파일 완료 후 중단</button></div>}
          {notice && <div className="toast" onClick={() => setNotice("")}>{notice}</div>}
          {saveError && <div className="panel cloud-setup-panel" role="alert"><strong>계정에 저장하지 못한 변경사항이 있습니다.</strong><p>{saveError}</p><div className="dashboard-actions"><button className="btn ghost" disabled={saveCount > 0} onClick={() => { for (const id of saveFailures.current.keys()) { const item = latestProjects.current.get(id); if (item) void persist(item); } }}>저장 다시 시도</button><button className="btn ghost" onClick={() => { for (const id of saveFailures.current.keys()) { const item = latestProjects.current.get(id); if (item) void download(item); } }}>편집본 ZIP 보관</button><button className="btn ghost" disabled={saveCount > 0} onClick={() => { if (window.confirm("저장하지 못한 현재 편집 내용을 버리고 계정의 최신 작업을 불러올까요?\n\n현재 편집본이 필요하면 먼저 ZIP으로 보관해 주세요.")) void reloadProjects(true); }}>최신 작업 불러오기</button></div></div>}
          {step === 0 && cloud && !storageReady && <div className="panel cloud-setup-panel" role="status"><strong>{storageLoading ? "계정 저장소에 연결하고 있어요." : "계정 저장 연결을 준비하고 있어요."}</strong><p>연결이 완료되면 계정의 프로젝트와 파일을 불러올 수 있습니다. 기존 브라우저 작업은 그대로 보관돼 있습니다.</p><button className="btn ghost" disabled={storageLoading} onClick={() => void reloadProjects()}>연결 다시 확인</button></div>}
          {step === 0 && cloud && storageReady && <LocalProjectImport onImported={reloadProjects} onBusyChange={setImporting} />}
          {step === 0 && <Dashboard onStart={() => { selectProject(null); setStep(1); }} projects={projects} onOpen={(item) => { const selected = latestProjects.current.get(item.id) || item; try { assertEditorReadable(selected); } catch (error) { setNotice((error as Error).message); return; } selectProject(selected); setStep(2); }} onDownload={download} onDelete={removeProject} deletingId={deletingId} ready={storageReady && !importing && !deletingId && !batchImages.busy && !batchNarrations.busy && !restoringImage} onReload={reloadProjects} refreshing={storageLoading || saveCount > 0 || importing || !!deletingId || batchImages.busy || batchNarrations.busy || restoringImage} />}
          {step === 1 && (
            <ProjectSetup episode={episode} person={person} category={category} source={source} busy={busy} legacyImport={legacyImport} setLegacyImport={setLegacyImport} errors={setupErrors}
              setPerson={setPerson} setCategory={setCategory} setSource={setSource}
              onSample={() => { setSource(SAMPLE_WORK_TEXT); setPerson("이순신"); }} onBack={() => setStep(0)} onContinue={prepareProject} />
          )}
          {step === 2 && project && <ParseReview project={project} onChange={persist} onReparse={reparseSource} onError={setNotice} />}
          {step === 3 && project && <Preflight project={project} />}
          {step === 4 && project && <AssetStudio title="인물 기준 이미지" eyebrow="CHARACTER ANCHOR" description="얼굴 일관성을 위한 기준 이미지입니다. 업로드한 이미지가 있으면 생성 단계를 건너뛰어도 됩니다." asset={project.anchor} project={project} kind="anchor" onChange={(anchor, options) => persist({ ...project, anchor }, options)} />}
          {step === 5 && project && <><div className="review-return-actions">{reviewView?.anchor && <button type="button" className="btn ghost" onClick={() => { reviewView.returning = true; setStep(7); }}><ArrowLeft size={15} /> 작업 보드로 돌아가기</button>}</div><SceneStudio key={project.id} project={project} activeSceneId={activeScenes[project.id]} onActiveSceneChange={id => setActiveScenes(previous => ({ ...previous, [project.id]: id }))} onChange={updateScene} onProjectChange={persist} onTimingChange={applyNarrationTiming} onGeneratedNarration={selectGeneratedNarration} onMove={changeSceneOrder} onSplit={divideScene} onMerge={combineScene} /></>}
          {step === 6 && project && <AssetStudio title="썸네일 만들기" eyebrow="THUMBNAIL" description="대표 이미지를 선택하세요. 선택한 썸네일은 영상 마지막 인물 이름 화면의 배경에도 사용됩니다." asset={project.thumbnail} project={project} kind="thumbnail" onChange={(thumbnail, options) => persist({ ...project, thumbnail }, options)} />}
          {step === 7 && project && <ImageReview key={project.id} project={project} view={reviewView!} onOpenScene={openReviewScene} batch={batchImages} onCompareImage={confirmComparedImage} restoringImage={restoringImage} onRestoreImage={restoreOriginalImage} mediaCheck={mediaCheck} onOpenMediaCheck={openMediaCheckLocation} promptExport={promptExport} batchNarrations={batchNarrations} narrationExport={narrationExport} onThumbnail={() => setStep(6)} />}
          {step === 8 && project && <Complete project={project} onDownload={() => download(project)} />}
        </section>

        {step > 1 && project && (
          <footer className="bottom-bar">
            <button className="btn ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={17} /> 이전</button>
            <span aria-live="polite">{saveCount ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{storageStatus}{saveError && <button className="text-button" onClick={() => { if (projectRef.current) void persist(projectRef.current); }}>저장 다시 시도</button>}</span>
            {step < 8 && <div className="stage-next">{navigationBlock && <p id="stage-navigation-hint">{navigationBlock}</p>}<button className="btn primary" aria-label="다음 단계" aria-describedby={navigationBlock ? "stage-navigation-hint" : undefined} disabled={!!navigationBlock} onClick={() => setStep((value) => Math.min(8, value + 1))}>{NEXT_STEP_LABELS[step] || "다음 단계"} <ArrowRight size={17} /></button></div>}
          </footer>
        )}
      </main>
    </div>
  );
}

function Dashboard({ onStart, projects, onOpen, onDownload, onDelete, deletingId, ready, onReload, refreshing }: { onStart: () => void; projects: ProjectData[]; onOpen: (project: ProjectData) => void; onDownload: (project: ProjectData) => void; onDelete: (project: ProjectData) => void; deletingId: string; ready: boolean; onReload: () => Promise<void>; refreshing: boolean }) {
  return <div className="dashboard-page"><div className="hero-page">
    <div className="hero-copy">
      <div className="eyebrow">GREAT STORIES, BEAUTIFULLY MADE</div>
      <h1>한 사람의 이야기를<br /><em>한 편의 그림책처럼.</em></h1>
      <p>Work 제작안을 붙여넣으면 장면 이미지·동영상과 자막을 준비하고<br />직접 녹음한 내레이션과 배경음악을 더한 MP4까지 만들 수 있어요.</p>
      <ol className="dashboard-howto" aria-label="영상 제작 순서"><li><b>1</b>제작안 붙여넣기</li><li><b>2</b>이미지·녹음 준비</li><li><b>3</b>MP4 만들기</li></ol>
      <div className="dashboard-actions"><button className="btn primary large" disabled={!ready} onClick={onStart}><Plus size={19} /> 새 인물 프로젝트</button><button className="btn ghost" disabled={refreshing} onClick={() => void onReload()}><RefreshCw size={15} /> 작업 목록 새로고침</button></div>
    </div>
    <div className="hero-art" role="img" aria-label="100인의 이야기를 담은 현대적인 책 표지 디자인">
      <div className="collection-label"><span>THE GREAT100 COLLECTION</span><span>01 — 100</span></div>
      <div className="cover-stack" aria-hidden="true">
        <div className="cover-sheet cover-sheet-back" />
        <div className="cover-sheet cover-sheet-accent" />
        <div className="cover-sheet cover-sheet-main">
          <div className="cover-heading"><span>한국을 빛낸 100인</span><span className="cover-dot" /></div>
          <div className="cover-number">100<span>STORIES</span></div>
          <div className="cover-message">삶을 읽고,<br />이야기를 남기다.</div>
          <div className="cover-bottom"><span>GREAT100<br />STORY STUDIO</span><div className="cover-lines"><i /><i /><i /></div></div>
        </div>
      </div>
      <div className="collection-footer"><span>A LIFE. A STORY.</span><span>100인의 삶을 담다</span></div>
    </div>
  </div>
  <div className="dashboard-details"><VisitorTrends /><div className="dashboard-primary">
  {projects.length > 0 && <div className="recent-projects"><div className="recent-head"><h3>최근 프로젝트</h3><span>{projects.length}개</span></div><div className="recent-grid">{projects.map((item) => <div className="recent-card" key={item.id}><span>EP. {String(item.episode).padStart(3, "0")}</span><strong>{item.person}</strong><small>{item.scenes.length}개 장면 · {new Date(item.updated_at).toLocaleDateString("ko-KR")}</small><div><button className="btn ghost" onClick={() => onOpen(item)}>이어 작업하기</button>{!isTauri() && <button className="btn ghost" onClick={() => onDownload(item)}><Download size={14} /> ZIP</button>}<button className="btn ghost delete-project" disabled={deletingId === item.id} onClick={() => onDelete(item)}>{deletingId === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} 삭제</button></div></div>)}</div></div>}
  </div></div>
  </div>;
}

interface SetupProps {
  episode: number; person: string; category: string; source: string; busy: boolean;
  legacyImport: boolean; setLegacyImport: (value: boolean) => void; errors: string[];
  setPerson: (value: string) => void; setCategory: (value: string) => void; setSource: (value: string) => void;
  onSample: () => void; onBack: () => void; onContinue: () => void;
}

function ProjectSetup(props: SetupProps) {
  return <div className="page narrow">
    <button className="btn ghost" style={{ marginBottom: 16 }} onClick={props.onBack}><ArrowLeft size={17} /> 대시보드로 돌아가기</button>
    <PageHeading eyebrow="NEW PROJECT" title="새 이야기를 시작합니다" text="기본 정보와 ChatGPT Work에서 만든 제작안을 입력해 주세요." />
    <div className="panel form-panel">
      <div className="form-grid">
        <label><span>회차 · 자동 부여</span><input aria-label="자동 회차" type="number" readOnly value={props.episode} /><small>프로젝트 생성 시 확정됩니다.</small></label>
        <PersonPicker person={props.person} onPerson={props.setPerson} onCategory={props.setCategory} />
        <label><span>분야</span><select value={props.category} onChange={(e) => props.setCategory(e.target.value)}><option>장군 · 지도자</option><option>독립운동가</option><option>과학 · 발명</option><option>예술 · 문화</option><option>사상 · 교육</option><option>스포츠</option><option>기업 · 산업 · 경제</option></select></label>
      </div>
      <div className="source-head"><div><strong>{props.legacyImport ? "Legacy Markdown 제작안" : "APP_DATA JSON 붙여넣기"}</strong><small>{props.legacyImport ? "기존 자유형 제작안을 추정하여 읽습니다." : "순수 JSON 또는 ## APP_DATA가 포함된 Work 결과를 붙여넣으세요."}</small></div><button className="text-button" onClick={() => { props.setLegacyImport(!props.legacyImport); props.setSource(""); }}>{props.legacyImport ? "APP_DATA JSON 입력으로 전환" : "Legacy Import"}</button></div>
      {props.legacyImport && <button className="text-button" onClick={props.onSample}>이순신 예시 불러오기</button>}
      <textarea className="source-input" aria-label="제작안 붙여넣기" placeholder={props.legacyImport ? "기존 Markdown 제작안을 붙여넣으세요…" : "{\n  \"schema_version\": \"2.1\",\n  ...\n}"} value={props.source} onChange={(e) => props.setSource(e.target.value)} />
      <div className="style-note"><WandSparkles size={18} /><div><strong>공통 스타일 가이드</strong><p>{DEFAULT_STYLE}</p></div></div>
      {props.errors.length > 0 && <div className="error-banner" role="alert"><strong>입력 확인이 필요합니다</strong><ul>{props.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      <button className="btn primary wide" disabled={props.busy} onClick={props.onContinue}>{props.busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} 프로젝트 만들고 분석하기</button>
    </div>
  </div>;
}

function ParseReview({ project, onChange, onReparse, onError }: { project: ProjectData; onChange: (value: ProjectData) => void; onReparse: () => void; onError: (message: string) => void }) {
  if (project.schema_version !== 1) return <V2ParseReview project={project} />;
  const set = (patch: Partial<ProjectData>) => onChange({ ...project, ...patch });
  const editScene = (id: string, patch: Partial<Scene>) => set({ scenes: project.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) });
  const addScene = () => {
    const number = Math.max(0, ...project.scenes.map((scene) => scene.number)) + 1;
    const scene: Scene = { id: `scene-${String(number).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8)}`, number, title: `장면 ${number}`, duration: 10, caption: "", prompt: "", prompt_history: [], candidates: [], status: "idle" };
    set({ scenes: [...project.scenes, scene] });
  };
  const removeScene = async (id: string) => {
    const scene = project.scenes.find((item) => item.id === id);
    if (!scene || !window.confirm(`${scene.title} 장면과 선택한 이미지를 목록에서 삭제할까요?`)) return;
    try { if (scene.narration_audio) await removeSceneNarration(project, scene); }
    catch (error) { onError(`장면 녹음 삭제 실패: ${String(error)}`); return; }
    set({ scenes: project.scenes.filter((item) => item.id !== id) });
  };
  return <div className="page">
    <PageHeading eyebrow="PARSE REVIEW" title="제작안을 이렇게 이해했어요" text="Work 답변의 형식이 달라도 여기서 장면을 직접 추가하거나 수정할 수 있어요." />
    <div className="review-grid">
      <div className="panel"><h3>인물 프로필</h3><textarea className="profile-box" value={project.character_profile.description} onChange={(e) => set({ character_profile: { ...project.character_profile, description: e.target.value } })} /><label className="full-label">공통 스타일<textarea value={project.style_guide} onChange={(e) => set({ style_guide: e.target.value })} /></label></div>
      <div className="panel scenes-summary"><div className="panel-title"><h3>찾은 장면</h3><span>{project.scenes.length} SCENES</span></div>{!project.scenes.length && <p className="parse-warning">장면을 자동으로 찾지 못했습니다. 원문을 다시 분석하거나 아래에서 직접 장면을 추가해 주세요.</p>}{project.scenes.map((scene) => <div className="scene-review-item" key={scene.id}><div className="scene-row"><b>{String(scene.number).padStart(2, "0")}</b><div><strong>{scene.title}</strong><small>{scene.prompt ? `${scene.prompt.slice(0, 88)}${scene.prompt.length > 88 ? "…" : ""}` : "장면 내용을 입력해 주세요"}</small></div>{scene.duration && <span><Clock3 size={13} /> {scene.duration}초</span>}</div><details className="scene-edit"><summary>장면 수정</summary><div className="scene-edit-fields"><label>제목<input aria-label={`장면 ${scene.number} 제목`} value={scene.title} onChange={(event) => editScene(scene.id, { title: event.target.value })} /></label><label>시간 (초)<input aria-label={`장면 ${scene.number} 시간`} type="number" min="1" max="120" value={scene.duration ?? 10} onChange={(event) => editScene(scene.id, { duration: Number(event.target.value) })} /></label><label className="wide">장면별 이미지 내용 (전체 프롬프트는 Scene 검토에서 자동 완성)<textarea aria-label={`장면 ${scene.number} 이미지 내용`} value={scene.prompt} onChange={(event) => editScene(scene.id, { prompt: event.target.value })} /></label><label className="wide">영상 자막<textarea aria-label={`장면 ${scene.number} 영상 자막`} value={scene.caption ?? ""} onChange={(event) => editScene(scene.id, { caption: event.target.value })} /></label><button className="text-button danger" onClick={() => removeScene(scene.id)}>이 장면 삭제</button></div></details></div>)}<button className="btn ghost add-scene" onClick={addScene}><Plus size={16} /> 장면 직접 추가</button>{project.scenes.some((scene) => !scene.prompt.trim()) && <p className="parse-warning">빈 장면 내용을 입력하면 다음 단계로 진행할 수 있습니다.</p>}</div>
    </div>
    <button className="btn ghost" onClick={() => { if (!project.scenes.length || window.confirm("원문을 다시 분석하면 현재 장면 수정 내용이 바뀔 수 있습니다. 계속할까요?")) onReparse(); }}><RefreshCw size={16} /> 원문 다시 분석</button>
  </div>;
}

function V2ParseReview({ project }: { project: ProjectData }) {
  const total = project.scenes.length;
  const count = (check: (scene: Scene) => boolean) => project.scenes.filter(check).length;
  const checks = [
    ["Scenes", total], ["Narrations", count((scene) => !!scene.narration?.trim())],
    ["Scene descriptions", count((scene) => !!scene.scene_description?.trim())],
    ["Image prompts", count((scene) => !!scene.prompt.trim())],
    ["Captions", count((scene) => !!scene.captions?.length)],
  ] as const;
  return <div className="page"><PageHeading eyebrow="APP_DATA REVIEW" title="제작안의 장면을 확인하세요" text="원본 JSON은 변경하지 않고 보관합니다. 이미지 프롬프트와 자막은 다음 단계에서 앱 작업본으로 수정할 수 있습니다." />
    <div className="panel"><h3>{project.person} · {project.source?.person.period}</h3><p>{project.source?.person.one_line_intro}</p><p>목표 {project.source?.video.target_duration_sec}초 · {project.scenes.length}개 Scene</p></div>
    <div className="panel import-counts">{checks.map(([label, value]) => <span key={label}>{label} <strong>{value} / {total}</strong></span>)}</div>
    {project.schema_version === "2.0" && <div className="parse-warning">Legacy project — captions missing. v2.1 데이터 재생성을 권장합니다.</div>}
    <div className="v2-scene-list">{orderedScenes(project).map((scene) => <details className="panel v2-scene-card" key={scene.id}><summary><b>Scene {scene.number}</b> <span>{scene.start_sec}–{scene.end_sec}초</span> <strong>{scene.title}</strong><small>✓ narration · ✓ description · {scene.captions?.length ? `✓ captions ${scene.captions.length}` : "⚠ captions 0"} · ✓ image</small>{isCoreScene(project, scene) && <em>★ 핵심 업적 · {project.source?.core_achievement.title}</em>}</summary><div className="scene-data-grid"><p><b>내레이션</b>{scene.narration}</p><p><b>장면 설명</b>{scene.scene_description}</p><p><b>화면 유형 / 구도 / 장소</b>{scene.visual_type} · {scene.shot_type} · {scene.location}</p><p><b>대상 / 행동</b>{scene.main_subject} · {scene.main_action}</p><p><b>이미지 프롬프트</b>{scene.prompt}</p><p><b>보조 이미지</b>{scene.support_image_prompt || "없음"}</p><p><b>강조 자막 / 효과</b>{scene.subtitle ?? scene.caption} · {scene.motion}</p>{scene.overlay_required && <p><b>정확한 역사 자료 오버레이</b>{scene.overlay_type} · {scene.overlay_note}</p>}</div><div className="caption-list"><strong>전체 내레이션 자막 · {scene.captions?.length || 0}개</strong>{scene.captions?.map((block, index) => <p key={block.id || index}><span>{block.start_sec}–{block.end_sec}초</span>{block.text}</p>)}</div></details>)}</div>
  </div>;
}

function Preflight({ project }: { project: ProjectData }) {
  const report = reportForProject(project);
  const metric = report.metrics;
  return <div className="page"><PageHeading eyebrow="PREFLIGHT CHECK" title="제작 전 품질 점검" text="오류는 진행을 막고, 다양성·길이 경고는 확인 후 계속할 수 있습니다." />
    <div className="panel"><h3>데이터와 영상</h3><div className="quality-metrics"><span>스키마 {report.errors.length ? "확인 필요" : "정상"}</span><span>Scene {metric.sceneCount}개</span><span>길이 {metric.duration}초</span><span>핵심 업적 Scene {metric.coreScenes}개</span></div></div>
    {project.schema_version !== 1 && <div className="panel"><h3>이미지 다양성</h3><div className="quality-metrics"><span>visual_type {metric.visualTypes}종 {metric.visualTypes >= 6 ? "✓" : "⚠"}</span><span>shot_type {metric.shotTypes}종 {metric.shotTypes >= 5 ? "✓" : "⚠"}</span><span>location {metric.locations}종 {metric.locations >= 4 ? "✓" : "⚠"}</span><span>주인공 미등장 {metric.withoutProtagonist}개 {metric.withoutProtagonist >= 3 ? "✓" : "⚠"}</span></div></div>}
    {report.errors.length > 0 && <div className="error-banner"><strong>오류 · 다음 단계 진행 불가</strong><ul>{report.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {report.warnings.length > 0 && <div className="panel quality-warnings"><h3>확인할 경고 {report.warnings.length}개</h3><ul>{report.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {!report.errors.length && <div className="video-ready"><CheckCircle2 size={17} /> 필수 데이터가 확인되었습니다. 이미지 제작을 시작할 수 있습니다.</div>}
  </div>;
}

function ImageReview({ project, view, onOpenScene, batch, onCompareImage, restoringImage, onRestoreImage, mediaCheck, onOpenMediaCheck, promptExport, batchNarrations, narrationExport, onThumbnail }: { project: ProjectData; view: ReviewView; onOpenScene: (sceneId: string) => void; batch: SceneImageBatchController; onCompareImage: (request: ImageComparisonRequest) => Promise<ImageComparisonResult>; restoringImage: boolean; onRestoreImage: (request: RestoreImageRequest) => Promise<RestoreImageResult>; mediaCheck: ExportMediaCheckController; onOpenMediaCheck: (location: CheckLocation) => void; promptExport: ScenePromptExportController; batchNarrations: SceneNarrationBatchController; narrationExport: ProjectExportSelection; onThumbnail: () => void }) {
  const errors = completionErrors(project);
  const [comparison, setComparison] = useState<{ sceneId: string; sceneIds: string[]; origin: HTMLElement | null; scrollY: number }>();
  const closeComparison = () => {
    const saved = comparison; setComparison(undefined);
    if (saved) window.requestAnimationFrame(() => {
      const target = saved.origin?.isConnected ? saved.origin : document.querySelector<HTMLElement>("select[aria-label='원본 후보를 추가할 장면']");
      if (!target?.isConnected) return;
      window.scrollTo({ top: saved.scrollY, behavior: "instant" }); target.focus({ preventScroll: true });
      if (!saved.origin?.isConnected) target.scrollIntoView?.({ block: "center", behavior: "instant" });
    });
  };
  return <div className="page"><PageHeading eyebrow="FINAL IMAGE REVIEW" title="전체 장면을 한 번 더 확인하세요" text="Scene 순서와 핵심 업적 장면, 썸네일을 검토한 뒤 MP4를 만듭니다." />
    <ReviewOverview project={project} errors={errors} onThumbnail={onThumbnail} onOpenScene={sceneId => { const card = [...document.querySelectorAll<HTMLElement>("[data-scene-id]")].find(item => item.dataset.sceneId === sceneId); view.scrollY = window.scrollY; view.anchor = { sceneId, offset: card?.getBoundingClientRect().top ?? 0 }; view.returning = true; onOpenScene(sceneId); }} />
    <ReviewToolLinks />
    <SceneReviewBoard project={project} view={view} onOpenScene={onOpenScene} onCompareImage={onCompareImage} />
    <section className="review-tool-group review-preview-group" id="review-preview" tabIndex={-1} aria-label="전체 영상 확인"><FullVideoPreview project={project} /></section>
    <section className="review-tool-group" id="review-image-tools" tabIndex={-1} aria-label="이미지 준비 도구"><h3>이미지 준비</h3><p>프롬프트로 이미지를 준비하고, 가져온 파일을 장면에 연결하세요.</p>
      <ScenePromptExport project={project} selection={promptExport} />
      <SceneImageBatch project={project} batch={batch} />
    </section>
    <section className="review-tool-group" id="review-narration-tools" tabIndex={-1} aria-label="녹음 준비 도구"><h3>녹음 준비 <small>선택 사항</small></h3><p>대본을 모아 장면별로 녹음한 뒤 파일을 가져오세요. 녹음 없이도 출력할 수 있습니다.</p>
      <SceneNarrationExport project={project} selection={narrationExport} />
      <SceneNarrationBatch project={project} batch={batchNarrations} />
    </section>
    <section className="review-tool-group" id="review-check-tools" tabIndex={-1} aria-label="원본과 자료 점검"><h3>원본과 자료 점검</h3><p>보관한 이미지를 다시 연결하거나, 출력에 쓰는 파일이 열리는지 확인하세요.</p>
      <ImageLibrary key={project.id} project={project} busy={restoringImage} onRestore={onRestoreImage} onCompare={(sceneId, origin) => setComparison({ sceneId, sceneIds: orderedScenes(project).map(scene => scene.id), origin, scrollY: window.scrollY })} />
      <ExportMediaCheck check={mediaCheck} onOpen={onOpenMediaCheck} />
    </section>
    {comparison && <ImageComparison project={project} sceneId={comparison.sceneId} sceneIds={comparison.sceneIds} scopeLabel="프로젝트의 모든 장면" onSceneChange={sceneId => setComparison(previous => previous && { ...previous, sceneId })} onApply={onCompareImage} onClose={closeComparison} />}
    <div className="panel"><h3>썸네일</h3>{project.thumbnail.candidates.find((candidate) => candidate.id === project.thumbnail.selected_candidate_id) ? <img className="review-thumbnail" src={project.thumbnail.candidates.find((candidate) => candidate.id === project.thumbnail.selected_candidate_id)!.preview_url} alt="선택 썸네일" /> : <p>선택된 썸네일이 없습니다.</p>}</div>
    {errors.length > 0 && <div className="error-banner review-required-fixes" id="review-required-fixes" tabIndex={-1}><strong>완료 전 확인할 항목</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
  </div>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{text}</p></div>;
}

function AssetStudio({ title, eyebrow, description, asset, project, kind, onChange }: { title: string; eyebrow: string; description: string; asset: VisualAsset; project: ProjectData; kind: "anchor" | "thumbnail"; onChange: (asset: VisualAsset, options?: EditOptions) => void }) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullPrompt = kind === "thumbnail" ? composeThumbnailPrompt(project) : "";
  const generate = async () => {
    setError("");
    if (!asset.prompt.trim()) return setError("이미지 내용을 먼저 입력해 주세요.");
    onChange({ ...asset, status: "generating" }, { history: false });
    try {
      const prompt = kind === "thumbnail" ? fullPrompt : `${asset.prompt}\n\n공통 스타일: ${project.style_guide}`;
      const reference_image = kind === "thumbnail" ? await resolveReferenceImage(project) : undefined;
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: kind, prompt, count: 3, reference_image });
      onChange({ ...asset, candidates: [...asset.candidates, ...candidates], status: "ready", prompt_history: appendHistory(asset.prompt_history, prompt) }, { history: false });
    } catch (cause) { setError(String(cause)); onChange({ ...asset, status: "error" }, { history: false }); }
  };
  const copyFullPrompt = async () => {
    try { await navigator.clipboard.writeText(fullPrompt); setCopied(true); setError(""); }
    catch { setError("복사에 실패했습니다. 아래 전체 프롬프트를 직접 선택해 복사해 주세요."); }
  };
  const upload = async (files: File[]) => {
    setError("");
    setUploading(true);
    try {
      const candidates = await importImageCandidates(files, { project_path: project.project_path, asset_kind: kind });
      onChange({ ...asset, candidates: [...asset.candidates, ...candidates], selected_candidate_id: candidates.at(-1)?.id || asset.selected_candidate_id, status: "ready", prompt_history: appendHistory(asset.prompt_history, asset.prompt) }, { history: false });
    } catch (cause) { setError(String(cause)); }
    finally { setUploading(false); }
  };
  const removeCandidate = async (id: string) => {
    await deleteCandidateAsset(project, kind, findCandidate(asset.candidates, id));
    onChange(withoutAssetCandidate(asset, id), { history: false });
  };
  return <div className="page">
    <PageHeading eyebrow={eyebrow} title={title} text={description} />
    <PromptEditor heading={kind === "thumbnail" ? "썸네일 내용 (수정 가능)" : "이미지 프롬프트"} value={asset.prompt} historyCount={asset.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...asset, prompt }); }} onGenerate={generate} onUpload={upload} generating={asset.status === "generating"} uploading={uploading} />
    {kind === "thumbnail" && <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 썸네일 프롬프트</strong><small>썸네일 내용 + 인물 외형 + 스타일 조건을 중복 없이 합칩니다.</small></div><button className="btn ghost" disabled={!asset.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 썸네일 프롬프트" readOnly value={fullPrompt} /></div>}
    {error && <div className="error-banner">{error}</div>}
    <CandidateGrid candidates={asset.candidates} selected={asset.selected_candidate_id} onSelect={(id) => onChange({ ...asset, selected_candidate_id: id })} onDelete={removeCandidate} emptyLabel="장면에 사용할 이미지를 가져오세요" />
  </div>;
}

function BackgroundMusicPanel({ project, onChange }: { project: ProjectData; onChange: (project: ProjectData) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let url = "";
    if (project.background_music) {
      getBackgroundMusic(project).then((blob) => {
        if (!blob) throw new Error("음악 파일을 찾지 못했습니다. 다시 업로드해 주세요.");
        url = URL.createObjectURL(blob);
        if (active) setPreviewUrl(url);
        else URL.revokeObjectURL(url);
      }).catch((cause) => { if (active) setError(String(cause)); });
    } else setPreviewUrl("");
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [project.id, project.background_music?.path, revision]);
  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const background_music = await saveBackgroundMusic(project, file);
      await onChange({ ...project, background_music });
      setRevision((value) => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("이 프로젝트의 배경음악을 제거할까요? 새로 만드는 MP4에서는 음악만 빠지고 장면 녹음은 유지됩니다.")) return;
    setBusy(true);
    setError("");
    try { await removeBackgroundMusic(project); await onChange({ ...project, background_music: undefined }); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="panel background-music-panel"><div className="music-head"><Music2 size={20} /><div><strong>영상 배경음악</strong><small>음악 한 곡이 영상 전체에 반복됩니다. 장면마다 아래에서 볼륨을 조절하세요.</small></div><input ref={input} className="file-input" type="file" accept=".mp3,.wav,.m4a,.mp4,audio/mpeg,audio/wav,audio/mp4,video/mp4" aria-label="배경음악 파일 선택" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><button className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{project.background_music ? "음악 교체" : "음악 업로드"}</button></div>{project.background_music && <div className="music-file"><span>{project.background_music.name}</span>{previewUrl && <audio controls preload="metadata" src={previewUrl} aria-label="배경음악 미리듣기" />}<button className="btn ghost" disabled={busy} onClick={remove}><Trash2 size={15} /> 제거</button></div>}<small className="music-hint">MP3·WAV·M4A·MP4(MPEG-4), 100MB·15분 이하 · 사용 권한이 있는 음악을 선택해 주세요.</small>{error && <div className="error-banner">{error}</div>}</div>;
}

function SceneStudio({ project, activeSceneId, onActiveSceneChange, onChange, onProjectChange, onTimingChange, onGeneratedNarration, onMove, onSplit, onMerge }: { project: ProjectData; activeSceneId?: string; onActiveSceneChange: (id: string) => void; onChange: (scene: Scene, options?: EditOptions) => void; onProjectChange: (project: ProjectData) => Promise<void>; onTimingChange: (request: TimingRequest) => void; onGeneratedNarration: (request: GeneratedNarrationRequest) => void; onMove: (projectId: string, sceneId: string, direction: -1 | 1) => void; onSplit: (projectId: string, sceneId: string, captionId: string) => void; onMerge: (projectId: string, sceneId: string, nextId: string) => void }) {
  const scenes = orderedScenes(project);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const scene = scenes.find((item) => item.id === activeSceneId) || scenes[0];
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, []);
  useLayoutEffect(() => {
    if (scene && scene.id !== activeSceneId) onActiveSceneChange(scene.id);
  }, [scene?.id, activeSceneId]);
  if (!scene) return <div className="empty-state"><Circle size={28} /><h3>분석된 장면이 없습니다</h3><p>파싱 확인 단계로 돌아가 Scene 항목을 확인해 주세요.</p></div>;
  const fullPrompt = composeScenePrompt(project, scene);
  const generate = async () => {
    setError("");
    if (!scene.prompt.trim()) return setError("장면 내용을 먼저 입력해 주세요.");
    onChange({ ...scene, status: "generating" }, { history: false });
    try {
      const reference_image = await resolveReferenceImage(project);
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: "scene", scene_number: scene.number, prompt: fullPrompt, count: project.schema_version !== 1 ? 2 : 3, reference_image });
      onChange({ ...scene, candidates: [...scene.candidates, ...candidates], status: "ready", prompt_history: appendHistory(scene.prompt_history, fullPrompt) }, { history: false });
    } catch (cause) { setError(String(cause)); onChange({ ...scene, status: "error" }, { history: false }); }
  };
  const copyFullPrompt = async () => {
    try { await navigator.clipboard.writeText(fullPrompt); setCopied(true); setError(""); }
    catch { setError("복사에 실패했습니다. 아래 전체 프롬프트를 직접 선택해 복사해 주세요."); }
  };
  const upload = async (files: File[]) => {
    setError("");
    setUploading(true);
    try {
      const candidates = await importImageCandidates(files, { project_path: project.project_path, asset_kind: "scene", scene_number: scene.number });
      const selectedIsVideo = scene.candidates.some((candidate) => candidate.id === scene.selected_candidate_id && candidate.media_type === "video");
      onChange({ ...scene, candidates: [...scene.candidates, ...candidates], selected_candidate_id: selectedIsVideo ? scene.selected_candidate_id : candidates.at(-1)?.id || scene.selected_candidate_id,
        status: "ready", prompt_history: appendHistory(scene.prompt_history, scene.prompt) }, { history: false });
    } catch (cause) { setError(String(cause)); }
    finally { setUploading(false); }
  };
  const uploadVideo = async (file: File) => {
    setVideoBusy(true); setError("");
    try {
      const candidate = await importSceneVideo(project, scene, file);
      onChange({ ...scene, candidates: [...scene.candidates, candidate], selected_candidate_id: candidate.id, status: "ready" }, { history: false });
    } catch (cause) { setError(String(cause)); }
    finally { setVideoBusy(false); }
  };
  const generateSupport = async () => {
    if (!scene.support_image_prompt?.trim()) return;
    setSupportBusy(true); setError("");
    try {
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: "support", scene_number: scene.number, prompt: `${scene.support_image_prompt}\n\n${project.style_guide}\nno text, no letters, no captions, no watermark. 16:9.`, count: 2 });
      onChange({ ...scene, support_candidates: [...(scene.support_candidates || []), ...candidates], support_selected_candidate_id: scene.support_selected_candidate_id || candidates[0]?.id, support_prompt_history: appendHistory(scene.support_prompt_history || [], scene.support_image_prompt) }, { history: false });
    } catch (cause) { setError(String(cause)); }
    finally { setSupportBusy(false); }
  };
  const uploadSupport = async (files: File[]) => {
    setSupportBusy(true); setError("");
    try {
      const candidates = await importImageCandidates(files, { project_path: project.project_path, asset_kind: "support", scene_number: scene.number });
      onChange({ ...scene, support_candidates: [...(scene.support_candidates || []), ...candidates], support_selected_candidate_id: candidates.at(-1)?.id || scene.support_selected_candidate_id }, { history: false });
    } catch (cause) { setError(String(cause)); }
    finally { setSupportBusy(false); }
  };
  const removeCandidate = async (id: string, support = false) => {
    const candidate = findCandidate(support ? scene.support_candidates || [] : scene.candidates, id);
    await deleteCandidateAsset(project, support ? "support" : "scene", candidate, scene.number);
    onChange(withoutSceneCandidate(scene, id, support), { history: false });
  };
  const position = scenes.findIndex((item) => item.id === scene.id);
  const selectedVideo = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id)?.media_type === "video";
  const introImages = scene.candidates.filter((candidate) => candidate.media_type !== "video");
  const introImage = selectedVideo ? resolveVideoIntroImage(scene) : undefined;
  const neighbors = [scenes[position - 1], scenes[position + 1]].filter((item): item is Scene => !!item);
  const switchScene = (id: string) => {
    onActiveSceneChange(id);
    setCopied(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  return <div className="page scene-page">
    <PageHeading eyebrow="SCENE REVIEW" title="장면을 만들고 고르세요" text="이미지나 동영상을 선택한 뒤 자막과 시간을 다듬으세요. 녹음과 음악은 선택 사항입니다." />
    <nav className="scene-navigation" aria-label="장면 이동"><button className="btn ghost scene-nav-button" disabled={position === 0} onClick={() => switchScene(scenes[position - 1].id)}><ArrowLeft size={15} /> 이전 Scene</button><div className="scene-tabs">{scenes.map((item) => <button key={item.id} className={item.id === scene.id ? "active" : ""} aria-current={item.id === scene.id ? "step" : undefined} onClick={() => switchScene(item.id)}><span>{item.number}</span>{item.title}{item.selected_candidate_id && <Check size={13} aria-label="화면 선택됨" />}{hasSceneNarration(item) && <Mic size={12} aria-label="녹음 있음" />}</button>)}</div><button className="btn primary scene-nav-button" disabled={position === scenes.length - 1} onClick={() => switchScene(scenes[position + 1].id)}>다음 Scene <ArrowRight size={15} /></button></nav>
    <div className="scene-title"><div><span>SCENE {String(scene.number).padStart(2, "0")}</span><h3>{scene.title}</h3></div><div className="scene-order-controls" role="group" aria-label="장면 순서 변경"><small aria-live="polite">전체 {scenes.length}개 중 {position + 1}번째</small><button type="button" className="btn ghost" aria-label="이 장면을 앞으로 이동" disabled={position === 0} onClick={() => onMove(project.id, scene.id, -1)}><ArrowUp size={15} /> 순서 앞으로</button><button type="button" className="btn ghost" aria-label="이 장면을 뒤로 이동" disabled={position === scenes.length - 1} onClick={() => onMove(project.id, scene.id, 1)}><ArrowDown size={15} /> 순서 뒤로</button></div></div>
    {project.schema_version !== 1 && <div className="panel scene-context"><div className="scene-context-head"><span>{scene.start_sec}–{scene.end_sec}초</span>{isCoreScene(project, scene) && <em>★ 핵심 업적 · {project.source?.core_achievement.title}</em>}</div><p><b>내레이션</b> {scene.narration}</p><p><b>장면 설명</b> {scene.scene_description}</p><p><b>화면 구성</b> {scene.visual_type} · {scene.shot_type} · {scene.location}</p><p><b>대상과 행동</b> {scene.main_subject} · {scene.main_action}</p>{scene.overlay_required && <p><b>역사 자료 오버레이</b> {scene.overlay_type} · {scene.overlay_note}</p>}</div>}
    <div className="scene-workspace"><div className="scene-workspace-controls">
    <PromptEditor heading="장면 내용 (수정 가능)" value={scene.prompt} historyCount={scene.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...scene, prompt }); }} onGenerate={generate} onUpload={upload} generating={scene.status === "generating"} uploading={uploading} generateCount={project.schema_version !== 1 ? 2 : 3} />
    <CandidateGrid candidates={scene.candidates} selected={scene.selected_candidate_id} onSelect={(id) => onChange({ ...scene, selected_candidate_id: id })} onDelete={(id) => removeCandidate(id)} emptyLabel="이 장면의 이미지나 동영상을 업로드해 보세요" />
    <div className="panel scene-video-upload"><div><strong>짧은 동영상 추가</strong><small>MP4 · 최대 10초 · 50MB 이하. 이미지도 함께 올리면 이미지가 먼저 잠깐 보인 뒤 영상으로 이어집니다. 원본 소리는 사용하지 않습니다.</small></div><input ref={videoInput} className="file-input" type="file" accept=".mp4,video/mp4" aria-label="장면 MP4 파일 선택" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /><button className="btn ghost" disabled={videoBusy || uploading} onClick={() => videoInput.current?.click()}>{videoBusy ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{videoBusy ? "동영상 처리 중…" : "MP4 업로드"}</button></div>
    <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 이미지 프롬프트</strong><small>장면 내용 + 인물 외형 기준 + 공통 스타일이 항상 함께 들어갑니다.</small></div><button className="btn ghost" disabled={!scene.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 이미지 프롬프트" readOnly value={fullPrompt} /></div>
    {project.schema_version === "2.1" ? <V21CaptionEditor scene={scene} sourceMotion={project.source?.scenes.find((item) => item.id === (scene.source_scene_id || scene.id))?.motion} onChange={onChange} /> : <div className="panel caption-panel"><label><strong>영상 자막</strong><small>이 문장이 장면 이미지 위에 표시됩니다.</small><textarea aria-label="영상 자막" value={scene.caption ?? scene.title} onChange={(event) => onChange({ ...scene, caption: event.target.value })} /></label><label className="duration-label"><strong>표시 시간 (초)</strong><input aria-label="장면 표시 시간" type="number" min="1" max="120" step="1" disabled={project.schema_version === "2.0"} title={project.schema_version === "2.0" ? "v2 시간은 APP_DATA의 시작·종료 시간을 따릅니다." : undefined} value={scene.duration ?? 10} onChange={(event) => onChange({ ...scene, duration: Number(event.target.value) })} /></label><label className="motion-label"><strong>이미지 효과</strong><small>MP4에 적용됩니다.</small><select aria-label="이미지 효과" value={scene.motion ?? "auto"} onChange={(event) => onChange({ ...scene, motion: event.target.value as ImageMotion })}><option value="auto">자동 (장면마다 다르게)</option><option value="zoom-in">천천히 줌인</option><option value="zoom-out">천천히 줌아웃</option><option value="pan-left">왼쪽으로 이동</option><option value="pan-right">오른쪽으로 이동</option><option value="pan-up">위로 이동</option><option value="pan-down">아래로 이동</option><option value="none">효과 없음</option></select></label></div>}
    <SceneNarrationPanel key={`${project.id}:${scene.id}`} project={project} scene={scene} onChange={onChange} onTimingChange={onTimingChange} onGeneratedNarration={onGeneratedNarration} />
    <div className="panel music-volume-panel"><label><strong>이 장면의 배경음악 볼륨</strong><small>{scene.composition?.visuals.some(section => section.presentation) ? "구간별 볼륨을 유지합니다. 슬라이더를 바꾸면 이 장면 전체에 적용됩니다." : project.background_music ? "장면이 바뀔 때 볼륨도 부드럽게 바뀝니다." : "음악을 추가하면 이 설정이 적용됩니다."}</small><input aria-label="장면 배경음악 볼륨" type="range" min="0" max="100" step="1" value={sceneMusicVolume(scene.music_volume)} onChange={(event) => onChange({ ...scene, music_volume: Number(event.target.value) })} /></label><output>{sceneMusicVolume(scene.music_volume)}%</output></div>
    {error && <div className="error-banner">{error}</div>}
    {project.schema_version !== 1 && neighbors.length > 0 && <details className="panel neighbor-panel"><summary>인접 장면 비교 <small>필요할 때 펼쳐보기</small></summary><div className="neighbor-grid">{neighbors.map((item) => { const image = item.candidates.find((candidate) => candidate.id === item.selected_candidate_id); return <div key={item.id}>{image ? <img src={image.preview_url} alt={`${item.title} 선택 이미지`} /> : <div className="neighbor-empty">아직 이미지 없음</div>}<small>{item.source_scene_id} · {item.title}</small></div>; })}</div></details>}
    {scene.composition?.mode !== "segments" && selectedVideo && introImages.length > 0 && <div className="panel video-intro-panel"><div><strong>동영상 앞에 보여줄 이미지</strong><small>장면 시간 안에서 최대 1.5초 표시한 뒤 0.3초 동안 동영상으로 부드럽게 전환됩니다. 자막은 두 화면 모두에 표시됩니다.</small></div><div className="video-intro-choice"><select aria-label="동영상 앞 이미지" value={scene.video_intro_candidate_id === null ? "none" : scene.video_intro_candidate_id ?? "auto"} onChange={(event) => onChange({ ...scene, video_intro_candidate_id: event.target.value === "none" ? null : event.target.value === "auto" ? undefined : event.target.value })}><option value="auto">자동 · 최근 업로드 이미지</option><option value="none">이미지 없이 동영상만</option>{introImages.map((candidate, index) => <option key={candidate.id} value={candidate.id}>이미지 후보 {index + 1}{candidate.mode === "uploaded" ? " · 업로드" : ""}</option>)}</select>{introImage && <img src={introImage.preview_url} alt="동영상 앞에 표시할 이미지" />}</div></div>}
    <SceneTimingPanel scene={scene} onChange={onChange} />
    {project.schema_version !== 1 && (scene.support_image_prompt || scene.support_candidates?.length) && <><div className="panel support-panel"><h3>보조 이미지 · 별도 생성</h3><p className="support-hint">선택한 보조 이미지는 이 장면의 후반부에 부드럽게 전환되어 MP4에 들어갑니다.</p><textarea aria-label="보조 이미지 프롬프트" value={scene.support_image_prompt || ""} onChange={(event) => onChange({ ...scene, support_image_prompt: event.target.value })} /><div className="prompt-actions"><label className="btn ghost support-upload">보조 이미지 업로드<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void uploadSupport(files); }} /></label><button className="btn primary" disabled={supportBusy} onClick={generateSupport}>{supportBusy ? "처리 중…" : "보조 후보 2장 생성"}</button></div></div><CandidateGrid candidates={scene.support_candidates || []} selected={scene.support_selected_candidate_id} onSelect={(id) => onChange({ ...scene, support_selected_candidate_id: id })} onDelete={(id) => removeCandidate(id, true)} emptyLabel="보조 이미지는 선택 사항입니다" /></>}
    </div><ScenePreviewPane key={scene.id} project={project} scene={scene} onChange={onChange} /></div>
    <SceneSplitPanel key={scene.id} project={project} scene={scene} onSplit={onSplit} />
    <SceneMergePanel project={project} scene={scene} onMerge={onMerge} />
    <BackgroundMusicPanel project={project} onChange={onProjectChange} />
  </div>;
}

function V21CaptionEditor({ scene, sourceMotion, onChange }: { scene: Scene; sourceMotion?: string; onChange: (scene: Scene) => void }) {
  const editBlock = (index: number, patch: Partial<NonNullable<Scene["captions"]>[number]>) => onChange({ ...scene, captions: (scene.captions || []).map((block, position) => position === index ? { ...block, ...patch } : block) });
  return <div className="panel v21-caption-panel">
    <label><strong>강조 자막 · subtitle (선택)</strong><small>{scene.composition?.visuals.some(section => section.presentation) ? "구간별 강조 문구를 유지합니다. 입력하면 이 장면 전체에 적용됩니다." : "비워두면 강조 문구 없이 아래 전체 자막만 표시됩니다."}</small><textarea aria-label="강조 자막" value={scene.subtitle || ""} onChange={(event) => onChange({ ...scene, subtitle: event.target.value, title: event.target.value.trim() || `Scene ${String(scene.number).padStart(2, "0")}` })} /></label>
    <div className="caption-blocks"><strong>전체 내레이션 자막 · captions {scene.captions?.length || 0}개</strong><small>Work가 나눈 의미 단위와 표시 시간을 그대로 사용합니다. MP4 하단에 순서대로 나타납니다.</small>{scene.captions?.map((block, index) => <div className="caption-block-row" key={block.id || index}><span>{index + 1}</span><textarea aria-label={`Caption ${index + 1} 텍스트`} value={block.text} onChange={(event) => editBlock(index, { text: event.target.value })} /><label>시작<input aria-label={`Caption ${index + 1} 시작`} type="number" step="0.1" value={block.start_sec} onChange={(event) => editBlock(index, { start_sec: Number(event.target.value) })} /></label><label>종료<input aria-label={`Caption ${index + 1} 종료`} type="number" step="0.1" value={block.end_sec} onChange={(event) => editBlock(index, { end_sec: Number(event.target.value) })} /></label></div>)}</div>
    <div className="caption-settings"><span>표시 시간: {scene.duration}초 (현재 편집 기준)</span><label><strong>영상 움직임 · motion</strong><small>이미지 구도 · shot_type: {scene.shot_type || "미지정"} (이미지 프롬프트에 적용)</small>{sourceMotion && <small>제작안 원문 움직임: {sourceMotion}</small>}<select aria-label="이미지 효과" value={scene.motion ?? "auto"} onChange={(event) => onChange({ ...scene, motion: event.target.value as ImageMotion })}><option value="auto">자동 (기본 움직임)</option><option value="zoom-in">줌인</option><option value="zoom-out">줌아웃</option><option value="pan-left">왼쪽으로 이동</option><option value="pan-right">오른쪽으로 이동</option><option value="pan-up">위로 이동</option><option value="pan-down">아래로 이동</option><option value="none">효과 없음</option></select></label></div>
  </div>;
}

function PromptEditor({ heading = "이미지 프롬프트", value, historyCount, onChange, onGenerate, onUpload, generating, uploading, generateCount = 3 }: { heading?: string; value: string; historyCount: number; onChange: (value: string) => void; onGenerate: () => void; onUpload: (files: File[]) => void; generating: boolean; uploading: boolean; generateCount?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const samples = !isTauri() && !getAccessCode();
  return <div className="panel prompt-panel"><div className="prompt-head"><div><strong>{heading}</strong><small>수정 이력 {historyCount}개</small></div><div className="prompt-actions"><input ref={input} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={generating || uploading} aria-label="후보 이미지 파일 선택" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) onUpload(files); }} /><button className={`btn ${samples ? "primary" : "ghost"}`} disabled={generating || uploading} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{uploading ? "업로드 중…" : "이미지 업로드"}</button><button className={`btn ${samples ? "ghost" : "primary"}`} disabled={generating || uploading} onClick={onGenerate}>{generating ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{generating ? "준비 중…" : samples ? `예시 ${generateCount}장 만들기` : `후보 ${generateCount}장 생성`}</button></div></div><textarea aria-label={`${heading} 편집`} value={value} onChange={(e) => onChange(e.target.value)} /><p className="upload-hint">준비한 PNG·JPEG·WebP를 업로드하세요. 최대 6장, 각 12MB. {samples && "예시 만들기는 레이아웃 확인용 이미지를 만듭니다."}</p></div>;
}

function CandidateGrid({ candidates, selected, onSelect, onDelete, emptyLabel }: { candidates: ImageCandidate[]; selected?: string; onSelect: (id: string) => void; onDelete?: (id: string) => Promise<void>; emptyLabel: string }) {
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const remove = async (candidate: ImageCandidate, index: number) => {
    if (!onDelete) return;
    const media = candidate.media_type === "video" ? "동영상" : "이미지";
    const selectedWarning = selected === candidate.id ? "\n선택된 후보라서 다시 다른 후보를 골라야 합니다." : "";
    if (!window.confirm(`${media} 후보 ${index + 1} 삭제할까요?${selectedWarning}\n\n후보 목록에서는 제거되고, 원본은 프로젝트를 삭제할 때까지 보관됩니다. 기존 MP4는 다시 만들어야 합니다.`)) return;
    setDeletingId(candidate.id); setError("");
    try { await onDelete(candidate.id); }
    catch (cause) { setError(`후보 삭제 실패: ${String(cause)}`); }
    finally { setDeletingId(""); }
  };
  if (!candidates.length) return <div className="candidate-empty"><ImageIcon size={30} /><strong>{emptyLabel}</strong><span>이미지 업로드로 파일을 가져오고, 사용할 후보를 눌러 선택하세요.</span></div>;
  return <><div className="candidate-grid">{candidates.map((candidate, index) => <div key={candidate.id} className="candidate-card"><button className={`candidate ${selected === candidate.id ? "selected" : ""}`} disabled={!!deletingId} onClick={() => onSelect(candidate.id)}><img src={candidate.preview_url} alt={`후보 ${index + 1}`} /><span className="candidate-label">후보 {index + 1}</span><span className="mode-label">{candidate.media_type === "video" ? `동영상 · ${candidate.duration_sec?.toFixed(1)}초` : candidate.mode === "uploaded" ? "업로드" : candidate.mode === "mock" ? "레이아웃 예시" : "생성 이미지"}</span>{selected === candidate.id && <i><CheckCircle2 size={22} /> 선택됨</i>}</button>{onDelete && <button className="candidate-delete" aria-label={`후보 ${index + 1} 삭제`} title={`${candidate.media_type === "video" ? "동영상" : "이미지"} 후보 삭제`} disabled={!!deletingId} onClick={() => void remove(candidate, index)}>{deletingId === candidate.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}<span>삭제</span></button>}</div>)}</div>{error && <div className="error-banner">{error}</div>}</>;
}

function Complete({ project, onDownload }: { project: ProjectData; onDownload: () => void }) {
  const sceneDone = project.scenes.filter((scene) => scene.selected_candidate_id).length;
  const narrationDone = project.scenes.filter(hasSceneNarration).length;
  const [video, setVideo] = useState<Blob | null>(null);
  const [rendering, setRendering] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!video) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(video);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  useEffect(() => {
    let active = true;
    setVideo(null);
    getRenderedVideo(project).then((saved) => { if (active) setVideo(saved); }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [project.id, project.updated_at]);
  const makeVideo = async () => {
    setError("");
    setRendering(true);
    setPercent(0);
    try {
      const blob = await renderProjectMp4(project, setPercent);
      downloadBlob(blob, `${project.folder_name}.mp4`);
      await saveRenderedVideo(project, blob);
      setVideo(blob);
    } catch (cause) { setError(String(cause)); }
    finally { setRendering(false); }
  };
  let duration = 0;
  try { duration = buildVideoPlan(project).reduce((sum, segment) => sum + segment.duration, 0); } catch { /* Image selection is shown below. */ }
  return <div className="complete-page">
    <div className="complete-mark"><Check size={42} /></div>
    <div className="eyebrow">VIDEO EXPORT</div>
    <h2>{project.person} 편 영상 만들기</h2>
    <p>3초 타이틀 뒤에 장면 이미지·동영상·자막{narrationDone ? "·녹음한 내레이션" : ""}{project.background_music ? "·배경음악" : ""}이 이어지고, 마지막에는 썸네일 배경의 인물 이름 화면이 나옵니다. 녹음하지 않은 장면은 음성 없이 재생됩니다.</p>
    <div className="summary-cards"><div><span>회차</span><strong>{String(project.episode).padStart(3, "0")}</strong></div><div><span>선택 장면</span><strong>{sceneDone}/{project.scenes.length}</strong></div><div><span>녹음 장면</span><strong>{narrationDone}/{project.scenes.length}</strong></div><div><span>영상 길이</span><strong>{duration ? `${Number(duration.toFixed(1))}초` : "이미지 확인"}</strong></div></div>
    <div className="folder-tree"><FolderOpen size={22} /><div><strong>{project.project_path}</strong><small>완성 MP4: 05_exports/{project.folder_name}.mp4 · 1280×720 · {narrationDone ? "내레이션" : "내레이션 없음"}{project.background_music ? " + 배경음악" : ""}</small></div></div>
    <div className="video-actions"><button className="btn primary export-button" disabled={rendering} onClick={makeVideo}>{rendering ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{rendering ? `MP4 만드는 중… ${percent}%` : video ? "MP4 다시 만들기" : "MP4 만들기"}</button>{video && <><button className="btn ghost export-button" onClick={() => downloadBlob(video, `${project.folder_name}.mp4`)}><Download size={17} /> MP4 다시 다운로드</button>{!isTauri() && <button className="btn ghost export-button" onClick={onDownload}><Download size={17} /> MP4 포함 ZIP 다운로드</button>}</>}</div>
    {rendering && <div className="render-progress"><i style={{ width: `${percent}%` }} /></div>}
    {error && <div className="error-banner">{error}</div>}
    {video && <p className="video-ready"><CheckCircle2 size={17} /> MP4가 완성되었습니다. 자막·이미지·동영상·효과·녹음·음악을 수정하면 다시 만들어 주세요.</p>}
    {previewUrl && <video className="video-preview" aria-label="완성 MP4 미리보기" src={previewUrl} controls playsInline />}
    <div className="ending"><span>엔딩 메시지</span><p>“{project.ending_message || "아직 엔딩 메시지가 없습니다."}”</p></div>
  </div>;
}

function appendHistory(history: { prompt: string; created_at: string }[], prompt: string) {
  if (history.at(-1)?.prompt === prompt) return history;
  return [...history, { prompt, created_at: new Date().toISOString() }];
}

export default App;
