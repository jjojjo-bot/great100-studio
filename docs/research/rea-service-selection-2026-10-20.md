# Great100 Studio의 REA 분석 대상 선정 조사

2026년 10월 20일 기준. Great100 소스 기준 커밋은 `c0db0cfdb372549333f3d599232ffecca1907a3c`이다.

**REA로 먼저 분석할 서비스는 Vrew를 권한다.** 한국어 내레이션과 자막, 장면 편집이라는 활용 목적이 겹치고, 공개 웹 체험판의 편집 코드 일부를 실제로 확보해 REA 정적 분석까지 확인했다. **Great100과 제작 흐름이 가장 닮은 서비스는 Mootion**이다. 따라서 편집 구조는 Vrew에서 먼저 분석하고, 인물 기준 이미지와 장면별 생성·검토 흐름은 Mootion을 참고하는 순서가 적합하다. 이 우선순위는 기능 적합성과 이번 환경에서 확보한 분석 자료를 함께 고려한 판단이다.

Great100은 역사 인물의 교육 영상을 제작하는 도구다. 특히 구조화된 제작안, 인물 외형의 일관성, 장면별 이미지 검토를 중심에 둔다. 후보 서비스의 범용 기능 수보다 이 제작 과정에 얼마나 직접적인 도움이 되는지를 기준으로 비교했다.

| Great100의 기능 | 코드에서 확인한 현재 동작 | 비교에 주는 의미 |
| --- | --- | --- |
| 제작안 가져오기 | Work 제작안의 JSON·마크다운·장면 문구를 파싱하고 APP_DATA 2.0·2.1을 검증한다. | 일반 영상 편집기보다 대본을 장면으로 바꾸는 서비스를 우선한다. |
| 역사·교육 영상 구성 | 권장 장면 수는 14~18개, 본문 시간은 270~300초다. 핵심 업적의 장면 연결과 화면 구도의 다양성을 점검한다. | 여러 장면으로 이어지는 설명형 콘텐츠가 비교 기준이다. |
| 인물 기준 이미지 | 외형 프로필과 기준 이미지 후보를 보유하고 장면 프롬프트에 인물·구도·스타일 지시를 합친다. | 인물 참조와 장면 구도를 각각 관리하는 방식을 살펴볼 가치가 크다. |
| 장면의 이미지와 영상 | 이미지 후보 생성·업로드·선택, 짧은 MP4 업로드, 보조 이미지 전환을 지원한다. | 생성 결과를 장면 단위로 검토하고 교체하는 편집 과정이 중요하다. |
| 자막과 시간 | 의미 단위 자막, 강조 자막, 드래그 시간 조절, 녹음 파형과 장면 시간축을 제공한다. | 문장·음성·영상의 시간 관계를 편집 데이터로 다루는 서비스가 유용하다. |
| 내레이션과 음악 | 마이크 녹음 또는 오디오 업로드, 배경음악과 장면별 볼륨을 지원한다. | 자동 음성 생성과 실제 음성 길이에 맞춘 시간 조정이 확장 지점이다. |
| 출력 | 브라우저 Canvas와 Mediabunny로 1280×720, 15fps, H.264 MP4를 생성한다. ZIP에 편집 정보와 원본을 보관한다. | 편집 데이터와 미리보기·출력이 같은 결과를 내는 구조를 참고할 수 있다. |
| 저장 | 웹은 Supabase·R2 또는 IndexedDB, Tauri는 로컬 프로젝트 폴더를 사용한다. 계정 저장 시 버전 충돌을 처리한다. | 자동 저장과 편집 복구가 관련 비교 항목이다. |

구현 근거: [제작 단계와 편집 화면](../../src/App.tsx), [프로젝트 데이터 구조](../../src/types.ts), [제작안 품질 검사](../../src/app-data.ts), [프롬프트 구성](../../src/prompts.ts), [녹음·업로드](../../src/SceneNarrationPanel.tsx), [렌더러](../../src/video.ts), [저장·ZIP](../../src/platform.ts).

