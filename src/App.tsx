import { useEffect, useMemo, useRef, useState } from "react";
import "./v2.css";
import {
  ArrowLeft,
  ArrowRight,
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
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { createProjectDraft, DEFAULT_STYLE, parseWorkText } from "./parser";
import { completionErrors, createV2ProjectDraft, parseAppData, reportForProject } from "./app-data";
import { composeScenePrompt, composeThumbnailPrompt } from "./prompts";
import { createProjectOnDisk, deleteCandidateAsset, deleteProject, downloadBlob, exportProjectZip, generateImages, getAccessCode, getBackgroundMusic, getRenderedVideo, getSceneVideo, importImageCandidates, importSceneVideo, isTauri, listProjects, removeBackgroundMusic, removeSceneNarration, saveBackgroundMusic, saveProject, saveRenderedVideo, setAccessCode } from "./platform";
import { findCandidate, withoutAssetCandidate, withoutSceneCandidate } from "./candidates";
import { buildVideoPlan, renderProjectMp4, resolveVideoIntroImage, sceneMusicVolume } from "./video";
import { SceneNarrationPanel } from "./SceneNarrationPanel";
import { SAMPLE_WORK_TEXT } from "./sample";
import type { ImageCandidate, ImageMotion, ProjectData, Scene, VisualAsset } from "./types";

const STEPS = ["대시보드", "프로젝트", "파싱 확인", "사전 점검", "기준 이미지", "Scene 검토", "썸네일", "전체 검토", "완료"];

function App() {
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
  const [accessCode, updateAccessCode] = useState(getAccessCode);

  useEffect(() => {
    listProjects().then(setProjects).catch((error) => setNotice(`프로젝트 목록을 읽지 못했습니다: ${String(error)}`));
  }, []);

  const progress = useMemo(() => Math.round((step / (STEPS.length - 1)) * 100), [step]);

  const prepareProject = async () => {
    if (!source.trim()) return setNotice("ChatGPT Work 결과를 붙여넣어 주세요.");
    setBusy(true);
    try {
      let draft: ProjectData;
      if (legacyImport) draft = createProjectDraft(episode, person, category, source);
      else {
        const { data, report } = parseAppData(source);
        if (report.errors.length) { setSetupErrors(report.errors); return; }
        draft = createV2ProjectDraft(episode, category, source, data, report);
      }
      setSetupErrors([]);
      const path = await createProjectOnDisk(draft);
      draft.project_path = path;
      await saveProject(draft);
      setProject(draft);
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

  const persist = async (next: ProjectData) => {
    const updated = { ...next, updated_at: new Date().toISOString(), app_state: next.schema_version !== 1 ? {
      selected_character_image: next.anchor.selected_candidate_id,
      selected_scene_images: Object.fromEntries(next.scenes.filter((scene) => scene.selected_candidate_id).map((scene) => [scene.source_scene_id || scene.id, scene.selected_candidate_id!])),
      selected_thumbnail: next.thumbnail.selected_candidate_id,
      warnings: reportForProject(next).warnings,
    } : next.app_state };
    setProject(updated);
    setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    try { await saveProject(updated); }
    catch (error) { setNotice(`저장 실패: ${String(error)}`); }
  };

  const download = async (item: ProjectData) => {
    try { await exportProjectZip(item); }
    catch (error) { setNotice(`ZIP 내보내기 실패: ${String(error)}`); }
  };

  const removeProject = async (item: ProjectData) => {
    const label = `EP. ${String(item.episode).padStart(3, "0")} · ${item.person} (${item.folder_name})`;
    const consequence = isTauri()
      ? "프로젝트 폴더는 projects/.trash로 이동하며 앱 목록에서 사라집니다."
      : "이 브라우저에 저장된 프로젝트·후보 이미지·완성 MP4가 함께 삭제되며 복구할 수 없습니다.";
    if (!window.confirm(`${label}\n\n${consequence}\n\n정말 삭제할까요?`)) return;
    setDeletingId(item.id);
    try {
      await deleteProject(item);
      setProjects((items) => items.filter((saved) => saved.id !== item.id));
      if (project?.id === item.id) setProject(null);
      setNotice(isTauri() ? `${label} 프로젝트를 휴지통으로 옮겼습니다.` : `${label} 프로젝트를 삭제했습니다.`);
    } catch (error) { setNotice(`프로젝트 삭제 실패: ${String(error)}`); }
    finally { setDeletingId(""); }
  };

  const updateScene = async (scene: Scene) => {
    if (!project) return;
    await persist({ ...project, scenes: project.scenes.map((item) => (item.id === scene.id ? scene : item)) });
  };

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
          <div className="brand-mark"><span>百</span></div>
          <div><strong>Great100</strong><small>STORY STUDIO</small></div>
        </div>
        <nav className="steps" aria-label="제작 단계">
          {STEPS.map((label, index) => (
            <button key={label} className={`step ${index === step ? "active" : ""} ${index < step ? "done" : ""}`} onClick={() => project && index <= step && setStep(index)} disabled={!project && index > 1}>
              <span>{index < step ? <Check size={14} /> : index + 1}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="mode-dot" />
              <div><strong>{isTauri() ? "Desktop mode" : accessCode ? "API mode" : "Mock mode"}</strong><small>{isTauri() ? "로컬 프로젝트 폴더 사용" : accessCode ? "접근 코드로 이미지 생성" : "브라우저에서 체험 가능"}</small></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">한국을 빛낸 100인 <b>/</b> {project?.person || "새 프로젝트"}</div>
          <div className="progress-wrap"><span>{progress}%</span><div><i style={{ width: `${progress}%` }} /></div></div>
        </header>

        <section className="workspace">
          {notice && <div className="toast" onClick={() => setNotice("")}>{notice}</div>}
          {step === 0 && <Dashboard onStart={() => setStep(1)} projects={projects} accessCode={accessCode} onAccessCode={(code) => { updateAccessCode(code); setAccessCode(code); }} onOpen={(item) => { setProject(item); setStep(2); }} onDownload={download} onDelete={removeProject} deletingId={deletingId} />}
          {step === 1 && (
            <ProjectSetup episode={episode} person={person} category={category} source={source} busy={busy} legacyImport={legacyImport} setLegacyImport={setLegacyImport} errors={setupErrors}
              setEpisode={setEpisode} setPerson={setPerson} setCategory={setCategory} setSource={setSource}
              onSample={() => { setSource(SAMPLE_WORK_TEXT); setPerson("이순신"); setEpisode(2); }} onContinue={prepareProject} />
          )}
          {step === 2 && project && <ParseReview project={project} onChange={persist} onReparse={reparseSource} onError={setNotice} />}
          {step === 3 && project && <Preflight project={project} />}
          {step === 4 && project && <AssetStudio title="인물 기준 이미지" eyebrow="CHARACTER ANCHOR" description="얼굴 일관성을 위한 기준 이미지입니다. 업로드한 이미지가 있으면 생성 단계를 건너뛰어도 됩니다." asset={project.anchor} project={project} kind="anchor" onChange={(anchor) => persist({ ...project, anchor })} />}
          {step === 5 && project && <SceneStudio project={project} onChange={updateScene} onProjectChange={persist} />}
          {step === 6 && project && <AssetStudio title="썸네일 만들기" eyebrow="THUMBNAIL" description="대표 이미지를 선택하세요. 선택한 썸네일은 영상 마지막 인물 이름 화면의 배경에도 사용됩니다." asset={project.thumbnail} project={project} kind="thumbnail" onChange={(thumbnail) => persist({ ...project, thumbnail })} />}
          {step === 7 && project && <ImageReview project={project} />}
          {step === 8 && project && <Complete project={project} onDownload={() => download(project)} />}
        </section>

        {step > 1 && project && (
          <footer className="bottom-bar">
            <button className="btn ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={17} /> 이전</button>
            <span><Save size={15} /> 변경사항 자동 저장됨</span>
            {step < 8 && <button className="btn primary" disabled={(step === 2 && (!project.scenes.length || project.scenes.some((scene) => !scene.prompt.trim()))) || (step === 3 && reportForProject(project).errors.length > 0) || (step === 7 && completionErrors(project).length > 0)} onClick={() => setStep((value) => Math.min(8, value + 1))}>다음 단계 <ArrowRight size={17} /></button>}
          </footer>
        )}
      </main>
    </div>
  );
}

function Dashboard({ onStart, projects, accessCode, onAccessCode, onOpen, onDownload, onDelete, deletingId }: { onStart: () => void; projects: ProjectData[]; accessCode: string; onAccessCode: (code: string) => void; onOpen: (project: ProjectData) => void; onDownload: (project: ProjectData) => void; onDelete: (project: ProjectData) => void; deletingId: string }) {
  return <div className="dashboard-page"><div className="hero-page">
    <div className="hero-copy">
      <div className="eyebrow">GREAT STORIES, BEAUTIFULLY MADE</div>
      <h1>한 사람의 이야기를<br /><em>한 편의 그림책처럼.</em></h1>
      <p>Work 제작안을 붙여넣으면 장면 이미지·동영상과 자막을 준비하고<br />직접 녹음한 내레이션과 배경음악을 더한 MP4까지 만들 수 있어요.</p>
      <button className="btn primary large" onClick={onStart}><Plus size={19} /> 새 인물 프로젝트</button>
    </div>
    <div className="hero-art" aria-label="Great100 Studio illustration">
      <div className="sun" /><div className="mountain m1" /><div className="mountain m2" />
      <div className="portrait"><div className="hat" /><div className="head" /><div className="body" /></div>
      <div className="ship">⚓</div>
      <div className="hero-card"><span>002</span><strong>다음 이야기를<br />준비해 볼까요?</strong><small>NEW PROJECT</small></div>
    </div>
  </div>
  {!isTauri() && <div className="access-panel"><KeyRound size={18} /><div><strong>실제 이미지 생성 접근 코드</strong><small>배포 관리자에게 받은 코드를 입력하면 OpenAI 이미지 생성이 활성화됩니다. 비워두면 mock mode로 작동합니다.</small></div><input type="password" aria-label="이미지 생성 접근 코드" placeholder="접근 코드 입력" value={accessCode} onChange={(event) => onAccessCode(event.target.value)} /></div>}
  {projects.length > 0 && <div className="recent-projects"><div className="recent-head"><h3>최근 프로젝트</h3><span>{projects.length}개</span></div><div className="recent-grid">{projects.map((item) => <div className="recent-card" key={item.id}><span>EP. {String(item.episode).padStart(3, "0")}</span><strong>{item.person}</strong><small>{item.scenes.length}개 장면 · {new Date(item.updated_at).toLocaleDateString("ko-KR")}</small><div><button className="btn ghost" onClick={() => onOpen(item)}>이어 작업하기</button>{!isTauri() && <button className="btn ghost" onClick={() => onDownload(item)}><Download size={14} /> ZIP</button>}<button className="btn ghost delete-project" disabled={deletingId === item.id} onClick={() => onDelete(item)}>{deletingId === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} 삭제</button></div></div>)}</div></div>}
  </div>;
}

interface SetupProps {
  episode: number; person: string; category: string; source: string; busy: boolean;
  legacyImport: boolean; setLegacyImport: (value: boolean) => void; errors: string[];
  setEpisode: (value: number) => void; setPerson: (value: string) => void; setCategory: (value: string) => void; setSource: (value: string) => void;
  onSample: () => void; onContinue: () => void;
}

function ProjectSetup(props: SetupProps) {
  return <div className="page narrow">
    <PageHeading eyebrow="NEW PROJECT" title="새 이야기를 시작합니다" text="기본 정보와 ChatGPT Work에서 만든 제작안을 입력해 주세요." />
    <div className="panel form-panel">
      <div className="form-grid">
        <label><span>회차</span><input type="number" min="1" value={props.episode} onChange={(e) => props.setEpisode(Number(e.target.value))} /></label>
        <label><span>인물명</span><input placeholder="예: 이순신" value={props.person} onChange={(e) => props.setPerson(e.target.value)} /></label>
        <label><span>분야</span><select value={props.category} onChange={(e) => props.setCategory(e.target.value)}><option>장군 · 지도자</option><option>독립운동가</option><option>과학 · 발명</option><option>예술 · 문화</option><option>사상 · 교육</option></select></label>
      </div>
      <div className="source-head"><div><strong>{props.legacyImport ? "Legacy Markdown 제작안" : "APP_DATA JSON 붙여넣기"}</strong><small>{props.legacyImport ? "기존 자유형 제작안을 추정하여 읽습니다." : "순수 JSON 또는 ## APP_DATA가 포함된 Work 결과를 붙여넣으세요."}</small></div><button className="text-button" onClick={() => { props.setLegacyImport(!props.legacyImport); props.setSource(""); }}>{props.legacyImport ? "APP_DATA JSON 입력으로 전환" : "Legacy Import"}</button></div>
      {props.legacyImport && <button className="text-button" onClick={props.onSample}>이순신 예시 불러오기</button>}
      <textarea className="source-input" placeholder={props.legacyImport ? "기존 Markdown 제작안을 붙여넣으세요…" : "{\n  \"schema_version\": \"2.1\",\n  ...\n}"} value={props.source} onChange={(e) => props.setSource(e.target.value)} />
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
    <div className="v2-scene-list">{project.scenes.map((scene) => <details className="panel v2-scene-card" key={scene.id}><summary><b>{scene.source_scene_id}</b> <span>{scene.start_sec}–{scene.end_sec}초</span> <strong>{scene.title}</strong><small>✓ narration · ✓ description · {scene.captions?.length ? `✓ captions ${scene.captions.length}` : "⚠ captions 0"} · ✓ image</small>{project.source?.core_achievement.scene_id === scene.source_scene_id && <em>★ 핵심 업적 · {project.source?.core_achievement.title}</em>}</summary><div className="scene-data-grid"><p><b>내레이션</b>{scene.narration}</p><p><b>장면 설명</b>{scene.scene_description}</p><p><b>화면 유형 / 구도 / 장소</b>{scene.visual_type} · {scene.shot_type} · {scene.location}</p><p><b>대상 / 행동</b>{scene.main_subject} · {scene.main_action}</p><p><b>이미지 프롬프트</b>{scene.prompt}</p><p><b>보조 이미지</b>{scene.support_image_prompt || "없음"}</p><p><b>강조 자막 / 효과</b>{scene.subtitle ?? scene.caption} · {scene.motion}</p>{scene.overlay_required && <p><b>정확한 역사 자료 오버레이</b>{scene.overlay_type} · {scene.overlay_note}</p>}</div><div className="caption-list"><strong>전체 내레이션 자막 · {scene.captions?.length || 0}개</strong>{scene.captions?.map((block, index) => <p key={index}><span>{block.start_sec}–{block.end_sec}초</span>{block.text}</p>)}</div></details>)}</div>
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

function ImageReview({ project }: { project: ProjectData }) {
  const errors = completionErrors(project);
  return <div className="page"><PageHeading eyebrow="FINAL IMAGE REVIEW" title="전체 장면을 한 번 더 확인하세요" text="Scene 순서와 핵심 업적 장면, 썸네일을 검토한 뒤 MP4를 만듭니다." />
    <div className="review-image-grid">{project.scenes.map((scene) => {
      const image = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id);
      const intro = image?.media_type === "video" ? resolveVideoIntroImage(scene) : undefined;
      const support = scene.support_candidates?.find((candidate) => candidate.id === scene.support_selected_candidate_id);
      return <div className="panel review-image-card" key={scene.id}>
        {image ? <><img src={intro?.preview_url || image.preview_url} alt={`${scene.title} 첫 화면`} /><small className={image.media_type === "video" ? "video-candidate-badge" : ""}>{intro ? "이미지 → 동영상" : image.media_type === "video" ? `동영상 · ${image.duration_sec?.toFixed(1)}초` : "이미지"}</small></> : <div className="candidate-empty">장면 미선택</div>}
        <strong>{scene.source_scene_id || `Scene ${scene.number}`} · {scene.title}</strong>
        {support && <div className="review-support"><img src={support.preview_url} alt={`${scene.title} 보조 이미지`} /><small>후반부 보조 이미지</small></div>}
        {project.source?.core_achievement.scene_id === scene.source_scene_id && <em>★ 핵심 업적</em>}
      </div>;
    })}</div>
    <div className="panel"><h3>썸네일</h3>{project.thumbnail.candidates.find((candidate) => candidate.id === project.thumbnail.selected_candidate_id) ? <img className="review-thumbnail" src={project.thumbnail.candidates.find((candidate) => candidate.id === project.thumbnail.selected_candidate_id)!.preview_url} alt="선택 썸네일" /> : <p>선택된 썸네일이 없습니다.</p>}</div>
    {errors.length > 0 && <div className="error-banner"><strong>완료 전 확인할 항목</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
  </div>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{text}</p></div>;
}

function AssetStudio({ title, eyebrow, description, asset, project, kind, onChange }: { title: string; eyebrow: string; description: string; asset: VisualAsset; project: ProjectData; kind: "anchor" | "thumbnail"; onChange: (asset: VisualAsset) => void }) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullPrompt = kind === "thumbnail" ? composeThumbnailPrompt(project) : "";
  const generate = async () => {
    setError("");
    if (!asset.prompt.trim()) return setError("이미지 내용을 먼저 입력해 주세요.");
    onChange({ ...asset, status: "generating" });
    try {
      const prompt = kind === "thumbnail" ? fullPrompt : `${asset.prompt}\n\n공통 스타일: ${project.style_guide}`;
      const anchor = project.anchor.candidates.find((candidate) => candidate.id === project.anchor.selected_candidate_id);
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: kind, prompt, count: 3, reference_image: kind === "thumbnail" && anchor?.mode === "openai" ? anchor.preview_url : undefined });
      onChange({ ...asset, candidates: [...asset.candidates, ...candidates], status: "ready", prompt_history: appendHistory(asset.prompt_history, prompt) });
    } catch (cause) { setError(String(cause)); onChange({ ...asset, status: "error" }); }
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
      onChange({ ...asset, candidates: [...asset.candidates, ...candidates], selected_candidate_id: candidates.at(-1)?.id || asset.selected_candidate_id, status: "ready", prompt_history: appendHistory(asset.prompt_history, asset.prompt) });
    } catch (cause) { setError(String(cause)); }
    finally { setUploading(false); }
  };
  const removeCandidate = async (id: string) => {
    await deleteCandidateAsset(project, kind, findCandidate(asset.candidates, id));
    onChange(withoutAssetCandidate(asset, id));
  };
  return <div className="page">
    <PageHeading eyebrow={eyebrow} title={title} text={description} />
    <PromptEditor heading={kind === "thumbnail" ? "썸네일 내용 (수정 가능)" : "이미지 프롬프트"} value={asset.prompt} historyCount={asset.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...asset, prompt }); }} onGenerate={generate} onUpload={upload} generating={asset.status === "generating"} uploading={uploading} />
    {kind === "thumbnail" && <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 썸네일 프롬프트</strong><small>썸네일 내용 + 인물 외형 + 스타일 조건을 중복 없이 합칩니다.</small></div><button className="btn ghost" disabled={!asset.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 썸네일 프롬프트" readOnly value={fullPrompt} /></div>}
    {error && <div className="error-banner">{error}</div>}
    <CandidateGrid candidates={asset.candidates} selected={asset.selected_candidate_id} onSelect={(id) => onChange({ ...asset, selected_candidate_id: id })} onDelete={removeCandidate} emptyLabel="이미지를 업로드하거나 후보 3장을 생성해 보세요" />
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

function SceneStudio({ project, onChange, onProjectChange }: { project: ProjectData; onChange: (scene: Scene) => void; onProjectChange: (project: ProjectData) => Promise<void> }) {
  const [active, setActive] = useState(project.scenes[0]?.id || "");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const scene = project.scenes.find((item) => item.id === active) || project.scenes[0];
  if (!scene) return <div className="empty-state"><Circle size={28} /><h3>분석된 장면이 없습니다</h3><p>파싱 확인 단계로 돌아가 Scene 항목을 확인해 주세요.</p></div>;
  const fullPrompt = composeScenePrompt(project, scene);
  const generate = async () => {
    setError("");
    if (!scene.prompt.trim()) return setError("장면 내용을 먼저 입력해 주세요.");
    onChange({ ...scene, status: "generating" });
    try {
      const anchor = project.anchor.candidates.find((candidate) => candidate.id === project.anchor.selected_candidate_id);
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: "scene", scene_number: scene.number, prompt: fullPrompt, count: project.schema_version !== 1 ? 2 : 3, reference_image: anchor?.mode === "openai" ? anchor.preview_url : undefined });
      onChange({ ...scene, candidates: [...scene.candidates, ...candidates], status: "ready", prompt_history: appendHistory(scene.prompt_history, fullPrompt) });
    } catch (cause) { setError(String(cause)); onChange({ ...scene, status: "error" }); }
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
        status: "ready", prompt_history: appendHistory(scene.prompt_history, scene.prompt) });
    } catch (cause) { setError(String(cause)); }
    finally { setUploading(false); }
  };
  const uploadVideo = async (file: File) => {
    setVideoBusy(true); setError("");
    try {
      const candidate = await importSceneVideo(project, scene, file);
      onChange({ ...scene, candidates: [...scene.candidates, candidate], selected_candidate_id: candidate.id, status: "ready" });
    } catch (cause) { setError(String(cause)); }
    finally { setVideoBusy(false); }
  };
  const generateSupport = async () => {
    if (!scene.support_image_prompt?.trim()) return;
    setSupportBusy(true); setError("");
    try {
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: "support", scene_number: scene.number, prompt: `${scene.support_image_prompt}\n\n${project.style_guide}\nno text, no letters, no captions, no watermark. 16:9.`, count: 2 });
      onChange({ ...scene, support_candidates: [...(scene.support_candidates || []), ...candidates], support_selected_candidate_id: scene.support_selected_candidate_id || candidates[0]?.id, support_prompt_history: appendHistory(scene.support_prompt_history || [], scene.support_image_prompt) });
    } catch (cause) { setError(String(cause)); }
    finally { setSupportBusy(false); }
  };
  const uploadSupport = async (files: File[]) => {
    setSupportBusy(true); setError("");
    try {
      const candidates = await importImageCandidates(files, { project_path: project.project_path, asset_kind: "support", scene_number: scene.number });
      onChange({ ...scene, support_candidates: [...(scene.support_candidates || []), ...candidates], support_selected_candidate_id: candidates.at(-1)?.id || scene.support_selected_candidate_id });
    } catch (cause) { setError(String(cause)); }
    finally { setSupportBusy(false); }
  };
  const removeCandidate = async (id: string, support = false) => {
    const candidate = findCandidate(support ? scene.support_candidates || [] : scene.candidates, id);
    await deleteCandidateAsset(project, support ? "support" : "scene", candidate, scene.number);
    onChange(withoutSceneCandidate(scene, id, support));
  };
  const position = project.scenes.findIndex((item) => item.id === scene.id);
  const selectedVideo = scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id)?.media_type === "video";
  const introImages = scene.candidates.filter((candidate) => candidate.media_type !== "video");
  const introImage = selectedVideo ? resolveVideoIntroImage(scene) : undefined;
  const neighbors = [project.scenes[position - 1], project.scenes[position + 1]].filter((item): item is Scene => !!item);
  return <div className="page scene-page">
    <PageHeading eyebrow="SCENE REVIEW" title="장면을 만들고 고르세요" text="프롬프트를 다듬고 각 장면의 최종 이미지 또는 짧은 동영상을 선택합니다." />
    <BackgroundMusicPanel project={project} onChange={onProjectChange} />
    <div className="scene-tabs">{project.scenes.map((item) => <button key={item.id} className={item.id === scene.id ? "active" : ""} onClick={() => { setActive(item.id); setCopied(false); }}><span>{item.selected_candidate_id ? <Check size={13} /> : item.number}</span>{item.title}{item.narration_audio && <Mic size={12} aria-label="녹음 있음" />}</button>)}</div>
    <div className="scene-title"><div><span>SCENE {String(scene.number).padStart(2, "0")}</span><h3>{scene.title}</h3></div></div>
    {project.schema_version !== 1 && <div className="panel scene-context"><div className="scene-context-head"><span>{scene.start_sec}–{scene.end_sec}초</span>{project.source?.core_achievement.scene_id === scene.source_scene_id && <em>★ 핵심 업적 · {project.source?.core_achievement.title}</em>}</div><p><b>내레이션</b> {scene.narration}</p><p><b>장면 설명</b> {scene.scene_description}</p><p><b>화면 구성</b> {scene.visual_type} · {scene.shot_type} · {scene.location}</p><p><b>대상과 행동</b> {scene.main_subject} · {scene.main_action}</p>{scene.overlay_required && <p><b>역사 자료 오버레이</b> {scene.overlay_type} · {scene.overlay_note}</p>}</div>}
    {project.schema_version !== 1 && <div className="panel neighbor-panel"><strong>인접 장면 비교</strong><div className="neighbor-grid">{neighbors.map((item) => { const image = item.candidates.find((candidate) => candidate.id === item.selected_candidate_id); return <div key={item.id}>{image ? <img src={image.preview_url} alt={`${item.title} 선택 이미지`} /> : <div className="neighbor-empty">아직 이미지 없음</div>}<small>{item.source_scene_id} · {item.title}</small></div>; })}</div></div>}
    <PromptEditor heading="장면 내용 (수정 가능)" value={scene.prompt} historyCount={scene.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...scene, prompt }); }} onGenerate={generate} onUpload={upload} generating={scene.status === "generating"} uploading={uploading} generateCount={project.schema_version !== 1 ? 2 : 3} />
    <div className="panel scene-video-upload"><div><strong>짧은 동영상 추가</strong><small>MP4 · 최대 10초 · 50MB 이하. 이미지도 함께 올리면 이미지가 먼저 잠깐 보인 뒤 영상으로 이어집니다. 원본 소리는 사용하지 않습니다.</small></div><input ref={videoInput} className="file-input" type="file" accept=".mp4,video/mp4" aria-label="장면 MP4 파일 선택" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /><button className="btn ghost" disabled={videoBusy || uploading} onClick={() => videoInput.current?.click()}>{videoBusy ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{videoBusy ? "동영상 처리 중…" : "MP4 업로드"}</button></div>
    <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 이미지 프롬프트</strong><small>장면 내용 + 인물 외형 기준 + 공통 스타일이 항상 함께 들어갑니다.</small></div><button className="btn ghost" disabled={!scene.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 이미지 프롬프트" readOnly value={fullPrompt} /></div>
    {project.schema_version === "2.1" ? <V21CaptionEditor scene={scene} onChange={onChange} /> : <div className="panel caption-panel"><label><strong>영상 자막</strong><small>이 문장이 장면 이미지 위에 표시됩니다.</small><textarea aria-label="영상 자막" value={scene.caption ?? scene.title} onChange={(event) => onChange({ ...scene, caption: event.target.value })} /></label><label className="duration-label"><strong>표시 시간 (초)</strong><input aria-label="장면 표시 시간" type="number" min="1" max="120" step="1" disabled={project.schema_version === "2.0"} title={project.schema_version === "2.0" ? "v2 시간은 APP_DATA의 시작·종료 시간을 따릅니다." : undefined} value={scene.duration ?? 10} onChange={(event) => onChange({ ...scene, duration: Number(event.target.value) })} /></label><label className="motion-label"><strong>이미지 효과</strong><small>MP4에 적용됩니다.</small><select aria-label="이미지 효과" value={scene.motion ?? "auto"} onChange={(event) => onChange({ ...scene, motion: event.target.value as ImageMotion })}><option value="auto">자동 (장면마다 다르게)</option><option value="zoom-in">천천히 줌인</option><option value="zoom-out">천천히 줌아웃</option><option value="pan-left">왼쪽으로 이동</option><option value="pan-right">오른쪽으로 이동</option><option value="pan-up">위로 이동</option><option value="pan-down">아래로 이동</option><option value="none">효과 없음</option></select></label></div>}
    <SceneNarrationPanel key={scene.id} project={project} scene={scene} onChange={onChange} />
    <div className="panel music-volume-panel"><label><strong>이 장면의 배경음악 볼륨</strong><small>{project.background_music ? "장면이 바뀔 때 볼륨도 부드럽게 바뀝니다." : "음악을 추가하면 이 설정이 적용됩니다."}</small><input aria-label="장면 배경음악 볼륨" type="range" min="0" max="100" step="1" value={sceneMusicVolume(scene.music_volume)} onChange={(event) => onChange({ ...scene, music_volume: Number(event.target.value) })} /></label><output>{sceneMusicVolume(scene.music_volume)}%</output></div>
    {error && <div className="error-banner">{error}</div>}
    <CandidateGrid candidates={scene.candidates} selected={scene.selected_candidate_id} onSelect={(id) => onChange({ ...scene, selected_candidate_id: id })} onDelete={(id) => removeCandidate(id)} emptyLabel="이 장면의 이미지나 동영상을 업로드해 보세요" />
    {selectedVideo && introImages.length > 0 && <div className="panel video-intro-panel"><div><strong>동영상 앞에 보여줄 이미지</strong><small>장면 시간 안에서 최대 1.5초 표시한 뒤 0.3초 동안 동영상으로 부드럽게 전환됩니다. 자막은 두 화면 모두에 표시됩니다.</small></div><div className="video-intro-choice"><select aria-label="동영상 앞 이미지" value={scene.video_intro_candidate_id === null ? "none" : scene.video_intro_candidate_id ?? "auto"} onChange={(event) => onChange({ ...scene, video_intro_candidate_id: event.target.value === "none" ? null : event.target.value === "auto" ? undefined : event.target.value })}><option value="auto">자동 · 최근 업로드 이미지</option><option value="none">이미지 없이 동영상만</option>{introImages.map((candidate, index) => <option key={candidate.id} value={candidate.id}>이미지 후보 {index + 1}{candidate.mode === "uploaded" ? " · 업로드" : ""}</option>)}</select>{introImage && <img src={introImage.preview_url} alt="동영상 앞에 표시할 이미지" />}</div></div>}
    {selectedVideo && <SceneVideoPreview project={project} scene={scene} candidate={scene.candidates.find((candidate) => candidate.id === scene.selected_candidate_id)!} />}
    {project.schema_version !== 1 && (scene.support_image_prompt || scene.support_candidates?.length) && <><div className="panel support-panel"><h3>보조 이미지 · 별도 생성</h3><p className="support-hint">선택한 보조 이미지는 이 장면의 후반부에 부드럽게 전환되어 MP4에 들어갑니다.</p><textarea aria-label="보조 이미지 프롬프트" value={scene.support_image_prompt || ""} onChange={(event) => onChange({ ...scene, support_image_prompt: event.target.value })} /><div className="prompt-actions"><label className="btn ghost support-upload">보조 이미지 업로드<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void uploadSupport(files); }} /></label><button className="btn primary" disabled={supportBusy} onClick={generateSupport}>{supportBusy ? "처리 중…" : "보조 후보 2장 생성"}</button></div></div><CandidateGrid candidates={scene.support_candidates || []} selected={scene.support_selected_candidate_id} onSelect={(id) => onChange({ ...scene, support_selected_candidate_id: id })} onDelete={(id) => removeCandidate(id, true)} emptyLabel="보조 이미지는 선택 사항입니다" /></>}
  </div>;
}

