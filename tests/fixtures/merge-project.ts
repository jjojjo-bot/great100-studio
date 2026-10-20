import { editorProject } from "./editor-project";
import { prepareEditorWrite } from "../../src/editor-format";

export function mergeProject() {
  const project = editorProject(); project.project_path = `projects/${project.folder_name}`;
  let start = 0;
  for (const [index, scene] of project.scenes.entries()) {
    scene.duration = [1.1, 2.3, 1.7][index]; scene.start_sec = start; scene.end_sec = Math.round((start + scene.duration) * 1000) / 1000;
    scene.subtitle = `강조 ${index + 1}`; scene.music_volume = [10, 90, 30][index]; scene.motion = index ? "auto" : "zoom-in";
    scene.captions = [{ ...scene.captions![0], start_sec: start, end_sec: scene.end_sec }]; start = scene.end_sec;
    scene.candidates = [{ id: `image-${index}`, path: `${project.project_path}/03_images/scene0${index + 1}/image.png`, preview_url: "data:image/png;base64,a", created_at: "now", mode: "uploaded" }];
    scene.selected_candidate_id = `image-${index}`;
    if (index < 2) scene.narration_audio = { id: `voice-${index}`, name: `voice-${index}.wav`, path: `${project.project_path}/03_images/scene0${index + 1}/voice.wav`, mime_type: "audio/wav", duration_sec: scene.duration };
  }
  const first = project.scenes[0];
  first.candidates.push({ ...first.candidates[0], id: "video", path: `${project.project_path}/03_images/scene01/video.mp4`, media_type: "video", duration_sec: 3 });
  first.selected_candidate_id = "video"; first.video_intro_duration_sec = 0.3; first.video_trim_start_sec = 0.4; first.video_trim_end_sec = 1.4;
  first.support_candidates = [{ ...first.candidates[0], id: "support", path: `${project.project_path}/03_images/scene01/support.png` }];
  first.support_selected_candidate_id = "support"; first.support_start_sec = 0.5;
  return prepareEditorWrite(project);
}
