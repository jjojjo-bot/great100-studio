import type { CharacterProfile, ProjectData, Scene, VisualAsset } from "./types";

export const DEFAULT_STYLE =
  "어린이 역사 교육용 동화 삽화, 현대적이고 따뜻한 그림책형 디지털 일러스트, 지나친 실사 금지, no text, no letters, no watermark, 16:9";

const emptyAsset = (prompt = ""): VisualAsset => ({
  prompt,
  prompt_history: prompt ? [{ prompt, created_at: new Date().toISOString() }] : [],
  candidates: [],
  status: "idle",
});

const valueAfter = (text: string, labels: string[]) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?${label}\\s*[:：]?\\s*([^\\n]+)`, "im"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
};

const sectionAfter = (text: string, labels: string[]) => {
  for (const label of labels) {
    const match = text.match(
      new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${label}\\s*[:：]?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:Scene\\s*\\d+|장면\\s*\\d+|character[_ ]?profile|인물\\s*(?:외형|설정|프로필)|thumbnail|썸네일|ending[_ ]?message|엔딩\\s*메시지)\\s*[:：]?|$)`, "i"),
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
};

const parseProfile = (text: string): CharacterProfile => {
  const block = sectionAfter(text, ["character[_ ]?profile", "인물\\s*(?:외형\\s*기준|설정|프로필)"]);
  const source = block || valueAfter(text, ["character[_ ]?profile", "인물\\s*(?:외형\\s*기준|설정|프로필)"]);
  const field = (labels: string[]) => valueAfter(source, labels);
  return {
    age: field(["age", "나이"]),
    face: field(["face", "얼굴"]),
    hair: field(["hair", "머리", "머리카락"]),
    beard: field(["beard", "수염"]),
    clothing: field(["clothing", "costume", "복장", "의복"]),
    mood: field(["mood", "분위기", "표정"]),
    description: source.replace(/^[-*]\s*/gm, "").trim(),
  };
};

export function parseWorkText(text: string): Pick<ProjectData, "person" | "character_profile" | "scenes" | "thumbnail" | "ending_message"> {
  const person = valueAfter(text, ["person", "인물명", "위인", "주인공"]) || "새 인물";
  const scenePattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:Scene|장면)\s*(\d+)\s*(?:[-—:：.]\s*)?([^\n]*)\n([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:Scene|장면)\s*\d+|\n\s*(?:#{1,6}\s*)?(?:thumbnail|썸네일|ending[_ ]?message|엔딩\s*메시지)\s*[:：]?|$)/gi;
  const scenes: Scene[] = [];
  for (const match of text.matchAll(scenePattern)) {
    const number = Number(match[1]);
    const body = match[3].trim();
    const prompt = valueAfter(body, ["prompt", "이미지\\s*프롬프트", "프롬프트"]) || body;
    const durationRaw = valueAfter(body, ["duration", "시간", "길이"]);
    const title = match[2].replace(/^[-—:：.]\s*/, "").trim() || `장면 ${number}`;
    scenes.push({
      id: `scene-${String(number).padStart(2, "0")}`,
      number,
      title,
      duration: durationRaw ? Number(durationRaw.replace(/[^0-9.]/g, "")) || undefined : undefined,
      caption: valueAfter(body, ["caption", "subtitle", "narration", "자막", "내레이션", "대사"]) || title,
      prompt,
      prompt_history: [{ prompt, created_at: new Date().toISOString() }],
      candidates: [],
      status: "idle",
    });
  }
  const thumbnailPrompt = sectionAfter(text, ["thumbnail", "썸네일(?:\\s*프롬프트)?"]) || valueAfter(text, ["thumbnail", "썸네일(?:\\s*프롬프트)?"]);
  const ending = sectionAfter(text, ["ending[_ ]?message", "엔딩\\s*메시지"]) || valueAfter(text, ["ending[_ ]?message", "엔딩\\s*메시지"]);
  return {
    person,
    character_profile: parseProfile(text),
    scenes,
    thumbnail: emptyAsset(thumbnailPrompt),
    ending_message: ending,
  };
}

export function createProjectDraft(episode: number, person: string, category: string, sourceText: string): ProjectData {
  const parsed = parseWorkText(sourceText);
  const now = new Date().toISOString();
  const cleanPerson = (person || parsed.person || "새 인물").trim();
  const profilePrompt = parsed.character_profile.description || `${cleanPerson}, 역사적 복식, 차분하고 믿음직한 표정`;
  return {
    schema_version: 1,
    id: crypto.randomUUID(),
    episode,
    person: cleanPerson,
    category,
    folder_name: `${String(episode).padStart(3, "0")}_${cleanPerson.replace(/[\\/:*?"<>|]/g, "_")}`,
    project_path: "",
    source_text: sourceText,
    style_guide: DEFAULT_STYLE,
    character_profile: parsed.character_profile,
    anchor: emptyAsset(`${profilePrompt}. 전신 또는 반신 인물 기준 시트, 정면, 단순한 배경, 동일 인물 유지용.`),
    scenes: parsed.scenes,
    thumbnail: parsed.thumbnail,
    ending_message: parsed.ending_message,
    created_at: now,
    updated_at: now,
  };
}