function V21CaptionEditor({ scene, onChange }: { scene: Scene; onChange: (scene: Scene) => void }) {
  const editBlock = (index: number, patch: Partial<NonNullable<Scene["captions"]>[number]>) => onChange({ ...scene, captions: (scene.captions || []).map((block, position) => position === index ? { ...block, ...patch } : block) });
  return <div className="panel v21-caption-panel">
    <label><strong>강조 자막 · subtitle (선택)</strong><small>비워두면 강조 문구 없이 아래 전체 자막만 표시됩니다.</small><textarea aria-label="강조 자막" value={scene.subtitle || ""} onChange={(event) => onChange({ ...scene, subtitle: event.target.value, title: event.target.value.trim() || `Scene ${String(scene.number).padStart(2, "0")}` })} /></label>
    <div className="caption-blocks"><strong>전체 내레이션 자막 · captions {scene.captions?.length || 0}개</strong><small>Work가 나눈 의미 단위와 표시 시간을 그대로 사용합니다. MP4 하단에 순서대로 나타납니다.</small>{scene.captions?.map((block, index) => <div className="caption-block-row" key={index}><span>{index + 1}</span><textarea aria-label={`Caption ${index + 1} 텍스트`} value={block.text} onChange={(event) => editBlock(index, { text: event.target.value })} /><label>시작<input aria-label={`Caption ${index + 1} 시작`} type="number" step="0.1" value={block.start_sec} onChange={(event) => editBlock(index, { start_sec: Number(event.target.value) })} /></label><label>종료<input aria-label={`Caption ${index + 1} 종료`} type="number" step="0.1" value={block.end_sec} onChange={(event) => editBlock(index, { end_sec: Number(event.target.value) })} /></label></div>)}</div>
    <div className="caption-settings"><span>표시 시간: {scene.duration}초 (APP_DATA 기준)</span><label><strong>이미지 효과</strong><select aria-label="이미지 효과" value={scene.motion ?? "auto"} onChange={(event) => onChange({ ...scene, motion: event.target.value as ImageMotion })}><option value="auto">자동</option><option value="zoom-in">줌인</option><option value="zoom-out">줌아웃</option><option value="pan-left">왼쪽으로 이동</option><option value="pan-right">오른쪽으로 이동</option><option value="pan-up">위로 이동</option><option value="pan-down">아래로 이동</option><option value="none">효과 없음</option></select></label></div>
  </div>;
}

