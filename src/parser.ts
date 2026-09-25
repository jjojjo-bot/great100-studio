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

const markdownSection = (text: string, heading: RegExp) => {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    return match ? heading.test(match[1].replace(/\*\*/g, "").trim()) : false;
  });
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^\s*#{1,6}\s+/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
};

const cleanInline = (text: string) => text.replace(/\*\*/g, "").replace(/^\s*[“"']|[”"']\s*$/g, "").trim();

const timecodeSeconds = (text: string) => {
  const parts = text.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const tableDuration = (text: string) => {
  const range = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[–—~～-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (range) return timecodeSeconds(range[2]) - timecodeSeconds(range[1]);
  const seconds = text.match(/(?:약\s*)?(\d+(?:\.\d+)?)\s*(?:초|seconds?|sec\b)/i);
  return seconds ? Number(seconds[1]) : /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : undefined;
};

const parseSceneTable = (text: string): Scene[] => {
  const lines = text.split(/\r?\n/);
  const cellsOf = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const headerIndex = lines.findIndex((row) => {
    if (!/^\s*\|/.test(row)) return false;
    const headers = cellsOf(row).map((cell) => cleanInline(cell).toLowerCase());
    return headers.some((cell) => /^(?:장면|씬|scene|번호|순서|컷|no\.?)(?:\s|$)/i.test(cell)) && headers.some((cell) => /프롬프트|이미지|화면|구성/.test(cell));
  });
  if (headerIndex < 0) return [];
  const headers = cellsOf(lines[headerIndex]).map((cell) => cleanInline(cell).toLowerCase());
  const column = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const numberColumn = column(/^(?:장면|씬|scene|번호|순서|컷|no\.?)(?:\s|$)/i);
  const timeColumn = column(/시간|길이|duration|time|초/);
  const captionColumn = column(/내레이션|나레이션|대본|자막|음성|설명/);
  const promptColumn = headers.findIndex((header, index) => index !== numberColumn && /프롬프트|이미지|화면|구성|컷/.test(header));
  const titleColumn = column(/제목|장면명|씬명/);
  const scenes: Scene[] = [];
  for (const row of lines.slice(headerIndex + 1)) {
    if (!/^\s*\|/.test(row)) break;
    const cells = cellsOf(row);
    const numberMatch = cleanInline(cells[numberColumn] || "").match(/^(?:(?:scene|장면|씬)\s*)?0*(\d+)(?:\s*[.:-].*)?$/i);
    if (!numberMatch) continue;
    const number = Number(numberMatch[1]);
    const visual = cells[promptColumn] || "";
    const promptMatch = visual.match(/(?:\*\*)?(?:이미지\s*)?프롬프트\s*[:：](?:\*\*)?\s*([\s\S]*?)(?=\s*(?:\*\*)?보조\s*이미지\s*[:：]|$)/i);
    const prompt = cleanInline(promptMatch?.[1] || visual);
    const lead = cleanInline(visual.split(/(?:\*\*)?(?:이미지\s*)?프롬프트\s*[:：]/i)[0]).replace(/[.!。]\s*$/, "");
    const title = cleanInline(cells[titleColumn] || "") || (promptMatch ? lead : "") || `장면 ${number}`;
    const caption = cleanInline(cells[captionColumn] || "") || title;
    const duration = tableDuration(cells[timeColumn] || "");
    scenes.push({ id: `scene-${String(number).padStart(2, "0")}`, number, title,
      duration: duration && duration > 0 ? duration : undefined, caption, prompt,
      prompt_history: prompt ? [{ prompt, created_at: new Date().toISOString() }] : [],
      candidates: [], status: "idle" });
  }
  return scenes;
};

const thumbnailPromptFromMarkdown = (text: string) => {
  const section = markdownSection(text, /^썸네일.*프롬프트/);
  if (!section) return "";
  const recommended = section.match(/추천\s*썸네일\s*[:：]\s*(\d+)안/);
  const options = [...section.matchAll(/^\s*\d+\.\s*\*\*(\d+)안\s*[:：]\*\*\s*(.+)$/gm)];
  const choice = options.find((match) => match[1] === recommended?.[1]) || options[0];
  return cleanInline(choice?.[2] || section.split("\n")[0]);
};

const endingFromMarkdown = (text: string) => {
  const section = markdownSection(text, /^엔딩(?:\s*크레딧|\s*메시지)/);
  const match = section.match(/(?:\*\*)?마지막\s*화면\s*메시지\s*[:：](?:\*\*)?\s*(.+)/);
  return cleanInline(match?.[1] || "");
};

const sceneField = (text: string, labels: string[]) => {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${labels.join("|")})\\s*[:：](?:\\*\\*)?\\s*([^\\n]+)`, "im"));
  return cleanInline(match?.[1] || "");
};

const parseSceneHeadings = (text: string): Scene[] => {
  const lines = text.split(/\r?\n/);
  const heading = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:(?:scene|장면|씬)\s*#?\s*(\d+)|(?:(\d+)\s*[.)-]\s*(?:scene|장면|씬)))\s*(?:[-—:：.|]\s*)?([^\n]*?)(?:\*\*)?\s*$/i;
  const scenes: Scene[] = [];
  let current: { number: number; title: string; body: string[] } | null = null;
  const finish = () => {
    if (!current) return;
    const body = current.body.join("\n").trim();
    const prompt = sceneField(body, ["image[_ ]?prompt", "이미지\\s*프롬프트", "prompt", "프롬프트"]) || body;
    const caption = sceneField(body, ["narration", "caption", "subtitle", "내레이션", "나레이션", "자막", "대사", "대본"]) || current.title;
    const durationText = sceneField(body, ["duration", "시간", "길이"]);
    const duration = tableDuration(durationText);
    scenes.push({ id: `scene-${String(current.number).padStart(2, "0")}`, number: current.number,
      title: current.title || `장면 ${current.number}`, duration: duration && duration > 0 ? duration : undefined,
      caption, prompt, prompt_history: prompt ? [{ prompt, created_at: new Date().toISOString() }] : [],
      candidates: [], status: "idle" });
    current = null;
  };
  for (const line of lines) {
    const match = line.match(heading);
    if (match) {
      finish();
      current = { number: Number(match[1] || match[2]), title: cleanInline(match[3] || ""), body: [] };
    } else if (current && /^\s*#{1,2}\s+/.test(line)) {
      finish();
    } else if (current) current.body.push(line);
  }
  finish();
  return scenes;
};

const parseJsonPlan = (text: string): ReturnType<typeof parseWorkText> | null => {
  const source = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)?.[1] || text.trim();
  if (!source.startsWith("{")) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(source); } catch { return null; }
  if (!Array.isArray(data.scenes)) return null;
  const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const profileRaw = data.character_profile ?? data.characterProfile;
  const profileRecord = profileRaw && typeof profileRaw === "object" ? profileRaw as Record<string, unknown> : {};
  const profile = string(profileRaw) || string(profileRecord.description) || Object.entries(profileRecord).map(([key, value]) => `${key}: ${string(value)}`).filter((entry) => !entry.endsWith(": ")).join("\n");
  const thumbnailRaw = data.thumbnail ?? data.thumbnail_prompt;
  const thumbnailRecord = thumbnailRaw && typeof thumbnailRaw === "object" ? thumbnailRaw as Record<string, unknown> : {};
  const scenes: Scene[] = data.scenes.map((value, index) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const number = Number(item.scene ?? item.number ?? index + 1) || index + 1;
    const title = string(item.title ?? item.scene_title) || `장면 ${number}`;
    const prompt = string(item.prompt ?? item.image_prompt ?? item.imagePrompt);
    const caption = string(item.caption ?? item.narration ?? item.subtitle ?? item.script) || title;
    const durationValue = item.duration ?? item.seconds ?? item.time;
    const duration = typeof durationValue === "number" ? durationValue : tableDuration(string(durationValue));
    return { id: `scene-${String(number).padStart(2, "0")}`, number, title,
      duration: duration && duration > 0 ? duration : undefined, caption, prompt,
      prompt_history: prompt ? [{ prompt, created_at: new Date().toISOString() }] : [], candidates: [], status: "idle" as const };
  });
  return { person: string(data.person ?? data.name) || "새 인물", character_profile: { description: profile },
    scenes, thumbnail: emptyAsset(string(thumbnailRaw) || string(thumbnailRecord.prompt)),
    ending_message: string(data.ending_message ?? data.endingMessage),
    style_guide: string(data.style_guide ?? data.style) || DEFAULT_STYLE };
};

const parseProfile = (text: string): CharacterProfile => {
  const block = markdownSection(text, /^인물\s*(?:외형|설정|프로필|캐릭터)/i) || sectionAfter(text, ["character[_ ]?profile", "인물\\s*(?:외형\\s*기준|설정|프로필)"]);
  const source = block || valueAfter(text, ["character[_ ]?profile", "인물\\s*(?:외형\\s*기준|설정|프로필)"]);
  const field = (labels: string[]) => valueAfter(source, labels);
  return {
    age: field(["age", "나이"]),
    face: field(["face", "얼굴"]),
    hair: field(["hair", "머리", "머리카락"]),
    beard: field(["beard", "수염"]),
    clothing: field(["clothing", "costume", "복장", "의복"]),
    mood: field(["mood", "분위기", "표정"]),
    description: source.replace(/^[-*]\s*/gm, "").replace(/\*\*/g, "").trim(),
  };
};

export function parseWorkText(text: string): Pick<ProjectData, "person" | "character_profile" | "scenes" | "thumbnail" | "ending_message" | "style_guide"> {
  const jsonPlan = parseJsonPlan(text);
  if (jsonPlan) return jsonPlan;
  const person = valueAfter(text, ["person", "인물명", "오늘의\\s*인물", "위인", "주인공"]) || "새 인물";
  const tableScenes = parseSceneTable(text);
  const scenes = tableScenes.length ? tableScenes : parseSceneHeadings(text);
  const thumbnailPrompt = thumbnailPromptFromMarkdown(text) || sectionAfter(text, ["thumbnail", "썸네일(?:\\s*프롬프트)?"]) || valueAfter(text, ["thumbnail", "썸네일(?:\\s*프롬프트)?"]);
  const ending = endingFromMarkdown(text) || sectionAfter(text, ["ending[_ ]?message", "엔딩\\s*메시지"]) || valueAfter(text, ["ending[_ ]?message", "엔딩\\s*메시지"]);
  const commonStyle = sceneField(text, ["공통\\s*이미지\\s*조건", "스타일\\s*가이드"]);
  const styleGuide = commonStyle
    ? cleanInline(commonStyle).replace(/^모든\s*프롬프트에\s*\*/, "").replace(/\*를\s*적용합니다\.?$/, "").trim()
    : DEFAULT_STYLE;
  return {
    person,
    character_profile: parseProfile(text),
    scenes,
    thumbnail: emptyAsset(thumbnailPrompt),
    ending_message: ending,
    style_guide: styleGuide,
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
    style_guide: parsed.style_guide,
    character_profile: parsed.character_profile,
    anchor: emptyAsset(`${profilePrompt}. 전신 또는 반신 인물 기준 시트, 정면, 단순한 배경, 동일 인물 유지용.`),
    scenes: parsed.scenes,
    thumbnail: parsed.thumbnail,
    ending_message: parsed.ending_message,
    created_at: now,
    updated_at: now,
  };
}