Great100의 현재 내레이션 경로는 녹음·업로드 중심이다. 내장 TTS나 음성 인식에 의한 자막 정렬 경로는 검토한 `src`·`api` 코드에서 확인되지 않았다. 또한 `useStepHistory`는 화면 이동 기록이며 편집 내용을 되돌리는 실행 취소 이력은 아니다. 따라서 Vrew를 분석할 때는 음성 모델 자체보다 문장과 자막의 시간 모델, 편집 명령, 실행 취소를 우선하는 편이 실용적이다.

인물 일관성에는 바로 확인할 항목도 있다. [App.tsx](../../src/App.tsx)의 장면 생성 요청은 선택한 기준 이미지의 `mode`가 `openai`일 때만 `reference_image`를 전달한다. 썸네일 생성도 같은 조건을 쓴다. 업로드한 기준 이미지는 외형 프롬프트와 별개로 이 요청의 이미지 참조에 들어가지 않는다. 인물 참조를 강화할 때 이 조건과 업로드 이미지의 전달 형식을 먼저 검토해야 한다.

아래 우선순위는 전체 서비스의 품질 순위가 아니라 **Great100을 개선하기 위한 분석 순서**다. Vrew 외 서비스의 REA 경로는 후속 분석 계획이며, 편집 번들을 분석했다고 표시한 것은 Vrew뿐이다.

| 우선순위 | 서비스 | Great100과의 관련성 | 가장 유용한 참고 항목 | 이번에 확인한 분석 접근성 |
| --- | --- | --- | --- | --- |
| 1 | Vrew | 한국어 대본·자막·내레이션 편집과 높은 관련성 | 문장 편집, 클립 구조, 자막 시간, 실행 취소, 이미지 움직임 | 공개 체험판 JS 3개 확보·REA 파싱 완료 |
| 2 | Mootion | 인물 참조부터 장면 검토·썸네일·자료 내보내기까지 가장 가까운 제작 흐름 | 인물·장면 참조 분리, 장면별 재생성, 일괄 생성과 검토 | 웹앱 존재 확인. 로컬 TLS 오류로 편집 번들 확보는 미완료 |
| 3 | Fliki | 대본을 내레이션·장면·자막이 있는 완성 영상으로 연결 | 음성 길이에 맞춘 장면·자막 구성 | 공개 진입 HTML 확보. 인증 후 편집 코드와 런타임은 미분석 |
| 4 | LTX Studio | 인물 일관성·구도·스토리보드에 높은 관련성 | 인물·사물·장소 요소, 샷 단위 지시, 후보 관리 | 웹 제품임을 공식 확인. 이번에 받은 사이트 자료는 소개 페이지 |
| 5 | Pictory | 대본 파싱과 장면별 편집에 높은 관련성 | 문장·줄바꿈 기반 장면 분리, 자료 교체, 템플릿 | 공식 가이드 중심. 편집 번들은 미분석 |
| 6 | Typecast | 한국어 음성 중심 제작을 확장할 때 관련성 | 음성·영상 동시 편집, 자동 자막, 여러 화자 | 웹 편집기 기능을 공식 확인. 편집 번들은 미분석 |
| 7 | Invideo | 전체 제작 자동화와 인물·장소 관리에 관련성 | 프로젝트 공통 설정 유지, 승인한 후보를 편집으로 연결 | 공식 기능 자료 중심. 에이전트 내부 구현과 편집 번들은 미분석 |

