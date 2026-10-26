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
export const SCHEMA_VERSION = 3;

export interface Analysis {
  summary: string;
  topic: string;
  keywords: string[];
  relevance: number;
  rationale: string;
  connection: string;
  insights: string[];
  citationCandidate: string;
  // v3: Claude 실제 분석 결과
  method?: string; // 연구 방법
  findings?: string; // 주요 결과
  limitations?: string; // 한계
  usageIdea?: string; // 내 논문에서 쓸 위치·방법 제안
  model?: string;
  analyzedAt?: string;
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
  // ── v3 추가 필드 ──
  projectId?: string; // 소속 연구 프로젝트(라이브러리 폴더). 없으면 '미분류'
  abstract?: string; // 초록 (KCI PDF 등에서 추출)
  importedFrom?: 'KCI PDF' | 'PDF' | 'Google Drive' | 'Obsidian' | '직접 입력';
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

/** 연구 프로젝트 = 논문 주제 단위. 라이브러리 폴더 · Obsidian/Drive 폴더와 1:1로 대응한다. */
export interface Project {
  id: string;
  name: string; // 폴더 이름으로도 사용
  topic: string; // 논문 주제
  keywords: string[];
  overview: string;
  defaultView: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  // 학위논문 정보 (AI 집필 · HWPX 표지에 사용)
  degree: '석사' | '박사';
  department: string; // 학과
  advisor: string; // 지도교수
  student: string; // 성명 (국문)
  studentEn: string; // 성명 (영문)
  departmentEn: string;
  // 외부 폴더 생성 기록
  driveFolderId?: string;
  driveCreatedAt?: string;
  obsidianPath?: string;
  obsidianCreatedAt?: string;
}
export const PROJECT_STATUSES = ['진행 중', '집필 중', '완료', '보류'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** 프로젝트 이력 (생성 · 자료 추가 · 분석 · 집필 · 폴더 생성 등) */
export interface ProjectEvent {
  id: string;
  projectId: string;
  at: string;
  kind: '생성' | '수정' | '자료' | '분석' | '집필' | '내보내기' | '연동';
  text: string;
}

export const AI_OUTPUT_KINDS = ['전체 분석', '개별 분석', '목차 제안', '집필 초안', '학위논문 HWPX'] as const;
export type AiOutputKind = (typeof AI_OUTPUT_KINDS)[number];

/**
 * AI가 만든 결과물. 연구자료(원본) 라이브러리와 섞지 않고 따로 보관한다.
 * Google Drive에는 프로젝트의 'AI 생성' 폴더에 따로 저장한다.
 */
export interface AiOutput {
  id: string;
  projectId: string;
  kind: AiOutputKind;
  title: string;
  createdAt: string;
  model: string;
  content: string; // Markdown
  materialIds: string[]; // 근거로 쓴 자료
  driveFileId?: string;
  driveSyncedAt?: string;
  obsidianPath?: string;
}

/** 외대 학위논문 집필 상태 (프로젝트별) */
export interface ThesisChapter {
  id: string;
  title: string; // 'Ⅰ. 서론'
  sections: string[]; // '1. 연구의 필요성 및 목적'
  text: string; // 본문 (절 제목은 '## 1. ...' 형식으로 포함)
}
export interface ThesisDraft {
  projectId: string;
  titleKo: string;
  subtitle: string;
  titleEn: string;
  submitYear: string;
  submitMonth: string;
  chapters: ThesisChapter[];
  abstractKo: string;
  abstractEn: string;
  keywordsEn: string;
  materialIds: string[]; // 집필 근거 자료 (참고문헌 목록에도 사용)
  updatedAt: string;
}

export interface AppState {
  materials: Material[];
  /** v2까지의 연구 설정. v3부터는 프로젝트가 대신하며, 새 프로젝트 기본값으로만 쓴다. */
  settings: ResearchSettings;
  writing: WritingState;
  selectedId: string | null;
  projects: Project[];
  currentProjectId: string | null;
  events: ProjectEvent[];
  aiOutputs: AiOutput[];
  theses: ThesisDraft[];
}

export type PageKey =
  | 'home'
  | 'dashboard'
  | 'collect'
  | 'library'
  | 'analysis'
  | 'writing'
  | 'references'
  | 'settings';
