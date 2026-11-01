# AI WIKI 배포 작업 상태

Google 로그인과 Supabase 계정별 저장을 연결한 작업 사본입니다. 실제 두 계정 전환과 백업 복원·새로고침 후 보존을 사용자와 확인했습니다. Vercel 배포는 아직 진행하지 않았습니다.

## 개인 Claude 키 사용

연구 설정에서 각자 본인의 Claude 키를 입력하고 **이 탭에서 사용**을 누릅니다. 키는 모듈 메모리에만 두며 새로고침, 페이지 이탈, 탭 닫기, 로그아웃, 계정 변경 시 다시 입력해야 합니다. 키 입력과 삭제는 AI 요청을 보내지 않으며 연결 확인은 짧은 유료 요청을 보냅니다. 요금은 입력한 키의 API 계정에 청구됩니다.

Claude 요청은 같은 출처의 `/api/claude` 서버를 거칩니다. 서버는 Supabase에서 Google 로그인 토큰과 확인된 이메일을 검증한 뒤 해당 요청의 키로 Claude를 호출합니다. 애플리케이션은 키를 Supabase·localStorage·sessionStorage·파일·로그에 기록하지 않습니다. 서버가 요청을 처리하는 동안 키를 취급하므로 운영자가 기술적으로 접근 불가능한 구조는 아닙니다. 배포 시 요청 본문이나 헤더를 수집하는 분석/디버그 도구를 추가하지 마세요. 로그인 세션과 연구자료 저장은 API 키 보관과 별개입니다.

운영자의 `ANTHROPIC_API_KEY`나 `AI_ALLOWED_EMAILS`는 사용하지 않습니다. 교수님 이메일을 별도 서버 허용 목록에 등록할 필요가 없습니다. 다만 Google OAuth 앱이 테스트 상태라면 Google 측 테스트 사용자 설정은 별개로 적용됩니다. KCI Open API는 연결하지 않았으며 기존 PDF 서지 추출 기능을 유지합니다.

## 연결과 검증

`.env.local`에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 설정합니다. Google Drive를 사용하려면 `VITE_GOOGLE_CLIENT_ID`도 설정합니다. Google Client Secret은 Supabase Google Provider에만 등록합니다. 비밀값은 어떤 `VITE_` 변수에도 넣지 않습니다. `.env.local`은 Git에서 제외됩니다.

`supabase/migrations/202611010001_user_state.sql`을 새 프로젝트에 한 번 적용합니다. 계정당 JSON 문서 하나를 저장하며 RLS로 소유자만 CRUD할 수 있습니다. 버전 충돌 시 덮어쓰지 않고 중지합니다. 미저장 복구 사본은 계정별 브라우저 IndexedDB 키에 두며 API 키는 포함하지 않습니다.

검증 명령: `npm run build`, `npm run verify`, `npm run verify:cloud`, `npm run verify:server`. 서버 검사는 실제 Claude 비용 없이 인증·요청별 키 분리·오류 비밀값 제거·취소·메모리 키 수명을 확인합니다. 실제 개인 키로 연결 확인이 성공한 것을 사용자와 확인했습니다.

Vite 개발 서버와 Vercel 함수는 같은 서버 핸들러를 사용합니다. 모델은 Opus 5.5, 요청은 4MB 이하, 출력은 최대 32,000토큰이며 240초 후 중단합니다. 자동 재시도는 끕니다. 큰 PDF는 텍스트로 가져오거나 범위를 줄여 주세요.

