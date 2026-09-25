import { describe, expect, it } from "vitest";
import { createProjectDraft, parseWorkText } from "./parser";
import { SAMPLE_WORK_TEXT } from "./sample";

describe("Work 제작안 파서", () => {
  it("인물, 프로필, 장면, 썸네일, 엔딩을 추출한다", () => {
    const result = parseWorkText(SAMPLE_WORK_TEXT);
    expect(result.person).toBe("이순신");
    expect(result.character_profile.description).toContain("40대 후반");
    expect(result.character_profile.description).toContain("조선 수군 장군");
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[1].title).toContain("거북선");
    expect(result.scenes[2].duration).toBe(15);
    expect(result.thumbnail.prompt).toContain("거북선");
    expect(result.ending_message).toContain("용기");
  });

  it("안전한 표준 프로젝트 폴더명을 만든다", () => {
    const draft = createProjectDraft(7, "세종/대왕", "과학 · 발명", SAMPLE_WORK_TEXT);
    expect(draft.folder_name).toBe("007_세종_대왕");
    expect(draft.style_guide).toContain("16:9");
  });

  it("Work 제작안의 자막 문구를 장면 자막으로 가져온다", () => {
    const result = parseWorkText("인물명: 세종\nScene 1 - 글자를 만들다\n자막: 누구나 쉽게 읽는 글자를 꿈꿨어요.\n프롬프트: 책상에서 연구하는 세종");
    expect(result.scenes[0].caption).toBe("누구나 쉽게 읽는 글자를 꿈꿨어요.");
  });
});