function PromptEditor({ heading = "이미지 프롬프트", value, historyCount, onChange, onGenerate, onUpload, generating, uploading, generateCount = 3 }: { heading?: string; value: string; historyCount: number; onChange: (value: string) => void; onGenerate: () => void; onUpload: (files: File[]) => void; generating: boolean; uploading: boolean; generateCount?: number }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="panel prompt-panel"><div className="prompt-head"><div><strong>{heading}</strong><small>수정 이력 {historyCount}개</small></div><div className="prompt-actions"><input ref={input} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="후보 이미지 파일 선택" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) onUpload(files); }} /><button className="btn ghost" disabled={generating || uploading} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{uploading ? "업로드 중…" : "이미지 업로드"}</button><button className="btn primary" disabled={generating || uploading} onClick={onGenerate}>{generating ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{generating ? "생성 중…" : `후보 ${generateCount}장 생성`}</button></div></div><textarea value={value} onChange={(e) => onChange(e.target.value)} /><p className="upload-hint">ChatGPT Plus에서 만든 PNG·JPEG·WebP를 업로드할 수 있어요. 최대 6장, 각 12MB.</p></div>;
}

function CandidateGrid({ candidates, selected, onSelect, onDelete, emptyLabel }: { candidates: ImageCandidate[]; selected?: string; onSelect: (id: string) => void; onDelete?: (id: string) => Promise<void>; emptyLabel: string }) {
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const remove = async (candidate: ImageCandidate, index: number) => {
    if (!onDelete) return;
    const media = candidate.media_type === "video" ? "동영상" : "이미지";
    const selectedWarning = selected === candidate.id ? "\n선택된 후보라서 다시 다른 후보를 골라야 합니다." : "";
    if (!window.confirm(`${media} 후보 ${index + 1} 삭제할까요?${selectedWarning}\n\n삭제한 파일은 복구할 수 없고, 기존 MP4는 다시 만들어야 합니다.`)) return;
    setDeletingId(candidate.id); setError("");
    try { await onDelete(candidate.id); }
    catch (cause) { setError(`후보 삭제 실패: ${String(cause)}`); }
    finally { setDeletingId(""); }
  };
  if (!candidates.length) return <div className="candidate-empty"><ImageIcon size={30} /><strong>{emptyLabel}</strong><span>접근 코드가 없으면 생성 버튼은 mock 미리보기를 만듭니다.</span></div>;
  return <><div className="candidate-grid">{candidates.map((candidate, index) => <div key={candidate.id} className="candidate-card"><button className={`candidate ${selected === candidate.id ? "selected" : ""}`} disabled={!!deletingId} onClick={() => onSelect(candidate.id)}><img src={candidate.preview_url} alt={`후보 ${index + 1}`} /><span className="candidate-label">후보 {index + 1}</span><span className="mode-label">{candidate.media_type === "video" ? `동영상 · ${candidate.duration_sec?.toFixed(1)}초` : candidate.mode === "uploaded" ? "업로드" : candidate.mode}</span>{selected === candidate.id && <i><CheckCircle2 size={22} /> 선택됨</i>}</button>{onDelete && <button className="candidate-delete" aria-label={`후보 ${index + 1} 삭제`} title={`${candidate.media_type === "video" ? "동영상" : "이미지"} 후보 삭제`} disabled={!!deletingId} onClick={() => void remove(candidate, index)}>{deletingId === candidate.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}<span>삭제</span></button>}</div>)}</div>{error && <div className="error-banner">{error}</div>}</>;
}

