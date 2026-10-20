# AI WIKI

석사논문 및 연구자료를 수집·분류·분석하고, 연구자의 관점과 논문 활용 위치를 기록하는 연구관리 웹앱입니다. (2차 판본)

## 주요 기능

| 기능 | 화면 | 내용 |
|---|---|---|
| 연구자료 수집 및 라이브러리 관리 | 자료 수집 · 자료 라이브러리 | PDF/HWPX 파일 정보, 웹 URL, YouTube 등록. 검색·필터, 관련도(1~5), PARA 분류, 제목 수정, 삭제 |
| 자료 분석 및 '나의 관점' 기록 | AI 분석 | 연구자가 직접 쓰는 '나의 관점' 저장. 라이브러리·대시보드에 관점 작성 완료/작성 필요 표시 |
| 내 연구와의 연결 · 연구 메모 | AI 분석 | 자료별 '내 연구와의 연결', '연구 메모' 기록 |
| 논문 활용 위치 관리 | AI 분석 · 자료 라이브러리 | 선행연구 / 이론적 배경 / 콘텐츠 설계 / 개발 방법 / 분석·논의 / 기타 (복수 선택) |
| 참고문헌 서지정보 관리 및 형식 변환 | 참고문헌 | 자료 유형 7종별 서지정보 입력, 필수 항목 확인, APA 7 · Chicago(저자-연도) · MLA 9 · 국내 학술지 일반형 변환, TXT/HTML 내보내기 |
| JSON 전체 백업/복원 | 연구 설정 · 자료 라이브러리 | 자료·연구 설정·집필 상태 전체를 JSON 파일로 백업, 전체 복원 또는 자료만 병합 |
| Markdown import/export | 자료 라이브러리 | Obsidian 호환 Markdown 내보내기·가져오기 (서지정보·관점·연결·메모·활용 위치 보존) |
| Obsidian 폴더 연동 | 연구 설정 | 사용자가 선택한 Vault/폴더에 Markdown 저장, 폴더의 노트 가져오기 |
| Google Drive 백업 및 Markdown 저장/불러오기 | 연구 설정 · 자료 수집 | 내 Drive에 전체 백업 JSON과 자료별 Markdown 저장, Drive 파일 불러오기 |

가져오기(파일·Obsidian·Google Drive 공통)는 적용 전에 추가 / 갱신 / 변경 없음 / 충돌 / 중복 의심 / 오류 건수를 미리 보여 주며, 충돌·중복 처리 방법을 선택할 수 있습니다.

> AI 분석·자막 요약·집필 생성은 외부 AI를 호출하지 않는 **Demo**(준비된 샘플 결과)이며 화면에 Demo로 표시됩니다. HWPX 파싱은 지원하지 않습니다.

## 기술 스택

React 18 + TypeScript 5.6 + Vite 5 (별도 백엔드·데이터베이스 없음)

## 실행 방법

Node.js(npm 포함)가 필요합니다. 프로젝트 폴더에서:

```bash
npm ci
npm run dev
```

터미널에 표시되는 주소(기본 `http://localhost:5173`)로 접속합니다.