서비스 기능 근거: [Vrew 텍스트 편집](https://vrew.ai/ko/feature/text-based-video-editing/), [Mootion 인물 참조 제작 과정](https://mootion.com/ugc/en/use-case/ai-video-character-consistency-workflow), [Fliki 스토리 영상](https://fliki.ai/features/ai-story-video-generator), [LTX Studio](https://ltx.io/studio), [Pictory 제작 가이드](https://pictory.ai/academy/how-to-turn-script-into-video-pictory-ai), [Typecast 영상 편집](https://typecast.ai/create/faceless-video/), [Invideo Slate](https://invideo.io/news/introducing-slate-invideo-agent-two/).

**Vrew의 첫 분석 범위는 자막·클립·편집 이력으로 좁히는 것이 좋다.** 공식 기능은 텍스트 수정으로 영상을 편집하고, 주제로 대본·시각 자료·AI 음성을 만드는 흐름을 제공한다. Great100의 기존 제작안과 장면 구조에 이를 연결하면, 한 문장을 수정한 뒤 자막·음성·영상 길이를 각각 수동으로 고치는 부담을 줄일 수 있다. 이 효과는 구현 방향에 대한 판단이며 실제 작업 시간은 측정하지 않았다. [Vrew 텍스트 편집](https://vrew.ai/ko/feature/text-based-video-editing/), [텍스트로 영상 만들기](https://vrew.ai/ko/feature/text-to-video/).

Vrew는 [공식 웹 체험판](https://vrew.ai/try/index.html)이 있고, [공식 홈페이지](https://vrew.ai/ko/)는 Mac·Windows·Ubuntu 지원을 안내한다. 이번 분석은 웹 체험판의 공개 JavaScript만 대상으로 삼았다. 데스크톱 설치 파일의 내부 구조나 ASAR 포함 여부는 아직 확인하지 않았다.

확보한 3개 파일의 합계는 **6,337,884바이트**다. REA `analyze_javascript_application`은 3개 모두를 파싱했고 파싱 실패는 0개였다. 후속 조회에서는 `resolveWaveformMediaSource`의 export와 소스 위치를 확인했다. 메인 번들의 직접 정적 확인에서는 `mergeClips`, `undoAction`, `redoAction`, `TextToVideo.tsx`, `kenburnsAnimationInfo` 참조가 확인됐다. 이들은 다음 분석의 진입점이며 해당 기능의 현재 UI 노출이나 실행 결과를 증명하지는 않는다.

| 확보 파일 | 크기 | 후속 분석에 사용할 진입점 |
| --- | ---: | --- |
| `index-Dfn3gLwO.js` | 3,955,538바이트 | 편집 명령 연결, 영상 제작 화면, 이미지 움직임 관련 참조 |
| `scene-BoVf8rK7.js` | 2,382,045바이트 | 장면·자막·자료와 관련된 코드 및 export |
| `waveformSource-CxJD4f4E.js` | 301바이트 | 파형에 사용할 미디어 소스의 선택 함수 |

분석 범위는 이 세 파일로 한정된다. 가져오지 않은 vendor·언어 자료·추가 청크의 의존성은 미해결이고, 의미 관계 분석은 파일당 노드 4,000개 등의 조사 한도로 일부 생략됐다. 전체 애플리케이션·의미 그래프의 coverage는 `partial`이다. 선언된 메인 source map 주소는 HTTP 200으로 HTML을 반환하여 원본 소스 복구에는 사용하지 못했다. 실제 편집과 출력 동작은 별도 런타임 관찰이 필요하다.

REA 부모 Evidence ID는 `ev_f67eb1008c8b5787bdedbb23453173aa9a1657920e4efab437453ec6d18c94bd`다. 파일별 URL·SHA-256·소스 위치·분석 한도는 [검증 기록](rea-service-evidence-2026-10-20.json)에 보관했다. 원본 JS와 전체 Evidence 번들은 `/tmp/great100-service-research/`에 있다. 이 임시 경로는 장기 보관을 보장하지 않는다.

**Mootion은 Great100의 제작 단계를 다듬을 때 가장 직접적인 비교 대상이다.** 공식 안내에는 대본·이미지·클립을 ZIP으로 내려받는 기능, 썸네일, 교육·역사·인물 이야기, 한국어 출력이 있다. Great100의 장면 검토와 최종 자료 보관 방식에 겹치는 부분이 많다. [Mootion 공식 기능과 FAQ](https://www.mootion.com/).

현재 안내하는 Director Mode는 인물 목록과 참조 이미지를 먼저 정하고, 장면 참조와 촬영 지시를 붙인 뒤 이미지를 일괄 생성하고 클립을 만드는 흐름이다. Great100의 `character_profile`, `shot_type`, `location`, `main_action`을 확장할 때 참고하기 좋다. 얼굴 참조, 장면 구도, 움직임 참조를 독립적으로 관리하고 인접 장면을 함께 검토하는 방식이 특히 유용하다. [Mootion 인물 일관성 가이드](https://mootion.com/ugc/en/use-case/ai-video-character-consistency-workflow).

2024년 공식 튜토리얼에는 장면 분할·병합, 이미지 재생성, 이미지의 영상화, 자막·음악·썸네일 설정이 구체적으로 설명되어 있다. 해당 화면과 과거 크레딧 수치는 현재 UI·요금으로 취급하지 않는다. 최신 편집 화면의 비교 기준은 현재 웹앱과 Director Mode로 잡아야 한다. [기존 장면 편집 안내](https://www.mootion.com/tutorial/how-to-edit-your-video-in-mootion.html), [기존 제작 단계 안내](https://www.mootion.com/tutorial/quick-start.html).

Mootion은 현재 무료 생성 플랜이 없고, 월 결제 Standard는 **월 15달러·1,500크레딧**으로 안내한다. 실제 생성·내보내기 관찰에는 계정과 유료 사용 범위가 필요하다. 이번에는 로그인이나 결제를 진행하지 않았다. 공개 웹앱의 HTML은 웹 조회에서 확인됐지만 로컬 urllib와 curl은 모두 TLS 오류를 반환했으므로, 이를 서비스 전체의 접속 장애나 분석 불가로 일반화할 수는 없다. [현재 요금](https://www.mootion.com/pricing.html), [웹앱](https://storyteller.mootion.com/).

**Fliki는 내레이션 자동화의 비교 대상으로 남겨두는 것이 좋다.** 공식 과정은 대본을 장면으로 나누고 각 장면에 자료를 붙이며, 이어지는 내레이션과 그 음성에 맞는 자막을 만든다. Great100에서 TTS를 추가할 때 음성 생성 이후의 자막·장면 재배치를 설계하는 데 도움이 된다. 무료 범위는 월 3크레딧과 워터마크가 있는 720p 출력으로 안내하므로 작은 표본의 동작 비교가 가능하다. 생성 모델과 번역 등 유료 기능은 별도다. [Fliki 스토리 영상](https://fliki.ai/features/ai-story-video-generator). 공개 진입 HTML은 확보했지만 실제 편집기 자료 모델은 분석하지 않았다.

LTX Studio는 인물·사물·장소를 재사용하는 Elements와 카메라·키프레임·참조 이미지, 스토리보드·타임라인을 연결한다. Great100에서 같은 역사 인물의 연령대·의상·장소를 관리하거나 장면별 구도를 정교하게 만들 때 참고할 수 있다. 현재 한국어 자막 편집의 우선 과제보다 제작 범위가 넓어 보조 대상으로 둔다. LTX Studio 웹 제품과 별도 LTX Desktop·공개 모델은 구분해야 한다. [LTX 공식 제품 안내](https://ltx.io/studio).

Pictory는 문장 또는 줄바꿈으로 장면을 나누고 Story·Visuals·Audio 등에서 수정하는 과정이 잘 문서화되어 있다. Great100의 파싱 확인에서 장면 편집으로 넘어가는 흐름을 단순화할 때 유용하다. Typecast는 음성·영상 동시 편집, 자동 자막, 여러 화자와 외부 자료를 사용하는 과정을 참고하기 좋다. 두 서비스의 실제 편집 내부 구조는 후속 조사 범위다. [Pictory 제작 가이드](https://pictory.ai/academy/how-to-turn-script-into-video-pictory-ai), [Typecast 영상 제작](https://typecast.ai/create/faceless-video/).

Invideo의 최신 Slate 안내는 프로젝트의 대본·샷·승인한 후보를 유지하면서 편집으로 연결하는 흐름을 강조한다. 회차가 늘어나는 Great100에서 인물과 스타일의 공통 설정을 재사용하는 참고 사례가 된다. 다만 전체 제작 에이전트의 내부 구현은 웹 클라이언트만으로 확인하기 어려우므로 첫 역공학 목표로는 범위가 크다. [Invideo Slate 소개](https://invideo.io/news/introducing-slate-invideo-agent-two/).

Great100에 적용할 항목은 다음 순서로 권한다. 각 항목은 서비스의 구현을 복사하는 작업이 아니라 관찰한 동작과 데이터 관계를 Great100의 구조로 설계하는 작업이다.

| 순서 | 개선 항목 | 비교 대상과 구체적인 조사 질문 | Great100의 관련 위치 |
| --- | --- | --- | --- |
| 1 | 업로드한 인물 기준 이미지의 참조 전달 | Mootion의 인물·구도 참조 구분을 참고해 얼굴 일관성과 장면 구도를 각각 유지할 수 있는가? | `App.tsx`, `prompts.ts`, `api/generate.ts` |
| 2 | 편집 내용의 실행 취소·다시 실행 | Vrew에서 자막 시간 이동, 문구 변경, 후보 선택이 어떤 편집 명령으로 묶이는가? | `App.tsx`, `project-changes.ts`, `CaptionWaveform.tsx` |
| 3 | 내레이션·자막·장면 시간의 연동 | Vrew·Fliki에서 문장 수정 또는 음성 길이 변경이 다음 자막과 장면 길이에 어떻게 반영되는가? | `types.ts`, `SceneNarrationPanel.tsx`, `video.ts` |
| 4 | 장면 분할·병합·순서 변경 | 자막, 자료, 녹음과 장면 식별자를 어떤 규칙으로 재배치하는가? | `types.ts`, `app-data.ts`, `SceneTimeline.tsx` |
| 5 | 전체 장면 후보 검토와 일괄 생성 | Mootion처럼 인물 참조를 확정한 뒤 필요한 장면만 생성·재시도하도록 구성할 수 있는가? | `SceneStudio`, `platform.ts`, `candidates.ts` |
| 6 | 인물·장소·스타일을 회차 사이에 재사용 | Mootion·LTX처럼 공통 참조와 장면 지시를 구분할 수 있는가? | `ProjectData`, `CharacterProfile`, `cloud.ts` |

Vrew 후속 분석의 첫 산출물은 자막·클립의 데이터 필드와 편집 명령 연결표로 잡는다. 이어서 같은 짧은 예제에서 자막 문구 변경, 경계 이동, 클립 분할·병합, 실행 취소를 관찰하고, 정적 코드의 후보 경로와 일치하는지 확인한다. 여기서 얻은 동작 규칙을 바탕으로 Great100의 편집 이력과 시간 모델을 설계할 수 있다. Mootion은 인물 참조와 장면 재생성의 흐름을 확인하는 다음 대상으로 둔다.

현재 REA의 JavaScript 정적 분석은 사용할 수 있으며 이번 표본에서도 작동했다. Ghidra·Hopper 등 네이티브 분석 엔진은 미설정이지만 이 웹 JavaScript 경로에는 필요하지 않다. 서버에서만 실행되는 프롬프트 구성, TTS·영상 생성 모델, 학습 가중치와 작업 스케줄러는 이번 자료로 복원되지 않는다. 웹 체험판의 코드가 데스크톱 앱 전체와 같다는 결론도 내리지 않는다.