function SceneVideoPreview({ project, scene, candidate }: { project: ProjectData; scene: Scene; candidate: ImageCandidate }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    getSceneVideo(project, scene, candidate).then((blob) => {
      if (!blob) throw new Error("동영상 파일을 찾지 못했습니다. 다시 업로드해 주세요.");
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [project.id, scene.id, candidate.id]);
  return <div className="panel scene-video-preview"><strong>선택한 동영상 미리보기</strong>{url && <video controls muted playsInline preload="metadata" src={url} poster={candidate.preview_url} />}{error && <div className="error-banner">{error}</div>}</div>;
}

function Complete({ project, onDownload }: { project: ProjectData; onDownload: () => void }) {
  const sceneDone = project.scenes.filter((scene) => scene.selected_candidate_id).length;
  const narrationDone = project.scenes.filter((scene) => scene.narration_audio).length;
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
    <div className="summary-cards"><div><span>회차</span><strong>{String(project.episode).padStart(3, "0")}</strong></div><div><span>선택 장면</span><strong>{sceneDone}/{project.scenes.length}</strong></div><div><span>녹음 장면</span><strong>{narrationDone}/{project.scenes.length}</strong></div><div><span>영상 길이</span><strong>{duration ? `${duration}초` : "이미지 확인"}</strong></div></div>
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
