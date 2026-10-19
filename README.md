# Great100 Studio

‘한국을 빛낸 100인’ 영상 제작을 위한 React + TypeScript 스튜디오입니다. 웹앱으로 사용할 수 있고, Tauri 데스크톱 앱도 포함합니다.

## 로컬 웹 실행

Node.js 22 이상을 사용합니다.

```bash
npm install
npm run dev
```

## Google 로그인 설정

웹앱 로그인은 Supabase Auth의 Google 로그인을 사용합니다. 로그인 상태는 브라우저에 유지되고, 세션 갱신과 다른 탭의 로그아웃이 화면에 반영됩니다. 로그아웃은 현재 브라우저에만 적용되므로 다른 PC의 로그인은 유지됩니다.

웹앱의 프로젝트·편집 정보는 **Supabase PostgreSQL**, 이미지·동영상·녹음·완성 MP4는 **Cloudflare R2**에 계정별로 저장합니다. 아래 DB/R2 설정까지 마치면 다른 PC에서 같은 Google 계정으로 작업을 열 수 있습니다. 데스크톱 앱은 기존 로컬 작업 모드를 사용합니다.

### 1. Supabase 프로젝트 만들기

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 새 프로젝트를 만듭니다.
2. 프로젝트의 연결 정보에서 **Project URL**과 **publishable key**를 확인합니다. `sb_publishable_`로 시작하는 공개 키이며, 브라우저에서 사용해도 되는 값입니다.
3. 저장소 루트의 `.env.example`을 `.env.local`로 복사하고 다음 두 값을 입력합니다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

`secret` 또는 `service_role` 키와 DB 비밀번호는 이 파일에 넣지 마세요. `.env.local`은 Git에서 제외됩니다. 환경변수를 바꿨으면 개발 서버를 다시 시작합니다.

### 2. Google 로그인 제공자 설정

