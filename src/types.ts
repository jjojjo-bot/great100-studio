export type CandidateStatus = "idle" | "generating" | "ready" | "error";
export type ImageMotion = "auto" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "none";

export interface PromptRevision {
  prompt: string;
  created_at: string;
}

export interface ImageCandidate {
  id: string;
  path: string;
  preview_url: string;
  created_at: string;
  mode: "mock" | "openai" | "uploaded";
}

export interface Scene {
  id: string;
  number: number;
  title: string;
  duration?: number;
  caption?: string;
  motion?: ImageMotion;
  prompt: string;
  full_prompt?: string;
  prompt_history: PromptRevision[];
  candidates: ImageCandidate[];
  selected_candidate_id?: string;
  status: CandidateStatus;
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
  schema_version: 1;
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
  created_at: string;
  updated_at: string;
}

export interface GenerateRequest {
  project_path: string;
  asset_kind: "anchor" | "scene" | "thumbnail";
  scene_number?: number;
  prompt: string;
  count: number;
  reference_image?: string;
}