| 명령 | 용도 |
|---|---|
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run build` | 타입 검사 + 배포용 빌드(`dist/`) |
| `npm run preview` | 빌드 결과 확인 |
| `npm run verify` | 데이터 보존·가져오기·Markdown·참고문헌 서식 검증 스크립트 (`tests/verify.ts`) |

개발 서버 포트는 5173으로 고정되어 있습니다(`vite.config.ts`). localStorage는 주소(포트)별로 따로 저장되므로, 포트가 바뀌어 자료가 사라진 것처럼 보이는 일을 막기 위함입니다.

## 기본 데이터 저장 방식

- 모든 자료와 설정은 **브라우저 localStorage**(`ai-wiki:v2`)에 저장됩니다. 서버로 전송되지 않습니다.
- 이전 버전 데이터(`ai-wiki:v1`)는 처음 실행 시 새 구조로 옮기며 원본은 지우지 않습니다.
- 저장된 데이터를 읽지 못하면 원본을 별도 키에 보관하고, 보관도 불가능하면 덮어쓰지 않도록 자동 저장을 중지합니다.
- 브라우저 데이터를 지우면 자료도 함께 사라지므로 **연구 설정 → 전체 백업 받기**로 정기적으로 백업하세요.

## Obsidian 연동

- Chrome/Edge(데스크톱)의 **File System Access API**를 사용합니다. 미지원 브라우저에서는 자료 라이브러리의 Markdown 가져오기·내보내기를 사용합니다.
- 사용자가 폴더 선택 창에서 **직접 Vault 또는 폴더를 선택**하며, 앱은 선택한 폴더 안에서만 읽고 씁니다.
- 기본적으로 선택 폴더 아래 **`AI WIKI` 하위 폴더**에 `자료제목.md`로 저장합니다(하위 폴더 이름 변경 가능).
- 다시 저장하면 같은 자료(노트 속성의 `ai_wiki_id`)의 노트를 갱신하며 중복 파일을 만들지 않습니다.
- Obsidian에서 수정된 노트는 기본적으로 덮어쓰지 않고 알려 줍니다. AI WIKI가 만들지 않은 같은 이름의 노트도 덮어쓰지 않습니다.
- 기존 Obsidian Markdown 노트를 목록에서 골라 AI WIKI로 가져올 수 있습니다(가져오기 미리보기 사용).
- 앱은 사용자의 Vault 파일을 **자동 삭제하지 않습니다.**
- 브라우저 보안 정책에 따라 새로고침·재시작 후 **폴더 접근 권한을 다시 허용**해야 할 수 있습니다("접근 허용" 버튼).
- 자동·실시간 동기화는 하지 않으며, 버튼을 누를 때만 저장·불러오기를 합니다.

## Google Drive 연동

- Google Drive API와 Google OAuth(Google Identity Services 토큰 방식)를 사용합니다.
- 권한 범위는 **`drive.file`만** 사용합니다. 이 앱이 만든 파일과 사용자가 직접 고른 파일에만 접근합니다.
- 내 Drive의 **`AI WIKI` 폴더**에 전체 백업 JSON을, **`AI WIKI/notes` 폴더**에 자료별 Markdown을 저장합니다(폴더는 자동 생성).
- 같은 자료의 Markdown은 같은 Drive 파일을 갱신합니다. 백업 JSON은 저장할 때마다 새 파일로 남습니다.
- `AI WIKI` 폴더의 파일 목록을 조회해 가져올 수 있습니다. API 키와 앱 ID를 설정하면 Google Picker로 내 Drive의 다른 파일도 고를 수 있습니다.
- OAuth access token은 **브라우저 탭 메모리에만 유지**하며 localStorage나 백업 파일에 저장하지 않습니다.
- 새 브라우저 세션/탭이나 토큰 만료(약 1시간) 후에는 **Google 계정 연결이 다시 필요**할 수 있습니다.

### Google Drive 설정 방법

1. **Google Cloud Console**(https://console.cloud.google.com)에서 프로젝트를 만들거나 선택합니다.
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API**를 사용 설정합니다. (Picker를 쓰려면 Google Picker API도)
3. **OAuth 동의 화면(Google Auth Platform)**: 앱 이름·지원 이메일 입력, 데이터 액세스(범위)에 `https://www.googleapis.com/auth/drive.file` 추가, 테스트 모드라면 사용할 Google 계정을 테스트 사용자로 추가합니다.
4. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기**: 유형 **웹 애플리케이션**, 승인된 JavaScript 원본에 **`http://localhost:5173`** 등록(리디렉션 URI는 필요 없음).
5. (선택, Picker용) API 키를 만들고 HTTP 리퍼러 `http://localhost:5173/*`, Google Picker API로 제한합니다. 프로젝트 번호를 확인합니다.
6. 프로젝트 루트에서 `.env.example`을 복사해 **`.env`**를 만들고 값을 입력합니다.

   ```env
   VITE_GOOGLE_CLIENT_ID=발급받은_클라이언트_ID
   # 선택 (Picker 사용 시)
   VITE_GOOGLE_API_KEY=
   VITE_GOOGLE_APP_ID=
   ```