1. Supabase의 **Authentication → Sign In / Providers → Google**에서 Google 로그인을 활성화하고 표시된 **Callback URL**을 복사합니다. 보통 `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`입니다.
2. [Google Auth Platform](https://console.cloud.google.com/auth/overview)에서 프로젝트를 선택하거나 새로 만들고 앱 이름·지원 이메일·대상을 설정합니다. 테스트 상태로 사용할 경우 로그인할 Google 계정을 테스트 사용자에 추가합니다.
3. **Clients**에서 **Web application** 유형의 OAuth 클라이언트를 만듭니다.
4. **Authorized JavaScript origins**에 운영 주소 `https://great100-studio.vercel.app`을 추가합니다. 로컬 개발용으로 `http://localhost:1420`과 `http://127.0.0.1:1420`도 추가할 수 있습니다. 이 항목은 경로나 끝의 `/`가 없는 출처 주소입니다.
5. **Authorized redirect URIs**에 1번에서 복사한 **Supabase Callback URL**을 등록합니다. 이 항목에는 웹앱 주소가 아닌 Supabase 콜백 주소가 들어갑니다.
6. 발급받은 Google **Client ID**와 **Client Secret**을 Supabase의 Google 제공자 설정에 입력하고 저장합니다. Client Secret은 프런트엔드 환경변수에 넣지 않습니다.
7. Google의 기본 사용자 정보 권한인 `openid`, `userinfo.email`, `userinfo.profile`을 사용합니다. 드라이브 등 추가 권한은 필요하지 않습니다.

### 3. 앱으로 돌아올 주소 설정

Supabase의 **Authentication → URL Configuration**에서 다음을 설정합니다.

| 항목 | 등록할 주소 |
| --- | --- |
| Site URL | `https://great100-studio.vercel.app/` |
| Redirect URLs · 운영 | `https://great100-studio.vercel.app/` |
| Redirect URLs · 로컬 개발 | `http://localhost:1420/`, `http://127.0.0.1:1420/` |

이 앱은 로그인 후 루트 주소(`/`)로 돌아와 SDK가 PKCE 인증 코드를 세션으로 교환합니다. 별도 `/auth/callback` 페이지는 필요하지 않습니다. 위의 **Supabase Callback URL**과 **웹앱으로 돌아올 주소**는 서로 다른 설정입니다.

로그인 후 돌아올 주소는 현재 접속한 출처와 앱의 기본 경로에서 계산합니다. 운영 사이트에서 시작한 로그인은 `https://great100-studio.vercel.app/`로, 로컬에서 시작한 로그인은 해당 로컬 주소로 돌아옵니다.

Vercel 프로젝트의 **Settings → Environment Variables**에 다음 두 값을 `.env.local`과 동일하게 등록합니다. 운영 배포에 적용되도록 **Production** 환경을 포함합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

등록 후 로그인 코드가 포함된 버전을 새로 빌드·배포합니다. Vite는 빌드 시 환경변수를 반영하므로 Vercel에 값만 저장한 상태에서는 기존 배포가 바뀌지 않습니다. `.env.local`은 Git에서 제외되며 Vercel 환경변수는 별도로 등록해야 합니다.

개발 환경에서 두 값을 모두 비워두면 기존 로컬 작업을 계속 사용할 수 있습니다. 배포 빌드에서는 설정 누락 시 로그인 설정 안내 화면이 나타납니다. 값이 하나만 있거나 설정이 잘못된 경우에도 로그인 화면을 우회하지 않습니다.

### 4. 실제 로그인 확인

1. 운영 사이트 `https://great100-studio.vercel.app/` 또는 `npm run dev`로 실행한 로컬 사이트에서 **Google로 계속하기**를 누릅니다.
2. Google 계정을 선택한 뒤 대시보드 상단에 이메일과 **로그아웃** 버튼이 나타나는지 확인합니다.
3. 새로고침 후 로그인 상태가 유지되는지 확인합니다.
4. 같은 사이트를 다른 탭에서도 열고 로그아웃이 양쪽 탭에 반영되는지 확인합니다.
5. 아래 계정 저장 설정까지 완료한 뒤 다른 PC에서 같은 계정으로 로그인해 프로젝트와 파일을 확인합니다.

연동 기준: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase React 인증 가이드](https://supabase.com/docs/guides/auth/quickstarts/react).

## 계정 저장 설정: Supabase DB + Cloudflare R2

### 1. Supabase 테이블과 권한 설치

로그인에 사용한 Supabase 프로젝트의 **SQL Editor → New query**에 [`supabase/migrations/202610190001_cloud_projects.sql`](supabase/migrations/202610190001_cloud_projects.sql) 전체 내용을 붙여 넣고 실행합니다. 프로젝트, 회차 카운터, 완성 MP4 정보 테이블과 계정별 접근 권한(RLS), 저장 함수를 만듭니다.

SQL Editor의 destructive operations 경고는 기존 접근 정책을 다시 만드는 `DROP POLICY`와 권한을 조정하는 `REVOKE` 때문에 표시될 수 있습니다. 이 파일에는 테이블이나 저장된 작업을 지우는 명령이 없으며 다시 실행할 수 있습니다.

### 2. R2 버킷 만들기

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)에서 **Storage & databases → R2 → Overview**로 이동합니다. 처음 사용하면 R2 활성화 절차를 마칩니다.
2. **Create bucket**에서 이름을 `great100-media`로 지정합니다. 다른 이름을 사용해도 되지만 아래 환경변수와 일치해야 합니다.
3. 기본 저장 클래스를 **Standard**로 선택합니다. 위치는 기본 자동 선택을 사용하고 별도 관할권(Jurisdiction)은 지정하지 않습니다.
4. 버킷의 **Public Development URL**과 사용자 지정 공개 도메인은 활성화하지 않습니다. 앱은 로그인한 계정의 파일에만 임시 접근 URL을 발급합니다.

### 3. 브라우저 업로드 허용(CORS)

생성한 버킷의 **Settings → CORS Policy → Edit**에서 [`cloudflare/r2-cors.json`](cloudflare/r2-cors.json)의 전체 내용을 붙여 넣고 저장합니다. 운영 주소 `https://great100-studio.vercel.app`과 로컬 개발 주소만 허용합니다. Vercel 미리보기 주소를 사용할 때는 해당 출처를 따로 추가합니다.

### 4. R2 전용 키와 Vercel 환경변수

R2 Overview의 **Account Details → API Tokens → Manage**에서 토큰을 만듭니다. 권한은 **Object Read & Write**, 적용 버킷은 **great100-media 하나만** 선택합니다. 생성 결과의 **Access Key ID**, **Secret Access Key**를 보관합니다. 일반 Cloudflare API Token 문자열 대신 이 두 S3 키를 사용합니다. Account ID는 R2 Overview에서 확인합니다.

Vercel의 **Settings → Environment Variables**에 다음 값을 추가합니다. Production 환경에 적용하고, 필요하면 Preview/Development에도 적용합니다.

