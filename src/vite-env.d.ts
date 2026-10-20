/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 클라이언트 ID (웹 애플리케이션 유형) — Drive 연결에 필수 */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Google API 키 — Drive Picker(기존 파일 선택)에만 필요 */
  readonly VITE_GOOGLE_API_KEY?: string;
  /** Google Cloud 프로젝트 번호 — Drive Picker에만 필요 */
  readonly VITE_GOOGLE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
