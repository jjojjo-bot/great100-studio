import { useEffect, useMemo, useRef, useState } from "react";
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
import { composeScenePrompt, composeThumbnailPrompt } from "./prompts";
import { createProjectOnDisk, deleteProject, downloadBlob, exportProjectZip, generateImages, getAccessCode, getRenderedVideo, importImageCandidates, isTauri, listProjects, saveProject, saveRenderedVideo, setAccessCode } from "./platform";
import { buildVideoPlan, renderProjectMp4 } from "./video";
import { SAMPLE_WORK_TEXT } from "./sample";
import type { ImageCandidate, ProjectData, Scene, VisualAsset } from "./types";

const STEPS = ["대시보드", "프로젝트", "파싱 확인", "기준 이미지", "Scene 검토", "썸네일", "완료"];

function App() {
  const [step, setStep] = useState(0);
  const [episode, setEpisode] = useState(1);
  const [person, setPerson] = useState("");
  const [category, setCategory] = useState("장군 · 지도자");
  const [source, setSource] = useState("");
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
      const draft = createProjectDraft(episode, person, category, source);
      const path = await createProjectOnDisk(draft);
      draft.project_path = path;
      await saveProject(draft);
      setProject(draft);
      setProjects((items) => [draft, ...items]);
      setPerson(draft.person);
      setNotice(draft.scenes.length ? `${draft.scenes.length}개 장면을 찾았습니다.` : "");
      setStep(2);
    } catch (error) {
      setNotice(`프로젝트 생성 실패: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const persist = async (next: ProjectData) => {
    const updated = { ...next, updated_at: new Date().toISOString() };
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
            <ProjectSetup episode={episode} person={person} category={category} source={source} busy={busy}
              setEpisode={setEpisode} setPerson={setPerson} setCategory={setCategory} setSource={setSource}
              onSample={() => { setSource(SAMPLE_WORK_TEXT); setPerson("이순신"); setEpisode(2); }} onContinue={prepareProject} />
          )}
          {step === 2 && project && <ParseReview project={project} onChange={persist} onReparse={reparseSource} />}
          {step === 3 && project && <AssetStudio title="인물 기준 이미지" eyebrow="CHARACTER ANCHOR" description="모든 장면에서 같은 얼굴과 복식을 유지할 기준 이미지를 고르세요." asset={project.anchor} project={project} kind="anchor" onChange={(anchor) => persist({ ...project, anchor })} />}
          {step === 4 && project && <SceneStudio project={project} onChange={updateScene} />}
          {step === 5 && project && <AssetStudio title="썸네일 만들기" eyebrow="THUMBNAIL" description="영상의 첫인상을 결정할 대표 이미지를 선택하세요. 썸네일은 ZIP에 보관되며 영상 본편에는 들어가지 않습니다." asset={project.thumbnail} project={project} kind="thumbnail" onChange={(thumbnail) => persist({ ...project, thumbnail })} />}
          {step === 6 && project && <Complete project={project} onDownload={() => download(project)} />}
        </section>

        {step > 1 && project && (
          <footer className="bottom-bar">
            <button className="btn ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={17} /> 이전</button>
            <span><Save size={15} /> 변경사항 자동 저장됨</span>
            {step < 6 && <button className="btn primary" disabled={step === 2 && (!project.scenes.length || project.scenes.some((scene) => !scene.prompt.trim()))} onClick={() => setStep((value) => Math.min(6, value + 1))}>다음 단계 <ArrowRight size={17} /></button>}
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
      <p>Work 제작안을 붙여넣으면 장면 이미지와 자막을 준비하고<br />무음 MP4까지 한 흐름에서 만들 수 있어요.</p>
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
      <div className="source-head"><div><strong>Work 제작안</strong><small>Scene, 인물 외형, 썸네일, 엔딩 메시지를 자동으로 찾아요.</small></div><button className="text-button" onClick={props.onSample}>이순신 예시 불러오기</button></div>
      <textarea className="source-input" placeholder="ChatGPT Work 결과를 여기에 그대로 붙여넣으세요…" value={props.source} onChange={(e) => props.setSource(e.target.value)} />
      <div className="style-note"><WandSparkles size={18} /><div><strong>공통 스타일 가이드</strong><p>{DEFAULT_STYLE}</p></div></div>
      <button className="btn primary wide" disabled={props.busy} onClick={props.onContinue}>{props.busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} 프로젝트 만들고 분석하기</button>
    </div>
  </div>;
}

function ParseReview({ project, onChange, onReparse }: { project: ProjectData; onChange: (value: ProjectData) => void; onReparse: () => void }) {
  const set = (patch: Partial<ProjectData>) => onChange({ ...project, ...patch });
  const editScene = (id: string, patch: Partial<Scene>) => set({ scenes: project.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) });
  const addScene = () => {
    const number = Math.max(0, ...project.scenes.map((scene) => scene.number)) + 1;
    const scene: Scene = { id: `scene-${String(number).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8)}`, number, title: `장면 ${number}`, duration: 10, caption: "", prompt: "", prompt_history: [], candidates: [], status: "idle" };
    set({ scenes: [...project.scenes, scene] });
  };
  const removeScene = (id: string) => {
    const scene = project.scenes.find((item) => item.id === id);
    if (!scene || !window.confirm(`${scene.title} 장면과 선택한 이미지를 목록에서 삭제할까요?`)) return;
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
  return <div className="page">
    <PageHeading eyebrow={eyebrow} title={title} text={description} />
    <PromptEditor heading={kind === "thumbnail" ? "썸네일 내용 (수정 가능)" : "이미지 프롬프트"} value={asset.prompt} historyCount={asset.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...asset, prompt }); }} onGenerate={generate} onUpload={upload} generating={asset.status === "generating"} uploading={uploading} />
    {kind === "thumbnail" && <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 썸네일 프롬프트</strong><small>썸네일 내용 + 인물 외형 + 스타일 조건을 중복 없이 합칩니다.</small></div><button className="btn ghost" disabled={!asset.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 썸네일 프롬프트" readOnly value={fullPrompt} /></div>}
    {error && <div className="error-banner">{error}</div>}
    <CandidateGrid candidates={asset.candidates} selected={asset.selected_candidate_id} onSelect={(id) => onChange({ ...asset, selected_candidate_id: id })} emptyLabel="이미지를 업로드하거나 후보 3장을 생성해 보세요" />
  </div>;
}

function SceneStudio({ project, onChange }: { project: ProjectData; onChange: (scene: Scene) => void }) {
  const [active, setActive] = useState(project.scenes[0]?.id || "");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const scene = project.scenes.find((item) => item.id === active) || project.scenes[0];
  if (!scene) return <div className="empty-state"><Circle size={28} /><h3>분석된 장면이 없습니다</h3><p>파싱 확인 단계로 돌아가 Scene 항목을 확인해 주세요.</p></div>;
  const fullPrompt = composeScenePrompt(project, scene);
  const generate = async () => {
    setError("");
    if (!scene.prompt.trim()) return setError("장면 내용을 먼저 입력해 주세요.");
    onChange({ ...scene, status: "generating" });
    try {
      const anchor = project.anchor.candidates.find((candidate) => candidate.id === project.anchor.selected_candidate_id);
      const candidates = await generateImages({ project_path: project.project_path, asset_kind: "scene", scene_number: scene.number, prompt: fullPrompt, count: 3, reference_image: anchor?.mode === "openai" ? anchor.preview_url : undefined });
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
      onChange({ ...scene, candidates: [...scene.candidates, ...candidates], selected_candidate_id: candidates.at(-1)?.id || scene.selected_candidate_id, status: "ready", prompt_history: appendHistory(scene.prompt_history, scene.prompt) });
    } catch (cause) { setError(String(cause)); }
    finally { setUploading(false); }
  };
  return <div className="page scene-page">
    <PageHeading eyebrow="SCENE REVIEW" title="장면을 만들고 고르세요" text="프롬프트를 다듬고 각 장면의 최종 이미지를 하나씩 선택합니다." />
    <div className="scene-tabs">{project.scenes.map((item) => <button key={item.id} className={item.id === scene.id ? "active" : ""} onClick={() => { setActive(item.id); setCopied(false); }}><span>{item.selected_candidate_id ? <Check size={13} /> : item.number}</span>{item.title}</button>)}</div>
    <div className="scene-title"><div><span>SCENE {String(scene.number).padStart(2, "0")}</span><h3>{scene.title}</h3></div></div>
    <PromptEditor heading="장면 내용 (수정 가능)" value={scene.prompt} historyCount={scene.prompt_history.length} onChange={(prompt) => { setCopied(false); onChange({ ...scene, prompt }); }} onGenerate={generate} onUpload={upload} generating={scene.status === "generating"} uploading={uploading} />
    <div className="panel full-prompt-panel"><div className="full-prompt-head"><div><strong>복사용 전체 이미지 프롬프트</strong><small>장면 내용 + 인물 외형 기준 + 공통 스타일이 항상 함께 들어갑니다.</small></div><button className="btn ghost" disabled={!scene.prompt.trim()} onClick={copyFullPrompt}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "복사됨" : "전체 프롬프트 복사"}</button></div><textarea aria-label="복사용 전체 이미지 프롬프트" readOnly value={fullPrompt} /></div>
    <div className="panel caption-panel"><label><strong>영상 자막</strong><small>이 문장이 장면 이미지 위에 표시됩니다.</small><textarea aria-label="영상 자막" value={scene.caption ?? scene.title} onChange={(event) => onChange({ ...scene, caption: event.target.value })} /></label><label className="duration-label"><strong>표시 시간 (초)</strong><input aria-label="장면 표시 시간" type="number" min="1" max="120" step="1" value={scene.duration ?? 10} onChange={(event) => onChange({ ...scene, duration: Number(event.target.value) })} /></label></div>
    {error && <div className="error-banner">{error}</div>}
    <CandidateGrid candidates={scene.candidates} selected={scene.selected_candidate_id} onSelect={(id) => onChange({ ...scene, selected_candidate_id: id })} emptyLabel="이 장면의 이미지를 업로드하거나 생성해 보세요" />
  </div>;
}

function PromptEditor({ heading = "이미지 프롬프트", value, historyCount, onChange, onGenerate, onUpload, generating, uploading }: { heading?: string; value: string; historyCount: number; onChange: (value: string) => void; onGenerate: () => void; onUpload: (files: File[]) => void; generating: boolean; uploading: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="panel prompt-panel"><div className="prompt-head"><div><strong>{heading}</strong><small>수정 이력 {historyCount}개</small></div><div className="prompt-actions"><input ref={input} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="후보 이미지 파일 선택" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) onUpload(files); }} /><button className="btn ghost" disabled={generating || uploading} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{uploading ? "업로드 중…" : "이미지 업로드"}</button><button className="btn primary" disabled={generating || uploading} onClick={onGenerate}>{generating ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{generating ? "생성 중…" : "후보 3장 생성"}</button></div></div><textarea value={value} onChange={(e) => onChange(e.target.value)} /><p className="upload-hint">ChatGPT Plus에서 만든 PNG·JPEG·WebP를 업로드할 수 있어요. 최대 6장, 각 12MB.</p></div>;
}

function CandidateGrid({ candidates, selected, onSelect, emptyLabel }: { candidates: ImageCandidate[]; selected?: string; onSelect: (id: string) => void; emptyLabel: string }) {
  if (!candidates.length) return <div className="candidate-empty"><ImageIcon size={30} /><strong>{emptyLabel}</strong><span>접근 코드가 없으면 생성 버튼은 mock 미리보기를 만듭니다.</span></div>;
  return <div className="candidate-grid">{candidates.map((candidate, index) => <button key={candidate.id} className={`candidate ${selected === candidate.id ? "selected" : ""}`} onClick={() => onSelect(candidate.id)}><img src={candidate.preview_url} alt={`후보 ${index + 1}`} /><span className="candidate-label">후보 {index + 1}</span><span className="mode-label">{candidate.mode === "uploaded" ? "업로드" : candidate.mode}</span>{selected === candidate.id && <i><CheckCircle2 size={22} /> 선택됨</i>}</button>)}</div>;
}

function Complete({ project, onDownload }: { project: ProjectData; onDownload: () => void }) {
  const sceneDone = project.scenes.filter((scene) => scene.selected_candidate_id).length;
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
  return <div className="complete-page"><div className="complete-mark"><Check size={42} /></div><div className="eyebrow">VIDEO EXPORT</div><h2>{project.person} 편 영상 만들기</h2><p>선택한 장면 이미지를 이어 붙이고 자막을 입힌 무음 MP4를 만듭니다. 음성·배경음악은 포함되지 않습니다.</p><div className="summary-cards"><div><span>회차</span><strong>{String(project.episode).padStart(3, "0")}</strong></div><div><span>선택 장면</span><strong>{sceneDone}/{project.scenes.length}</strong></div><div><span>영상 길이</span><strong>{duration ? `${duration}초` : "이미지 확인"}</strong></div></div><div className="folder-tree"><FolderOpen size={22} /><div><strong>{project.project_path}</strong><small>완성 MP4: 05_exports/{project.folder_name}.mp4 · 1280×720 · 무음</small></div></div><div className="video-actions"><button className="btn primary export-button" disabled={rendering} onClick={makeVideo}>{rendering ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{rendering ? `MP4 만드는 중… ${percent}%` : video ? "MP4 다시 만들기" : "무음 MP4 만들기"}</button>{video && <><button className="btn ghost export-button" onClick={() => downloadBlob(video, `${project.folder_name}.mp4`)}><Download size={17} /> MP4 다시 다운로드</button>{!isTauri() && <button className="btn ghost export-button" onClick={onDownload}><Download size={17} /> MP4 포함 ZIP 다운로드</button>}</>}</div>{rendering && <div className="render-progress"><i style={{ width: `${percent}%` }} /></div>}{error && <div className="error-banner">{error}</div>}{video && <p className="video-ready"><CheckCircle2 size={17} /> MP4가 완성되었습니다. 자막이나 이미지를 수정하면 다시 만들어 주세요.</p>}{previewUrl && <video className="video-preview" aria-label="완성 MP4 미리보기" src={previewUrl} controls playsInline /> }<div className="ending"><span>엔딩 메시지</span><p>“{project.ending_message || "아직 엔딩 메시지가 없습니다."}”</p></div></div>;
}

function appendHistory(history: { prompt: string; created_at: string }[], prompt: string) {
  if (history.at(-1)?.prompt === prompt) return history;
  return [...history, { prompt, created_at: new Date().toISOString() }];
}

export default App;