| 환경변수 | 값 | Vercel 등록 방식 |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | Config |
| `R2_BUCKET_NAME` | `great100-media` | Config |
| `R2_ACCESS_KEY_ID` | 발급받은 Access Key ID | Secret |
| `R2_SECRET_ACCESS_KEY` | 발급받은 Secret Access Key | Secret |

기존 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`도 계속 필요합니다. R2 변수에는 `VITE_`를 붙이지 않습니다. 키를 채팅이나 Git에 올리지 말고 Vercel에 직접 등록한 뒤 **재배포**합니다. 별도 Supabase service_role 키나 DB 비밀번호는 필요하지 않습니다.

로컬에서 계정 저장을 시험할 때는 같은 값을 Git에서 제외된 `.env.local`에 입력하고 `vercel dev`로 API까지 실행합니다. 일반 `npm run dev`는 Vercel 함수를 실행하지 않으므로 로그인 후 저장 연결이 준비되지 않은 것으로 표시됩니다. 개발 서버 주소가 달라지면 Supabase Redirect URLs와 R2 CORS에도 그 주소를 추가합니다.

### 5. 기존 브라우저 작업 옮기기와 확인

1. 기존 작업을 만들었던 **같은 PC·같은 브라우저**에서 운영 사이트에 로그인합니다.
2. DB와 R2 연결이 준비되면 대시보드에 기존 브라우저 작업이 나타납니다. 각 프로젝트의 **계정으로 옮기기**를 누릅니다.
3. 현재 로그인한 계정으로 자료를 복사합니다. 계정 기준 회차가 새로 부여되며 브라우저 원본은 유지됩니다. 실패한 경우 같은 버튼으로 다시 시도합니다.
4. 새 프로젝트에서 이미지·동영상·녹음을 추가하고 상단의 저장 상태가 **계정에 저장됨**으로 바뀌는지 확인합니다.
5. 다른 PC에서 같은 계정으로 로그인하거나 **작업 목록 새로고침**을 눌러 프로젝트와 자료를 확인합니다. 현재 열어 둔 편집 화면을 실시간으로 공동 편집하는 기능은 제공하지 않습니다.

다른 PC나 탭에서 먼저 수정한 프로젝트에 저장하려 하면 덮어쓰기를 막고 안내합니다. 현재 편집본을 ZIP으로 보관한 뒤 **최신 작업 불러오기**로 서버 내용을 다시 엽니다. 완성 MP4가 없어도 ZIP 백업을 받을 수 있습니다.

연동 기준: [R2 시작하기](https://developers.cloudflare.com/r2/get-started/), [R2 토큰](https://developers.cloudflare.com/r2/api/tokens/), [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [R2 임시 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 로그인 기록과 일별 방문 통계

Supabase **SQL Editor → New query**에서 [`supabase/migrations/202610190002_visit_analytics.sql`](supabase/migrations/202610190002_visit_analytics.sql) 전체 내용을 실행합니다. 기존 DB 설치 SQL과 별도로 한 번 실행하며, 다시 실행해도 기록은 유지됩니다. 앱 코드 배포 후 로그인한 사용자의 방문을 자동 기록합니다. 추가 환경변수나 별도 분석 서비스는 필요하지 않습니다.

| 저장 대상 | 내용 |
| --- | --- |
| `great100_daily_visits` | 계정당 한국 날짜 기준 하루 한 행, 첫·최근 방문 기록 시각 |
| `great100_login_history` | 로그인 세션당 한 행, 실제 로그인 시각과 앱이 처음 기록한 시각 |
| `great100_daily_stats` | 날짜별 방문자 수, 로그인 횟수, 로그인한 사용자 수를 모은 관리자용 뷰 |

**방문자 수**는 그날 로그인한 상태로 앱을 연 계정 수입니다. 같은 계정의 새로고침·여러 탭·다른 PC 접속은 하루 한 명으로 집계합니다. 로그인 유지 상태로 다음 날 다시 방문하거나, 화면을 켜 둔 채 한국 시간 자정을 넘기면 그날 방문도 기록합니다. 백그라운드 탭은 화면으로 돌아왔을 때 기록합니다. 로그인 세션이 새로 생길 때만 로그인 횟수가 늘어나므로 토큰 갱신이나 탭 전환은 로그인 횟수에 포함하지 않습니다.

전체 방문 통계는 Supabase SQL Editor의 기본 `postgres` 역할로 확인합니다.

```sql
select * from public.great100_daily_stats
order by visit_date desc;
```

[`supabase/queries/visit_analytics.sql`](supabase/queries/visit_analytics.sql)에는 **최근 30일 통계(방문 0명인 날 포함)**, **이메일별 최근 로그인**, **오늘 방문한 사용자 목록**을 조회하는 SQL이 있습니다. 첫 번째 결과의 `방문자 수`를 하루 이용자 수로 보세요. `로그인 횟수`는 같은 사람이 다시 로그인하면 늘어날 수 있습니다.

집계는 설치·배포 이후부터 시작하며 로그인하지 않고 로그인 화면만 본 방문자는 포함하지 않습니다. 기존 로그인 유지 세션을 처음 기록할 때는 그 세션의 원래 로그인 시각을 함께 남기지만, 과거 전체 로그인·방문 기록을 복원하지는 않습니다. 첫·최근 방문 기록은 앱이 보고한 시각이며 실시간 접속 상태나 체류 시간이 아닙니다.

사용자 ID와 세션 ID, 시각만 저장하고 IP·기기 정보·인증 토큰은 저장하지 않습니다. 일반 사용자는 자기 기록만 읽을 수 있고, 직접 기록을 추가·수정·삭제하거나 전체 통계를 조회할 수 없습니다. 기록 시각과 사용자 ID는 DB가 정하며, 기록 요청이 실패해도 로그인이나 작업 저장은 계속 사용할 수 있습니다.

연동 기준: [Supabase 사용자 세션](https://supabase.com/docs/guides/auth/sessions), [인증 이벤트](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [RLS와 뷰 접근](https://supabase.com/docs/guides/database/postgres/row-level-security).

### 대시보드 방문 추이 그래프

대시보드 오른쪽의 작은 **방문 추이** 카드에서 **최근 14일 / 최근 8주**를 전환합니다. 오늘·이번 주 방문자 수와 날짜별 막대를 표시하며 마우스를 올리거나 키보드로 막대에 포커스하면 해당 기간의 숫자를 확인할 수 있습니다. 한국 시간 기준이며 주는 월요일에 시작합니다. 주별 방문자는 일별 합계가 아니라 그 주에 방문한 **서로 다른 계정 수**입니다.

전체 통계는 지정한 관리자에게만 표시됩니다. 다음 두 SQL을 Supabase SQL Editor의 기본 `postgres` 역할로 한 번 실행합니다.

1. [`supabase/migrations/202610190003_visitor_chart.sql`](supabase/migrations/202610190003_visitor_chart.sql) 전체를 실행합니다. 앞의 방문 기록 SQL이 설치돼 있어야 합니다.
2. [`supabase/queries/grant_analytics_admin.sql`](supabase/queries/grant_analytics_admin.sql)의 `YOUR_GOOGLE_EMAIL`을 Great100에 로그인한 본인 Google 이메일로 바꾸고 전체를 실행합니다. 이메일은 Vercel 환경변수나 채팅에 입력할 필요가 없습니다.
3. 운영 사이트를 새로고침하면 카드가 나타납니다. 화면을 보고 있는 동안 1분마다, 다른 탭에서 돌아올 때와 새 방문 기록 직후에 갱신합니다. 카드의 새로고침 버튼으로 바로 갱신할 수도 있습니다.

일반 사용자는 카드를 보지 못하며 통계 함수를 직접 호출해도 조회할 수 없습니다. 관리자 목록도 앱에서 수정할 수 없습니다. 관리자 권한을 취소할 때는 SQL Editor에서 다음을 실행합니다.

```sql
delete from public.great100_analytics_admins
where user_id = (select id from auth.users where email = '취소할 Google 이메일');
```

## 영상 제작과 저장

웹앱에서 접근 코드를 비워두면 mock 이미지로 전체 흐름을 사용할 수 있습니다. 로그인한 웹앱은 계정 저장소를 사용하고, 인증을 설정하지 않은 개발 환경은 브라우저의 IndexedDB를 사용합니다. 장면별 자막과 표시 시간을 수정하고 모든 장면의 이미지 또는 동영상을 선택한 뒤 완료 단계에서 **MP4 만들기**를 누르세요. 브라우저가 1280×720 H.264 MP4를 직접 만들며, 장면별 내레이션과 배경음악을 추가할 수도 있습니다. 최신 Chrome/Edge에서 사용하세요.

ZIP을 내려받으면 원본 자료와 편집 정보를 보관하며, 완성된 MP4가 있으면 `projects/<회차_인물>/05_exports/<회차_인물>.mp4`도 포함합니다. 로컬 모드의 작업은 해당 브라우저에만 저장되므로 ZIP을 보관하세요. 영상 제작은 브라우저의 인코더와 메모리를 사용하며 영상 길이는 최대 15분입니다.

API 결제 없이 별도로 만든 이미지를 사용하려면 각 기준 이미지·Scene·썸네일 단계에서 **이미지 업로드**를 누르세요. PNG/JPEG/WebP 파일을 한 번에 최대 6장, 각 12MB까지 추가할 수 있습니다. 마지막으로 업로드한 이미지가 자동 선택되며 다른 후보를 클릭해 바꿀 수 있습니다. 업로드 이미지는 현재 저장 모드에 따라 R2 또는 브라우저에 저장되고 ZIP의 해당 폴더에 포함됩니다.

Scene 단계에서는 **MP4 업로드**로 10초 이하·50MB 이하의 동영상 한 편을 메인 화면으로 선택할 수 있습니다. 같은 Scene에 이미지도 업로드하면 선택한 동영상 앞에 그 이미지를 보여주고 부드럽게 전환합니다. 이미지 후보가 여럿이면 앞에 보여줄 이미지를 고르거나 이 과정을 끌 수 있습니다. **장면 시간 조절**에서 이미지→동영상 전환 시점, 동영상 원본의 시작·종료 구간, 보조 이미지가 나타나는 시점을 조절할 수 있습니다. 조절값은 장면의 기존 표시 시간 안에 포함되며 자막은 이미지와 동영상 모두에 나타납니다. 장면보다 동영상이 짧으면 마지막 프레임을 유지하고 길면 장면 끝에서 자릅니다. 원본 MP4 소리는 출력하지 않으며 앱의 내레이션·배경음악만 사용합니다. 기준 이미지, 보조 이미지, 썸네일은 계속 이미지 전용입니다. ZIP에는 선택한 동영상 원본도 `03_images/sceneXX/selected.mp4`로 들어갑니다.

v2.1 제작안의 자막 막대는 녹음 파일이 없어도 시간축에 나타나며, 녹음을 추가하면 파형이 뒤에 표시됩니다. 막대를 끌어 시간을 이동하거나 양끝을 끌어 시작·종료 시간을 바꿀 수 있습니다. **전체 검토**에는 MP4 생성 전 재생 가능한 영상 미리보기가 있습니다. 재생 막대를 움직이며 장면 전환·자막·음악·녹음을 확인한 뒤 최종 MP4를 만드세요.
Scene 검토는 왼쪽 편집·오른쪽 고정 미리보기 구조입니다. 선택한 이미지·동영상에 자막을 합쳐 보여주며, 자막 시간을 수정하면 재생 위치를 유지한 채 미리보기에 반영됩니다. 녹음이 없어도 자막은 표시됩니다. 미리보기 아래 **장면 시간축**에는 이미지→동영상→마지막 화면 유지, 자막, 녹음, 배경음악이 같은 시간 기준으로 나타납니다. 시간 눈금이나 화면·소리 막대를 클릭하거나 좌우로 드래그하면 미리보기가 해당 시점을 따라갑니다. 자막 막대 드래그는 자막 시간 편집에 사용합니다.
Scene 목록과 **이전 Scene / 다음 Scene** 버튼은 스크롤해도 화면 위에 남습니다. 다른 장면을 선택하면 해당 장면의 처음으로 이동합니다. 인접 장면 비교는 이미지 후보 아래에 접힌 상태로 있으며 필요할 때만 펼쳐 볼 수 있습니다.
v2.1 씬에는 녹음 파일이 없어도 **자막 시간 막대**가 나타납니다. 자막 막대를 좌우로 끌어 이동하거나 양끝 손잡이로 노출 시간을 조절할 수 있습니다. 손잡이로 한 자막의 길이를 바꾸면 나머지 자막은 남은 씬 시간을 기존 길이의 비율대로 자동으로 나눠 갖고, 마지막 자막은 씬 끝에 맞춰집니다. 가운데를 끌어 위치만 옮길 때는 다른 자막의 길이를 바꾸지 않습니다. 녹음을 추가한 씬에서는 같은 조작을 녹음 파형 위에서 할 수 있습니다.
자막 시간을 옮긴 뒤 **제작안 시간으로 초기화**를 누르면 해당 씬의 모든 자막 시작·종료 시간이 처음 Work 제작안 값으로 돌아갑니다. 수정한 자막 문구는 그대로 유지됩니다.

각 후보 카드의 **삭제** 버튼으로 불필요한 이미지나 동영상을 개별 제거할 수 있습니다. 선택된 후보를 삭제하면 자동으로 다른 후보를 선택하지 않으므로 새 후보를 직접 골라 주세요. 삭제는 확인 후 진행되며 되돌릴 수 없습니다. 계정 모드에서는 편집 정보 저장 성공 후 해당 원본을 R2에서 제거합니다. 로컬 웹에서는 IndexedDB 원본을, 데스크톱에서는 프로젝트 폴더의 해당 파일을 삭제합니다. 기존 완성 MP4는 무효화되므로 다시 만들어야 합니다.

각 Scene에는 편집 가능한 장면 내용과 **복사용 전체 이미지 프롬프트**가 따로 보입니다. 전체 프롬프트는 현재 인물 외형 기준, 기본 그림책 스타일, 제작안의 추가 이미지 조건을 항상 합쳐 보여 줍니다. **전체 프롬프트 복사**를 눌러 ChatGPT 이미지 생성에 그대로 붙여넣을 수 있고, 앱의 후보 생성에도 같은 문장이 사용됩니다. ZIP에는 장면별 `03_images/sceneXX/image_prompt.txt`와 `project_data.json`의 `full_prompt`가 포함됩니다.

Work 제작안은 `Scene 1`·`장면 1` 형식, 열 이름과 순서가 조금 다른 마크다운 표, JSON 형식을 읽습니다. 장면별 시간·프롬프트·내레이션 자막을 가능한 범위에서 자동으로 가져옵니다. 자동 인식에 실패하거나 내용이 틀리면 **파싱 확인**에서 장면을 직접 추가·수정할 수 있습니다. 이미 만든 프로젝트는 **파싱 확인 → 원문 다시 분석**으로 다시 읽을 수 있습니다.

마음에 들지 않는 프로젝트는 대시보드의 프로젝트 카드에서 **삭제**를 누른 뒤 확인할 수 있습니다. 계정 모드에서는 해당 프로젝트의 R2 파일과 DB 정보가 함께 삭제됩니다. 로컬 웹에서는 브라우저의 해당 작업을 삭제합니다. 데스크톱에서는 실제 프로젝트 폴더를 `projects/.trash/`로 옮겨 앱 목록에서 제외하므로 수동 복구가 가능합니다.

## Vercel 배포

저장소 루트에서 `vercel`을 실행하면 Vite 웹앱과 `api/media.ts`, `api/generate.ts` 함수가 함께 배포됩니다. 계정 저장에는 위 Supabase/R2 환경변수를 사용합니다. 실제 OpenAI 이미지 생성을 사용할 때만 다음 두 변수를 별도로 설정합니다.

- `OPENAI_API_KEY`: 서버에서만 읽는 OpenAI API 키
- `GREAT100_ACCESS_KEY`: 개인 사용을 위한 별도 접근 코드. 웹앱의 입력칸에 이 코드를 입력합니다.

두 값 중 하나라도 없으면 서버의 실제 이미지 생성은 비활성화됩니다. 접근 코드는 OpenAI API 키가 아닙니다. Google 로그인과 계정 저장은 이 접근 코드와 별개입니다. 이미지 생성 API는 사용량 제한을 별도로 마련한 뒤 공개하세요.

웹에서 실제 생성 요청을 로컬로 시험하려면 `vercel dev`를 사용합니다. 일반 `npm run dev`는 프런트엔드와 mock mode를 실행합니다.

## 데스크톱 실행

Rust와 macOS 개발 도구가 설치된 환경에서는 다음을 실행합니다.

```bash
npm run tauri dev
```

macOS에서 Xcode 전체 설치의 라이선스가 미동의 상태여도 Command Line Tools가 설치되어 있다면 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`를 명령 앞에 지정할 수 있습니다. 데스크톱 앱은 프로젝트 루트 아래 실제 `projects/` 폴더를 생성합니다. `OPENAI_API_KEY`가 없으면 mock 이미지가 저장됩니다.

## 프로젝트 구성

`projects/<회차_인물>/`에는 `project_data.json`과 다음 하위 폴더가 들어갑니다.

- `01_source`
- `02_character`
- `03_images/sceneXX`
- `04_thumbnail`
- `05_exports`
- `06_logs`

웹 ZIP에는 완성 MP4, 원문, 프로젝트 데이터, 생성 이미지, 최종 선택 이미지, 프롬프트 이력이 들어갑니다. 데스크톱 앱은 완성 MP4를 프로젝트의 `05_exports` 폴더에도 저장합니다.
