import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, Trash2, Upload } from "lucide-react";
import { getSceneNarration, removeSceneNarration, saveSceneNarration } from "./platform";
import type { ProjectData, Scene } from "./types";
import { CaptionWaveform } from "./CaptionWaveform";

export function SceneNarrationPanel({ project, scene, onChange }: { project: ProjectData; scene: Scene; onChange: (scene: Scene) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [revision, setRevision] = useState(0);
  const duration = scene.duration ?? 10;

  useEffect(() => {
    let active = true;
    let url = "";
    if (scene.narration_audio) {
      getSceneNarration(project, scene).then((blob) => {
        if (!blob) throw new Error("저장된 녹음을 찾지 못했습니다. 다시 녹음하거나 업로드해 주세요.");
        url = URL.createObjectURL(blob);
        if (active) { setPreviewUrl(url); setPreviewBlob(blob); }
        else URL.revokeObjectURL(url);
      }).catch((cause) => { if (active) setError(String(cause)); });
    } else { setPreviewUrl(""); setPreviewBlob(null); }
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [project.id, scene.id, scene.narration_audio?.path, revision]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const upload = async (file: File) => {
    setBusy(true); setError("");
    try {
      const narration_audio = await saveSceneNarration(project, scene, file);
      onChange({ ...scene, narration_audio });
      setRevision((value) => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("이 브라우저에서는 마이크 녹음을 사용할 수 없습니다. 오디오 파일을 업로드해 주세요.");
      return;
    }
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = microphone;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(microphone, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        microphone.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
        setRecording(false);
        if (!chunks.length) return setError("녹음된 소리가 없습니다. 다시 시도해 주세요.");
        const mime = current.mimeType.split(";")[0];
        const extension = mime === "audio/mp4" ? "m4a" : mime === "audio/webm" ? "webm" : "";
        if (!extension) return setError("이 브라우저의 녹음 형식을 사용할 수 없습니다. 오디오 파일을 업로드해 주세요.");
        void upload(new File(chunks, `scene${String(scene.number).padStart(2, "0")}.${extension}`, { type: mime }));
      };
      current.start();
      recorder.current = current;
      setElapsed(0);
      setRecording(true);
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const seconds = (Date.now() - started) / 1000;
        setElapsed(seconds);
        if (seconds >= Math.max(0.5, duration - 0.25) && current.state === "recording") current.stop();
      }, 100);
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setError(`마이크를 사용할 수 없습니다: ${String(cause)}`);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Scene ${scene.number} 녹음을 제거할까요?`)) return;
    setBusy(true); setError("");
    try {
      await removeSceneNarration(project, scene);
      onChange({ ...scene, narration_audio: undefined });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  return <div className="panel narration-panel">
    <div className="narration-head"><div><strong>이 장면의 내레이션</strong><small>씬마다 녹음하면 틀린 장면만 다시 녹음할 수 있습니다. 녹음은 장면 시작에 맞춰 들어갑니다.</small></div><span>{duration}초 장면</span></div>
    <div className="narration-actions"><input ref={input} className="file-input" type="file" accept=".mp3,.wav,.m4a,.mp4,.webm,audio/*,video/mp4" aria-label={`Scene ${scene.number} 내레이션 파일 선택`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      {recording ? <button className="btn primary" onClick={() => recorder.current?.stop()}><Square size={15} /> 녹음 마치기 · {elapsed.toFixed(1)}초</button> : <button className="btn primary" disabled={busy} onClick={() => void startRecording()}><Mic size={16} /> {scene.narration_audio ? "다시 녹음" : "녹음 시작"}</button>}
      <button className="btn ghost" disabled={busy || recording} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} 파일 업로드</button>
    </div>
    {scene.narration_audio && <div className="narration-file"><span>{scene.narration_audio.name} · {scene.narration_audio.duration_sec.toFixed(1)}초</span>{previewUrl && <audio controls preload="metadata" src={previewUrl} onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)} aria-label={`Scene ${scene.number} 내레이션 미리듣기`} />}<button className="btn ghost" disabled={busy || recording} onClick={() => void remove()}><Trash2 size={15} /> 제거</button></div>}
    {previewBlob && project.schema_version === "2.1" && <CaptionWaveform blob={previewBlob} scene={scene} onChange={onChange} playhead={playhead} />}
    <small className="narration-hint">MP3·WAV·M4A·MP4·WebM, 30MB 이하. 장면보다 짧은 녹음은 나머지 시간에 음악만 재생되고, 긴 녹음은 저장 전에 안내합니다. 목소리가 나올 때 배경음악은 자동으로 작아집니다.</small>
    {error && <div className="error-banner">{error}</div>}
  </div>;
}