7. `npm run dev`를 다시 시작한 뒤 **연구 설정 → Google 계정 연결**을 누릅니다.

`.env`가 없으면 Google Drive 카드에 "설정 필요"가 표시되며, 그 밖의 기능은 모두 그대로 사용할 수 있습니다.

## 보안·개인정보

- `.env`(Client ID·API 키 등)와 OAuth access token은 **제출본에 포함하지 않습니다.** `.env`는 `.gitignore`에 등록되어 있습니다.
- 소스 코드에 개인 Google 계정 정보나 실제 인증정보를 넣지 않았습니다. 설정값은 모두 `.env` 환경변수로 읽습니다.
- 브라우저 코드에 client secret을 사용하지 않습니다.

## 개발 서버 보안 주의사항

- 이 프로젝트는 Vite 개발 서버를 **localhost에서만** 실행하도록 사용합니다(`--host` 옵션 없이 `npm run dev`).
- 개발 서버 실행 중에는 **신뢰할 수 없는 웹사이트 접속을 피하고**, 사용하지 않을 때는 **개발 서버를 종료**하는 것을 권장합니다.
- `npm audit`에서 개발 의존성인 **vite/esbuild** 관련 취약점(개발 서버 실행 중에만 해당)이 보고되었으나, 현재 정상 작동하는 제출본의 호환성을 유지하기 위해 강제 major upgrade(`npm audit fix --force`)는 적용하지 않았습니다.
- `.env`는 제출용 ZIP에 포함되지 않습니다.

## 실제 검증 내용

- TypeScript typecheck 성공 (`npm run typecheck`)
- production build 성공 (`npm run build`)
- 검증 스크립트 109건 통과 (`npm run verify`: v1 데이터 변환, 손상 데이터 보존, 백업·복원 왕복, 가져오기 충돌·중복·오류, Markdown 왕복, 참고문헌 서식)

개발자가 실제 환경에서 직접 확인한 항목:

- Obsidian 실제 폴더 연결 및 Markdown 저장
- Obsidian 기존 Markdown → AI WIKI 가져오기(import/apply)
- Google OAuth 실제 계정 연결
- Google Drive `AI WIKI` 폴더 생성
- 전체 백업 JSON의 Drive 저장
- 자료별 Markdown의 Drive 저장
- Drive 파일 목록 조회

## 알려진 제한사항

- Google OAuth token을 영구 저장하지 않으므로 새 세션에서는 다시 연결해야 합니다.
- Obsidian 연동은 File System Access API를 지원하는 데스크톱 Chrome/Edge를 권장합니다.
- Obsidian·Google Drive 모두 버튼을 눌렀을 때만 동작하는 수동 저장·불러오기이며, 자동·양방향 동기화는 하지 않습니다.
- AI 분석·자막 요약·집필 생성은 Demo이며, 샘플 자료는 실제 선행연구가 아닙니다.
- 참고문헌 서식은 각 양식의 일반 규칙을 적용한 것으로, 제출 전 학과·학술지 규정으로 최종 확인이 필요합니다.
- 본 프로젝트는 2차 판본입니다.

## 폴더 구조

```
src/
  App.tsx, main.tsx, store.tsx, types.ts, styles.css
  components/   사이드바, 공통 UI, 가져오기/내보내기, Google Drive, Obsidian 카드
  pages/        7개 화면 (대시보드, 자료 수집, 라이브러리, AI 분석, AI 집필, 참고문헌, 연구 설정)
  lib/          데이터 정규화·백업, Markdown 가져오기, 참고문헌 서식, 저장, Drive, Obsidian
  data/         샘플 자료·기본 설정
tests/          검증 스크립트와 테스트용 파일
.env.example    Google Drive 설정 변수 예시
```
