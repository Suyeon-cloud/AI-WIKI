export type SourceType = 'PDF' | 'Web' | 'YouTube' | 'HWPX' | 'Markdown' | 'TXT' | 'JSON';
export type Para = 'Projects' | 'Areas' | 'Resources' | 'Archives';
export type Origin = '원본 자료' | 'AI 생성 자료';
export type BibStatus = '서지정보 확인 필요' | '서지정보 입력됨';
/** 연구자 본인의 관점 작성 상태. AI 문장을 자동으로 '검토 완료'로 바꾸지 않는다. */
export type ViewStatus = '미작성' | '작성 중' | '검토 완료';

/** 논문 활용 위치 */
export const USAGE_SECTIONS = ['선행연구', '이론적 배경', '콘텐츠 설계', '개발 방법', '분석·논의', '기타'] as const;
export type UsageSection = (typeof USAGE_SECTIONS)[number];

/** 관점 작성 완료 여부 — 연구자가 직접 쓴 '나의 관점'이 있으면 완료 */
export const hasMyView = (m: { myView?: string }) => !!m.myView?.trim();

/** 저장 데이터 구조 버전. v1 = 기존 'ai-wiki:v1' 저장 형식 */
export const SCHEMA_VERSION = 2;

export interface Analysis {
  summary: string;
  topic: string;
  keywords: string[];
  relevance: number;
  rationale: string;
  connection: string;
  insights: string[];
  citationCandidate: string;
}

export interface TranscriptSummary {
  points: string[];
  segments: { time: string; text: string }[];
}

export interface Material {
  id: string;
  title: string;
  sourceType: SourceType;
  origin: Origin;
  topic: string;
  keywords: string[];
  relevance: number; // 1~5
  para: Para;
  createdAt: string; // ISO
  url?: string;
  youtubeId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  content?: string; // 가져온 텍스트/노트 본문
  isSample?: boolean;
  analysis?: Analysis; // Demo 분석 결과
  myView?: string; // 사용자가 직접 작성
  transcript?: TranscriptSummary; // Demo 자막 요약
  bibStatus: BibStatus;
  bib?: Bib; // 사용자가 원문에서 확인해 직접 입력
  citationIncluded: boolean;
  // ── v2 추가 필드 (모두 선택 — 기존 v1 자료와 호환) ──
  updatedAt?: string; // ISO, 마지막 수정 시각 (가져오기 충돌 판단에 사용)
  viewStatus?: ViewStatus; // 내 관점 작성 상태
  researchMemo?: string; // 연구 메모 (AI 요약과 별개로 연구자가 작성)
  researchLink?: string; // 내 연구와의 연결
  usage?: UsageSection[]; // 논문 활용 위치 (복수 선택)
  external?: ExternalLinks; // 외부 연결 정보 (Drive/Obsidian 연동 단계에서 사용)
}

/** 참고문헌 자료 유형 */
export type RefType = 'journal' | 'book' | 'chapter' | 'thesis' | 'report' | 'web' | 'video';

/**
 * 서지정보. author·year·publisher는 v1부터 있던 필드로 그대로 유지한다.
 * v2부터 자료 유형과 저자 목록·학술지·권호·쪽·DOI 등을 추가했다 (모두 선택).
 */
export interface Bib {
  author: string; // 표시용 저자 문자열 (authors를 '; '로 연결). v1 자료는 이 값만 있음
  year: string; // 'YYYY', 'YYYYa', 'n.d.'
  publisher: string; // 출판사 · 학위수여기관 · 발행기관 (v1: '학술지/발행처')
  type?: RefType;
  authors?: string[]; // 한 명씩. 영문 개인 저자는 '성, 이름' 형식
  title?: string; // 원문 제목 (비우면 자료 제목 사용)
  container?: string; // 학술지명 · 수록 도서명 · 웹사이트명 · 플랫폼
  volume?: string;
  issue?: string;
  pages?: string; // '45-67' 또는 논문 번호
  edition?: string;
  editors?: string[];
  place?: string; // 출판지
  degree?: '석사' | '박사';
  doi?: string; // '10.xxxx/...' 형식으로 저장
  url?: string; // 비우면 자료 URL 사용
  accessed?: string; // 검색일 YYYY-MM-DD
}

export interface ExternalLinks {
  driveFileId?: string;
  driveModifiedAt?: string;
  driveSyncedAt?: string;
  obsidianPath?: string;
  obsidianSyncedAt?: string;
}

export interface ResearchSettings {
  topic: string;
  keywords: string[]; // 5개
  overview: string;
  defaultView: string;
}

export interface DraftVersion {
  id: string;
  at: string;
  label: string;
  text: string;
}

export interface WritingState {
  docType: string;
  depth: string;
  length: number;
  outline: string[];
  selectedSection: string;
  text: string;
  feedback: string[];
  history: DraftVersion[];
}

export interface AppState {
  materials: Material[];
  settings: ResearchSettings;
  writing: WritingState;
  selectedId: string | null;
}

export type PageKey =
  | 'dashboard'
  | 'collect'
  | 'library'
  | 'analysis'
  | 'writing'
  | 'references'
  | 'settings';
