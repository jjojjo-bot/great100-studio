import { useEffect, useState } from "react";
import { CloudUpload, LoaderCircle } from "lucide-react";
import { importLocalProject, localProjectsForImport } from "./platform";
import type { ProjectData } from "./types";

export function LocalProjectImport({ onImported, onBusyChange }: { onImported: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true;
    void localProjectsForImport().then(value => { if (active) setProjects(value); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const migrate = async (project: ProjectData) => {
    if (!window.confirm(`${project.person} 프로젝트와 이미지·동영상·녹음을 현재 로그인한 계정으로 옮길까요?\n\n회차는 계정 기준으로 새로 부여되며, 이 브라우저의 원본은 유지됩니다.`)) return;
    setBusy(project.id); onBusyChange(true); setError(""); setProgress("이전 준비 중");
    try {
      await importLocalProject(project.id, setProgress);
      setProjects(items => items.filter(item => item.id !== project.id));
      await onImported();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(""); onBusyChange(false); }
  };
  if (!projects.length && !error) return null;
  return <section className="panel local-import-panel" aria-label="이 브라우저의 기존 작업 이전">
    <h3><CloudUpload size={20} /> 기존 작업을 계정으로 옮기기</h3>
    <p>이 브라우저에 저장된 작업입니다. 선택한 프로젝트와 원본 파일을 옮기면 다른 PC에서도 이어서 작업할 수 있습니다.</p>
    {projects.map(project => <div className="local-import-row" key={project.id}><span><strong>{project.person}</strong><small>{project.scenes.length}개 장면 · 기존 EP. {project.episode}</small></span><button className="btn ghost" disabled={!!busy} onClick={() => void migrate(project)}>{busy === project.id ? <LoaderCircle className="spin" size={15} /> : <CloudUpload size={15} />} 계정으로 옮기기</button></div>)}
    {busy && <p role="status">{progress}</p>}{error && <div className="auth-error" role="alert">{error}</div>}
  </section>;
}
