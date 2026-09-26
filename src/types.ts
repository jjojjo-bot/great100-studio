export type CandidateStatus = "idle" | "generating" | "ready" | "error";
export type ImageMotion = "auto" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "none";

export interface PromptRevision {
  prompt: string;
  created_at: string;
}

export interface CaptionBlock {
  text: string;
  start_sec: number;
  end_sec: number;
}

export interface ImageCandidate {
  id: string;
  path: string;
  preview_url: string;
  created_at: string;
  mode: "mock" | "openai" | "uploaded";
  media_type?: "image" | "video";
  duration_sec?: number;
}

export interface Scene {
  id: string;
  number: number;
  title: string;
  duration?: number;
  caption?: string;
  subtitle?: string;
  captions?: CaptionBlock[];
  motion?: ImageMotion;
  music_volume?: number;
  narration_audio?: SceneNarrationAudio;
  prompt: string;
  full_prompt?: string;
  prompt_history: PromptRevision[];
  candidates: ImageCandidate[];
  selected_candidate_id?: string;
  status: CandidateStatus;
  source_scene_id?: string;
  start_sec?: number;
  end_sec?: number;
  narration?: string;
  scene_description?: string;
  visual_type?: string;
  shot_type?: string;
  location?: string;
  main_subject?: string;
  main_action?: string;
  support_image_prompt?: string | null;
  support_prompt_history?: PromptRevision[];
  support_candidates?: ImageCandidate[];
  support_selected_candidate_id?: string;
  overlay_required?: boolean;
  overlay_type?: string;
  overlay_note?: string;
}

export interface SceneNarrationAudio {
  name: string;
  mime_type: string;
  path: string;
  duration_sec: number;
}

export interface BackgroundMusic {
  name: string;
  mime_type: string;
  path: string;
}

export interface CharacterProfile {
  age?: string;
  face?: string;
  hair?: string;
  beard?: string;
  clothing?: string;
  mood?: string;
  description: string;
}

export interface VisualAsset {
  prompt: string;
  full_prompt?: string;
  prompt_history: PromptRevision[];
  candidates: ImageCandidate[];
  selected_candidate_id?: string;
  status: CandidateStatus;
}

export interface ProjectData {
  schema_version: 1 | "2.0" | "2.1";
  id: string;
  episode: number;
  person: string;
  category: string;
  folder_name: string;
  project_path: string;
  source_text: string;
  style_guide: string;
  character_profile: CharacterProfile;
  anchor: VisualAsset;
  scenes: Scene[];
  thumbnail: VisualAsset;
  ending_message: string;
  background_music?: BackgroundMusic;
  created_at: string;
  updated_at: string;
  source?: AppDataV2;
  app_state?: {
    selected_character_image?: string;
    selected_scene_images?: Record<string, string>;
    selected_thumbnail?: string;
    warnings?: string[];
  };
}

export interface AppDataV2 {
  schema_version: "2.0" | "2.1";
  person: { name: string; one_line_intro: string; period: string };
  video: { target_duration_sec: number; concept: string };
  core_achievement: { title: string; must_visualize: boolean; scene_id: string; visual_subject: string };
  character_profile: { age: string; face: string; eyes: string; hair: string; beard: string; body: string; outfit: string; impression: string };
  scenes: Array<{
    id: string; order: number; start_sec: number; end_sec: number; narration: string;
    scene_description: string; visual_type: string; shot_type: string; location: string;
    main_subject: string; main_action: string; image_prompt: string;
    support_image_prompt: string | null; subtitle?: string | null; captions?: CaptionBlock[]; motion: string;
    overlay_required?: boolean; overlay_type?: string; overlay_note?: string;
  }>;
  ending: { title: string; message: string };
  thumbnail: { phrases: string[]; prompts: string[]; recommended_index: number };
  youtube: { titles: string[]; recommended_title_index: number; description: string; hashtags: string[] };
}

export interface GenerateRequest {
  project_path: string;
  asset_kind: "anchor" | "scene" | "support" | "thumbnail";
  scene_number?: number;
  prompt: string;
  count: number;
  reference_image?: string;
}
