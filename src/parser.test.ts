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

  it("마크다운 표로 된 Work 제작안에서 프로필과 장면 11개 형식을 읽는다", () => {
    const work = `# 오늘의 인물: 이순신
## 인물 외형 기준
이순신의 **정확한 얼굴은 확인할 수 없으므로** 삽화 기준을 씁니다. 짙은 남색 갑옷과 차분한 눈매.
## 장면별 제작 구성
**공통 이미지 조건:** 모든 프롬프트에 *16:9, 따뜻한 그림책 삽화, no text*를 적용합니다.
| 장면 | 시간 | 해당 내레이션 | 화면 구성과 이미지 생성 프롬프트 |
|---|---:|---|---|
| 1 | 0:00–0:15 | “바다를 어떻게 지킬까요? 함께 준비해 봅시다.” | 작은 판옥선. **프롬프트:** 바다를 바라보는 판옥선 한 척. |
| 2 | 0:15–0:31 | “군사들과 배를 살폈습니다.” | 배를 점검하는 장면. **프롬프트:** 군사들과 갑판을 점검하는 이순신. **보조 이미지:** 배의 도구. |
## 핵심 자막
- 함께 준비하다
## 썸네일 이미지 프롬프트
1. **1안:** 이순신과 판옥선, 글자 없는 이미지.
2. **2안:** 넓은 바다.
**추천 썸네일: 1안.**
## 엔딩 크레딧 — 오늘의 우리가 당신에게
**마지막 화면 메시지:** “함께 바다를 지켰습니다.”`;
    const result = parseWorkText(work);
    expect(result.person).toBe("이순신");
    expect(result.character_profile.description).toContain("짙은 남색 갑옷");
    expect(result.character_profile.description).not.toContain("장면별 제작 구성");
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]).toMatchObject({ number: 1, duration: 15, title: "작은 판옥선", caption: "바다를 어떻게 지킬까요? 함께 준비해 봅시다.", prompt: "바다를 바라보는 판옥선 한 척." });
    expect(result.scenes[1]).toMatchObject({ duration: 16, prompt: "군사들과 갑판을 점검하는 이순신." });
    expect(result.style_guide).toBe("16:9, 따뜻한 그림책 삽화, no text");
    expect(result.thumbnail.prompt).toContain("이순신과 판옥선");
    expect(result.ending_message).toBe("함께 바다를 지켰습니다.");
  });

  it("열 순서와 이름이 다른 장면 표도 읽는다", () => {
    const result = parseWorkText(`인물명: 유관순
| 컷 번호 | 이미지 프롬프트 | 길이 | 자막 |
|---|---|---:|---|
| 1 | 어린 유관순이 친구들과 태극기를 준비하는 그림 | 12초 | 함께 용기를 냈어요. |
| 2 | 마을 사람들이 모인 거리 그림 | 0:12~0:25 | 모두가 함께 외쳤어요. |`);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]).toMatchObject({ number: 1, duration: 12, caption: "함께 용기를 냈어요.", prompt: "어린 유관순이 친구들과 태극기를 준비하는 그림" });
    expect(result.scenes[1].duration).toBe(13);
  });

  it("굵은 글씨 장면 제목과 한글 필드도 읽는다", () => {
    const result = parseWorkText(`오늘의 인물: 세종
**장면 1 — 어린 시절**
**시간:** 8초
**내레이션:** 세종은 글을 좋아했어요.
**이미지 프롬프트:** 책을 읽는 어린 세종.

**Scene 2: 새 글자**
길이: 9초
자막: 모두를 위한 글자를 만들었어요.
프롬프트: 백성들과 이야기하는 세종.

## 썸네일
세종과 책`);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]).toMatchObject({ title: "어린 시절", duration: 8, caption: "세종은 글을 좋아했어요.", prompt: "책을 읽는 어린 세종." });
    expect(result.scenes[1]).toMatchObject({ duration: 9, caption: "모두를 위한 글자를 만들었어요." });
  });

  it("JSON 형식의 제작안도 읽는다", () => {
    const result = parseWorkText(JSON.stringify({ person: "장영실", character_profile: { age: "40대", clothing: "조선 관복" },
      scenes: [{ scene: 1, title: "발명", duration: 10, narration: "새로운 도구를 만들었어요.", image_prompt: "조선의 공방에서 도구를 만드는 장영실" }],
      thumbnail: { prompt: "장영실과 해시계" }, ending_message: "호기심을 잊지 마세요." }));
    expect(result.person).toBe("장영실");
    expect(result.character_profile.description).toContain("조선 관복");
    expect(result.scenes[0]).toMatchObject({ title: "발명", caption: "새로운 도구를 만들었어요.", prompt: "조선의 공방에서 도구를 만드는 장영실" });
    expect(result.thumbnail.prompt).toBe("장영실과 해시계");
  });
});
