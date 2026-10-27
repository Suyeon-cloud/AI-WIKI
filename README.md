# AI WIKI

석사논문과 연구자료를 **프로젝트(논문 주제) 단위**로 수집·분류·분석하고, 연구자의 관점과 논문 활용 정보를 기록하며, Claude AI를 이용한 **자료 분석과 학위논문 집필**까지 지원하는 연구관리 웹앱입니다. 마지막 단계에서 한국외국어대학교 학위논문 서식의 **HWPX(한글) 원고**를 생성합니다.

React 18 + TypeScript + Vite로 만든 브라우저 앱이며, 별도 백엔드 서버나 데이터베이스는 없습니다.

## 목차

1. [주요 기능](#주요-기능)
2. [AI 분석과 AI 집필의 차이](#ai-분석과-ai-집필의-차이)
3. [전체 사용 흐름](#전체-사용-흐름)
4. [설치 및 실행](#설치-및-실행)
5. [외부 연동 및 설정](#외부-연동-및-설정)
6. [Google Drive와 AI 결과물 관리](#google-drive와-ai-결과물-관리)
7. [HUFS 학위논문 집필 Skill](#hufs-학위논문-집필-skill)
8. [데이터 및 보안](#데이터-및-보안)
9. [프로젝트 구조](#프로젝트-구조)

## 주요 기능

| 기능 | 화면 | 내용 |
|---|---|---|
| 프로젝트 생성 및 히스토리 | 대시보드 · 사이드바 | 논문 주제 단위로 프로젝트 생성·전환·정보 수정·삭제. 프로젝트 이력 표(상태, 자료 수, AI 결과물 수, 폴더 생성 여부)와 활동 기록 |
| 연구자료 수집 · 라이브러리 | 자료 수집 · 자료 라이브러리 | 프로젝트별 폴더로 자료 관리, 검색·필터, 여러 자료 선택 후 폴더 이동·삭제·외부 저장소로 보내기 |
| KCI 논문 PDF 가져오기 | 자료 수집 | PDF에서 제목·저자·학술지·권호·쪽·DOI·국문/영문 초록·주제어 추출 → 확인 창에서 직접 체크·수정한 논문만 라이브러리에 추가 |
| 웹 · YouTube · 파일 자료 | 자료 수집 | URL·YouTube 링크 등록, Markdown·TXT·AI WIKI JSON 파일 가져오기(추가/갱신/충돌/중복 미리보기) |
| Google Drive 연동 | 자료 수집 · 라이브러리 · AI 분석/집필 | Drive의 기존 자료를 목록 창에서 체크해 가져오기, 자료 Markdown과 AI 결과물·HWPX를 프로젝트 폴더에 저장 |
| Obsidian 연동 | 자료 수집 · 라이브러리 · 연구 설정 | 선택한 Vault 폴더의 노트를 골라 가져오기, 자료를 프로젝트 폴더의 Markdown 노트로 내보내기 |
| AI 분석 | AI 분석 | 연구 주제·키워드를 기준으로 한 **전체 자료 분석**과 **선택 논문 심층 분석**, 분석 기록 보관 |
| 나의 관점 · 연구 기록 | AI 분석 · 라이브러리 | 자료별 나의 관점, 내 연구와의 연결, 연구 메모, 논문 활용 위치를 연구자가 직접 기록 |
| 참고문헌 · 서지정보 관리 | 참고문헌 | 자료 유형 7종별 서지정보 입력·검증, APA 7 · Chicago · MLA 9 · 국내 학술지 일반형 서식, TXT/HTML 내보내기 |
| AI 논문 집필 | AI 집필 | 논문 정보·근거 자료·목차(기본 목차 / AI 목차 제안)를 정하고 장별 원고와 국문초록·ABSTRACT 작성 |
| HUFS 학위논문 HWPX 생성 | AI 집필 | 겉표지·속표지·심사청구서·인정서·국문초록·목차·본문·참고문헌·ABSTRACT를 갖춘 HWPX 파일 생성 |
| JSON 백업 · 복원 | 연구 설정 | 프로젝트·자료·AI 결과물·집필 원고 전체를 JSON 파일로 백업하고 전체 복원 또는 자료만 병합 |

## AI 분석과 AI 집필의 차이

| | AI 분석 | AI 집필 |
|---|---|---|
| 목적 | 모은 자료를 AI가 어떻게 판단하는지 확인하고 **인사이트**를 얻음 | 학위논문 구조에 맞는 **원고**를 작성 |
| 입력 | 연구자가 정한 **분석 주제 + 키워드**(필수), 나의 관점, 질문 | 논문 정보(학과·지도교수 등), **목차**, 근거 자료, (선택) AI 전체 분석 결과 |
| 결과 | 전체 분석: 주제 흐름, 공통 발견, 쟁점, 연구 공백, 내 연구의 차별점, 제안 연구 문제, 자료별 역할, 추가 검색어<br>선택 논문 분석: 요약, 연구 방법, 주요 결과, 한계, 내 논문과의 접점, 활용 제안 | 장별 본문(절·항 구조), 연구자 확인 사항, 국문초록·ABSTRACT, HWPX 파일 |

AI 분석·집필 결과는 원본 연구자료와 섞이지 않도록 **AI 결과물 보관함**에 따로 저장됩니다.

## 전체 사용 흐름

```
프로젝트 생성 → 자료 수집/가져오기 → 라이브러리 정리 → AI 분석 → 참고문헌 정리 → AI 집필 → HWPX 출력 · Drive 저장
```

1. **프로젝트 생성**: 대시보드 또는 사이드바의 "새 프로젝트". 논문 주제·키워드와 학위논문 정보(학과·지도교수·성명)를 입력합니다. Obsidian·Drive가 연결돼 있으면 같은 이름의 프로젝트 폴더를 함께 만듭니다.
2. **자료 수집/가져오기**: KCI 논문 PDF, 웹, YouTube, 파일로 새 자료를 모으고, Drive·Obsidian에 보관된 기존 자료는 "연동 저장소에서 가져오기"로 골라 가져옵니다.
3. **라이브러리 정리**: 관련도·PARA 분류를 정하고, 자료마다 나의 관점을 기록합니다.
4. **AI 분석**: 분석 주제와 키워드를 입력하고 전체 분석 또는 선택 논문 분석을 실행합니다.
5. **참고문헌 정리**: 서지정보를 확인·보완합니다. 필수 항목이 모두 있는 자료만 참고문헌 목록과 HWPX에 들어갑니다.
6. **AI 집필**: 목차를 정하고 장별 원고를 작성·수정합니다.
7. **HWPX 출력 · Drive 저장**: HWPX를 내려받거나 Drive의 프로젝트 `AI 생성` 폴더에 저장합니다.

앱의 "시작하기" 화면에서도 같은 흐름도와 시작 체크리스트를 볼 수 있습니다.

## 설치 및 실행

Node.js 18 이상(npm 포함)이 필요합니다. 프로젝트 폴더에서:

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`으로 접속합니다. Obsidian 폴더 연동은 **Chrome 또는 Edge(데스크톱)**에서 사용하세요.

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 실행 (포트 5173 고정) |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run build` | 타입 검사 + 배포용 빌드(`dist/`) |
| `npm run preview` | 빌드 결과 확인 (포트 4173) |
| `npm run thesis:hwpx -- <원고.json> <출력.hwpx>` | 원고 JSON으로 HUFS 서식 HWPX 생성 (Skill용) |

개발 서버 포트는 5173으로 고정되어 있습니다. 브라우저 저장소는 주소(포트)별로 따로 저장되므로, 포트가 바뀌어 자료가 사라진 것처럼 보이는 일을 막기 위함입니다.

## 외부 연동 및 설정

외부 연동 없이도 자료 수집·라이브러리·참고문헌·HWPX 생성 기능은 사용할 수 있습니다.

### Claude API (AI 분석 · AI 집필 · PDF 서지 보완)

- Anthropic API key가 필요합니다. 앱에서 **연구 설정 → AI 설정**에 입력합니다.
- 사용 모델: Claude Opus 5.5. 브라우저에서 Claude API를 직접 호출하며, 사용량에 따라 요금이 부과됩니다.
- 대안으로 `.env`의 `VITE_ANTHROPIC_API_KEY`에 키를 넣을 수 있습니다. 이 경우 키가 빌드 결과물(`dist/`)에 포함되므로 빌드 결과물을 다른 사람에게 배포하지 마세요.

### Google Drive

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트를 만들고 **Google Drive API**를 사용 설정합니다.
2. OAuth 동의 화면에서 범위 `https://www.googleapis.com/auth/drive.file`과 `https://www.googleapis.com/auth/drive.readonly`를 추가하고, 테스트 모드라면 사용할 계정을 테스트 사용자로 등록합니다.
   - `drive.file`: 이 앱이 만든 폴더·파일 쓰기
   - `drive.readonly`: 사용자가 Drive에 직접 올려 둔 자료를 목록에서 골라 가져오기(읽기 전용)
3. OAuth 클라이언트 ID(유형: 웹 애플리케이션)를 만들고, 승인된 JavaScript 원본에 `http://localhost:5173`을 등록합니다.
4. `.env.example`을 복사해 `.env`를 만들고 `VITE_GOOGLE_CLIENT_ID`를 입력한 뒤 개발 서버를 다시 시작합니다.
5. 앱의 **연구 설정 → Google Drive → Google 계정 연결**을 누릅니다.

브라우저 코드에서는 client secret을 사용하지 않습니다.

### Obsidian

- 연구 설정에서 **사용자가 직접 선택한 로컬 Vault 폴더**에 연결합니다(브라우저 File System Access API). 앱은 선택한 폴더 안에서만 읽고 씁니다.
- 별도 플러그인이나 서버가 필요 없으며, 버튼을 누를 때만 저장·불러오기를 합니다(자동 동기화 없음).
- 저장 위치: `<Vault>/<기본 폴더, 기본값 AI WIKI>/<프로젝트>/자료`, `.../<프로젝트>/AI 생성`
- 가져오기는 Vault 전체(또는 현재 프로젝트 폴더)의 노트 목록에서 선택한 노트만 현재 프로젝트로 가져옵니다.
- Obsidian에서 수정된 노트와 AI WIKI가 만들지 않은 같은 이름의 노트는 덮어쓰지 않으며, Vault 파일을 삭제하지 않습니다.
- 폴더 연결 정보는 브라우저(IndexedDB)에 보관되며, 브라우저 정책에 따라 새로고침 후 "접근 허용"이 다시 필요할 수 있습니다.

## Google Drive와 AI 결과물 관리

Google Drive와 Obsidian은 새 자료를 찾아 주는 **수집원이 아니라**, 연구자가 이미 확보해 정리해 둔 자료를 보관하는 **연동 저장소**입니다.

- **가져오기**: 자료 수집 화면의 "연동 저장소에서 가져오기"에서 Drive 목록 창(폴더 이동·검색 가능)을 열고, 체크한 파일만 현재 프로젝트로 가져옵니다. PDF는 서지·초록을 추출해 한 번 더 확인한 뒤 추가합니다.
- **저장**: 원본 자료와 AI 결과물을 프로젝트별로 나누어 저장합니다.

```
내 Drive/AI WIKI/
├─ <프로젝트>/
│  ├─ 자료/      ← 라이브러리에서 보낸 원본 자료 Markdown
│  └─ AI 생성/   ← AI 분석 결과, 집필 초안 Markdown, 학위논문 HWPX
└─ ai-wiki-backup-*.json   ← 전체 백업
```

- AI 결과물은 앱 안에서도 라이브러리(원본 자료)와 분리된 **AI 결과물 보관함**에 저장되며, 보관함에서 Drive·Obsidian의 `AI 생성` 폴더로 저장하거나 Markdown으로 내려받을 수 있습니다.
- 앱에서 프로젝트를 삭제해도 Drive·Obsidian의 실제 파일과 폴더는 삭제되지 않습니다.

## HUFS 학위논문 집필 Skill

`.claude/skills/hufs-thesis-writing/`은 한국외국어대학교 대학원 학위논문 작성 서식(서식 1~12)을 바탕으로 만든 집필 Skill입니다.

| 파일 | 역할 |
|---|---|
| `SKILL.md` | 집필 원칙(제공 자료만 인용, 학술 문체 등), 외대 학위논문 구성·번호 체계·지면 규격, 원고 출력 형식, 참고문헌 형식 |
| `examples/sample-thesis.json` | HWPX 생성용 원고 JSON 예시 |
| `hufs-form-text.txt` | 원본 서식 파일에서 추출한 서식 텍스트 (참고용) |
| `LICENSE-python-hwpx.txt`, `NOTICE-python-hwpx.txt` | HWPX 기본 골격 출처 라이선스 |

- 앱의 **AI 집필** 화면은 `SKILL.md`를 Claude의 시스템 지침으로 그대로 사용합니다. Claude Code에서도 같은 Skill로 사용할 수 있습니다.
- HWPX 생성(`src/lib/hwpx.ts`)은 한컴오피스 한글이 만든 빈 HWPX 골격 위에 글자·문단 모양과 본문을 얹는 방식입니다. 지면은 19 × 26 cm(좌 3 cm · 우 2 cm, 위 3.5 cm · 아래 3 cm), 쪽 번호는 아래 가운데입니다.
- HWPX 골격은 [python-hwpx](https://pypi.org/project/python-hwpx/)(Apache License 2.0)의 Skeleton.hwpx에서 가져왔습니다.
- 제출 전에는 생성된 파일을 한글에서 열어 목차 쪽수, 표지 줄 간격 등을 최종 확인해야 합니다.

## 데이터 및 보안

| 데이터 | 저장 위치 | 비고 |
|---|---|---|
| 프로젝트 · 자료 · AI 결과물 · 집필 원고 · 활동 기록 | 브라우저 **IndexedDB** (`ai-wiki-data` DB, 키 `ai-wiki:v2`) | 서버로 전송되지 않음. 용량 제한이 큰 IndexedDB를 사용하며, 예전 localStorage 데이터는 처음 실행 시 자동으로 옮김(원본은 남겨 둠). IndexedDB를 쓸 수 없는 환경에서만 localStorage 사용 |
| Google Drive access token | 메모리 + 현재 탭의 **sessionStorage** (`ai-wiki:drive-token`) | 같은 탭 새로고침 시 만료(약 1시간) 전까지 복원, 연결 해제·인증 실패·만료·탭 종료 시 제거. localStorage에는 저장하지 않음 |
| Claude API key (앱에서 입력) | 기본: 현재 탭의 **sessionStorage** (`ai-wiki:anthropic-key`) / "이 브라우저에 기억" 선택 시: **localStorage** | 백업 파일에 포함되지 않음. "지우기"로 삭제 |
| Obsidian Vault 폴더 연결 | 브라우저 **IndexedDB** | 폴더 접근 권한 정보만 보관 |
| Drive 폴더 ID | localStorage | 인증 정보가 아님 |

- 브라우저 데이터를 지우면 자료도 함께 사라지므로 **연구 설정 → 전체 백업 받기**로 정기적으로 백업하세요.
- KCI PDF는 브라우저 안에서만 읽으며 원본 PDF는 업로드하지 않습니다. AI 서지 보완을 켜면 PDF 앞 4쪽의 텍스트만 Claude API로 전송됩니다.
- **API key, OAuth access token, client secret, 개인 계정 정보는 저장소에 포함하지 마세요.** `.env`, `.env.local`, `dist/`는 `.gitignore`에 등록되어 있습니다. 소스 코드에는 실제 인증정보가 들어 있지 않으며, 설정값은 `.env` 환경변수로 읽습니다.
- 개발 서버는 localhost에서만 실행하고(`--host` 옵션 없이), 사용하지 않을 때는 종료하세요.

## 프로젝트 구조

```
src/
  App.tsx, main.tsx, store.tsx, types.ts, styles.css
  pages/
    Home.tsx         시작하기 (사용법 · 동작 흐름도 · 체크리스트)
    Dashboard.tsx    프로젝트 이력 · 활동 기록 · 현황
    Collect.tsx      자료 수집 (KCI PDF · 웹 · YouTube · 파일) · 연동 저장소에서 가져오기
    Library.tsx      프로젝트별 폴더 · 자료 상세 · 보내기
    Analysis.tsx     AI 전체 분석 · 선택 논문 분석 · 나의 관점
    References.tsx   서지정보 입력 · 참고문헌 서식
    Writing.tsx      AI 집필 · HWPX 출력
    Settings.tsx     AI · Obsidian · Drive 연결, 백업 · 복원
  components/        사이드바, 공통 UI, 프로젝트 창, KCI·Drive 가져오기, Obsidian·Drive 카드, AI 결과물 목록
  lib/
    ai.ts            Claude API 호출 · API key 관리
    prompts.ts       AI 분석·집필 요청 내용과 응답 형식
    pdf.ts, kci.ts   PDF 텍스트 추출 · KCI 서지/초록 추출
    hwpx.ts          HUFS 학위논문 HWPX 생성
    drive.ts         Google Drive 인증 · 파일 · 폴더
    obsidian.ts      Obsidian Vault 폴더 읽기·쓰기
    sync.ts          프로젝트 폴더 생성 · 자료/AI 결과물 저장
    projects.ts, data.ts, persist.ts   데이터 정규화 · 이전 버전 변환 · 저장
    citation.ts      참고문헌 서식
.claude/skills/hufs-thesis-writing/   HUFS 학위논문 집필 Skill
scripts/thesis-hwpx.ts                원고 JSON → HWPX 변환 스크립트
.env.example                          Google Drive 설정 변수 예시
```
