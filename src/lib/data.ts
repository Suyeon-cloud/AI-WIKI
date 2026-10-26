/**
 * 데이터 보존·호환 계층.
 * - 저장 자료/가져온 자료를 검증하여 Material로 정규화 (알 수 없는 값은 버리고 기본값 사용)
 * - v1 localStorage 자료를 v2로 변환
 * - 전체 상태 백업 파일 생성·검증
 * - 가져오기 전 추가/갱신/충돌/중복 계획 수립
 */
import {
  SCHEMA_VERSION,
  USAGE_SECTIONS,
  type UsageSection,
  type Analysis,
  type AppState,
  type Bib,
  type DraftVersion,
  type ExternalLinks,
  type Material,
  type Origin,
  type Para,
  type ResearchSettings,
  type SourceType,
  type TranscriptSummary,
  type ViewStatus,
  type WritingState,
} from '../types';
import { DEFAULT_SETTINGS, DEFAULT_WRITING } from '../data/sample';
import { PARAS, SOURCE_TYPES, uid } from './utils';
import { bibStatusOf, isRefType, normalizeDoi } from './citation';
import { aiMaterialToOutput, listOf, newProject, normalizeAiOutput, normalizeEvent, normalizeProject, normalizeThesis } from './projects';

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const nonEmpty = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined);
const strArr = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v) => v != null && v !== '').map((v) => String(v).trim()).filter(Boolean) : [];
const isoDate = (x: unknown): string | undefined => {
  if (typeof x !== 'string' || !x.trim()) return undefined;
  const t = Date.parse(x);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

export function clampRel(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
}

const ORIGINS: Origin[] = ['원본 자료', 'AI 생성 자료'];
const VIEW_STATUSES: ViewStatus[] = ['미작성', '작성 중', '검토 완료'];

function normAnalysis(x: unknown): Analysis | undefined {
  if (!isObj(x) || typeof x.summary !== 'string') return undefined;
  return {
    summary: x.summary,
    topic: str(x.topic) ?? '',
    keywords: strArr(x.keywords),
    relevance: clampRel(x.relevance),
    rationale: str(x.rationale) ?? '',
    connection: str(x.connection) ?? '',
    insights: strArr(x.insights),
    citationCandidate: str(x.citationCandidate) ?? '',
    method: nonEmpty(x.method),
    findings: nonEmpty(x.findings),
    limitations: nonEmpty(x.limitations),
    usageIdea: nonEmpty(x.usageIdea),
    model: nonEmpty(x.model),
    analyzedAt: isoDate(x.analyzedAt),
  };
}

function normTranscript(x: unknown): TranscriptSummary | undefined {
  if (!isObj(x)) return undefined;
  const segments = Array.isArray(x.segments)
    ? x.segments.filter(isObj).map((s) => ({ time: String(s.time ?? ''), text: String(s.text ?? '') }))
    : [];
  const points = strArr(x.points);
  return points.length || segments.length ? { points, segments } : undefined;
}

/** 사람 목록: 배열 또는 줄바꿈·';'·'·'로 구분된 문자열 (쉼표는 '성, 이름'에 쓰이므로 구분자로 보지 않음) */
function people(v: unknown): string[] {
  if (Array.isArray(v)) return strArr(v);
  return typeof v === 'string' ? v.split(/\r?\n|;|·/).map((a) => a.trim()).filter(Boolean) : [];
}

/** 서지정보 정규화. v1 형식({author, year, publisher})도 그대로 받아들인다. */
export function normBib(x: unknown): Bib | undefined {
  if (!isObj(x)) return undefined;
  const authors = people(x.authors).length ? people(x.authors) : people(x.author);
  const t = (k: string) => (x[k] == null ? undefined : String(x[k]).trim() || undefined);
  const bib: Bib = {
    author: authors.join('; '),
    year: t('year') ?? '',
    publisher: t('publisher') ?? '',
    type: isRefType(x.type) ? x.type : undefined,
    authors: authors.length ? authors : undefined,
    title: t('title'),
    container: t('container'),
    volume: t('volume'),
    issue: t('issue'),
    pages: t('pages'),
    edition: t('edition'),
    editors: people(x.editors).length ? people(x.editors) : undefined,
    place: t('place'),
    degree: x.degree === '석사' || x.degree === '박사' ? x.degree : undefined,
    doi: normalizeDoi(t('doi')) || undefined,
    url: t('url'),
    accessed: t('accessed'),
  };
  const out = dropUndefined(bib as unknown as Obj) as unknown as Bib;
  const meaningful = Object.entries(out).some(([k, v]) => !['author', 'year', 'publisher'].includes(k) || v !== '');
  return meaningful ? out : undefined;
}

function normExternal(x: unknown): ExternalLinks | undefined {
  if (!isObj(x)) return undefined;
  const e: ExternalLinks = {
    driveFileId: nonEmpty(x.driveFileId),
    driveModifiedAt: isoDate(x.driveModifiedAt),
    driveSyncedAt: isoDate(x.driveSyncedAt),
    obsidianPath: nonEmpty(x.obsidianPath),
    obsidianSyncedAt: isoDate(x.obsidianSyncedAt),
  };
  return dropUndefined(e as Obj) as ExternalLinks | undefined;
}

function dropUndefined<T extends Obj>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

/** 논문 활용 위치: 배열 또는 쉼표 구분 문자열, 알 수 없는 값은 버림, 순서는 USAGE_SECTIONS 기준 */
function normUsage(x: unknown): UsageSection[] | undefined {
  const raw = Array.isArray(x) ? x.map(String) : typeof x === 'string' ? x.split(',') : [];
  const set = new Set(raw.map((s) => s.trim()));
  const out = USAGE_SECTIONS.filter((u) => set.has(u));
  return out.length ? out : undefined;
}

/** 내 관점 상태를 실제 내용과 일치시킨다. 내용이 없으면 항상 '미작성'. */
export function deriveViewStatus(myView: string | undefined, status: unknown): ViewStatus {
  if (!myView?.trim()) return '미작성';
  return VIEW_STATUSES.includes(status as ViewStatus) && status !== '미작성' ? (status as ViewStatus) : '작성 중';
}

/**
 * 임의의 값(저장 자료, JSON, frontmatter 결과)을 Material로 정규화.
 * 제목이 없으면 fallbackTitle, 그것도 없으면 null(가져오기 오류).
 */
export function normalizeMaterial(x: unknown, fallbackTitle?: string): Material | null {
  if (!isObj(x)) return null;
  const title = nonEmpty(x.title)?.trim() ?? fallbackTitle;
  if (!title) return null;
  const createdAt = isoDate(x.createdAt) ?? new Date().toISOString();
  const myView = nonEmpty(x.myView);
  const bib = normBib(x.bib);
  const fileSize = Number(x.fileSize);
  const m: Material = {
    id: nonEmpty(x.id)?.trim() ?? uid(),
    title,
    sourceType: SOURCE_TYPES.includes(x.sourceType as SourceType) ? (x.sourceType as SourceType) : 'JSON',
    origin: ORIGINS.includes(x.origin as Origin) ? (x.origin as Origin) : '원본 자료',
    topic: str(x.topic) ?? '',
    keywords: Array.from(new Set(strArr(x.keywords))),
    relevance: clampRel(x.relevance),
    para: PARAS.includes(x.para as Para) ? (x.para as Para) : 'Resources',
    createdAt,
    url: nonEmpty(x.url),
    youtubeId: nonEmpty(x.youtubeId),
    fileName: nonEmpty(x.fileName),
    fileSize: x.fileSize != null && Number.isFinite(fileSize) && fileSize >= 0 ? fileSize : undefined,
    mimeType: nonEmpty(x.mimeType),
    content: nonEmpty(x.content),
    isSample: x.isSample === true ? true : undefined,
    analysis: normAnalysis(x.analysis),
    myView,
    transcript: normTranscript(x.transcript),
    bibStatus: '서지정보 확인 필요', // 아래에서 서지정보 검증 결과로 다시 정함
    bib,
    citationIncluded: x.citationIncluded === true,
    updatedAt: isoDate(x.updatedAt) ?? createdAt,
    viewStatus: deriveViewStatus(myView, x.viewStatus),
    researchMemo: nonEmpty(x.researchMemo),
    researchLink: nonEmpty(x.researchLink),
    usage: normUsage(x.usage),
    external: normExternal(x.external),
    projectId: nonEmpty(x.projectId),
    abstract: nonEmpty(x.abstract),
    importedFrom: (['KCI PDF', 'PDF', 'Google Drive', 'Obsidian', '직접 입력'] as const).find((v) => v === x.importedFrom),
  };
  // 저장된 상태값을 믿지 않고 서지정보 내용으로 판단 (유형별 필수 항목이 모두 있어야 '입력됨')
  m.bibStatus = bibStatusOf(m);
  return dropUndefined(m as unknown as Obj) as unknown as Material;
}

export function normalizeSettings(x: unknown): ResearchSettings {
  const base = DEFAULT_SETTINGS;
  if (!isObj(x)) return base;
  const kws = Array.isArray(x.keywords) ? x.keywords.map((k) => (k == null ? '' : String(k))) : base.keywords;
  return {
    topic: nonEmpty(x.topic) ?? base.topic,
    keywords: [...kws, '', '', '', '', ''].slice(0, Math.max(5, kws.length)),
    overview: str(x.overview) ?? base.overview,
    defaultView: str(x.defaultView) ?? base.defaultView,
  };
}

export function normalizeWriting(x: unknown): WritingState {
  const base = DEFAULT_WRITING;
  if (!isObj(x)) return base;
  const len = Number(x.length);
  const history: DraftVersion[] = Array.isArray(x.history)
    ? x.history.filter(isObj).filter((h) => typeof h.text === 'string').map((h) => ({
        id: nonEmpty(h.id) ?? uid(),
        at: isoDate(h.at) ?? new Date().toISOString(),
        label: str(h.label) ?? '',
        text: h.text as string,
      }))
    : base.history;
  return {
    docType: nonEmpty(x.docType) ?? base.docType,
    depth: nonEmpty(x.depth) ?? base.depth,
    length: Number.isFinite(len) && len > 0 ? len : base.length,
    outline: Array.isArray(x.outline) ? x.outline.map(String) : base.outline,
    selectedSection: str(x.selectedSection) ?? base.selectedSection,
    text: str(x.text) ?? base.text,
    feedback: Array.isArray(x.feedback) ? x.feedback.map(String) : base.feedback,
    history,
  };
}

/* ───────── 전체 상태 (localStorage · 백업 공통) ───────── */

export interface StateParseResult {
  state: AppState;
  fromVersion: number;
  dropped: number; // 검증 실패로 제외된 자료 수
  hasWriting: boolean;
  hasSettings: boolean;
}

/** v1(버전 표시 없음) 또는 v2 전체 상태를 검증해 AppState로 변환. 자료 배열이 없으면 오류. */
export function parseFullState(x: unknown): StateParseResult {
  if (!isObj(x) || !Array.isArray(x.materials)) throw new Error('자료 목록(materials)이 없는 파일입니다.');
  const fromVersion = typeof x.schemaVersion === 'number' ? x.schemaVersion : 1;
  if (fromVersion > SCHEMA_VERSION)
    throw new Error(`더 새로운 버전(v${fromVersion})의 데이터입니다. 앱을 업데이트한 뒤 가져오세요.`);
  const seen = new Set<string>();
  const materials: Material[] = [];
  let dropped = 0;
  for (const raw of x.materials) {
    const m = normalizeMaterial(raw);
    if (!m) {
      dropped++;
      continue;
    }
    if (seen.has(m.id)) m.id = uid(); // 백업 안에서 ID가 겹치면 자료를 잃지 않도록 새 ID 부여
    seen.add(m.id);
    materials.push(m);
  }
  const settings = normalizeSettings(x.settings);
  const projects = listOf(x.projects, normalizeProject);
  const events = listOf(x.events, normalizeEvent);
  const aiOutputs = listOf(x.aiOutputs, normalizeAiOutput);
  const theses = listOf(x.theses, normalizeThesis);

  // v2 이하: 기존 연구 설정으로 첫 프로젝트를 만들고 모든 자료를 그 폴더에 넣는다.
  if (fromVersion < 3 && !projects.length && (materials.length || isObj(x.settings))) {
    const p = newProject({
      name: settings.topic,
      topic: settings.topic,
      keywords: settings.keywords.filter((k) => k.trim()),
      overview: settings.overview,
      defaultView: settings.defaultView,
    });
    projects.push(p);
    events.push({ id: uid(), projectId: p.id, at: p.createdAt, kind: '생성', text: '이전 버전 데이터에서 프로젝트를 만들었습니다.' });
    for (const m of materials) m.projectId ??= p.id;
  }
  // AI가 만든 자료는 라이브러리(원본 자료)에 두지 않고 AI 산출물로 옮긴다.
  const kept: Material[] = [];
  for (const m of materials) {
    const pid = m.projectId ?? projects[0]?.id;
    if (m.origin === 'AI 생성 자료' && pid) aiOutputs.push(aiMaterialToOutput(m, pid));
    else kept.push(m);
  }
  const keptIds = new Set(kept.map((m) => m.id));
  const selectedId = typeof x.selectedId === 'string' && keptIds.has(x.selectedId) ? x.selectedId : null;
  const currentProjectId =
    typeof x.currentProjectId === 'string' && projects.some((p) => p.id === x.currentProjectId) ? x.currentProjectId : (projects[0]?.id ?? null);
  return {
    state: { materials: kept, settings, writing: normalizeWriting(x.writing), selectedId, projects, currentProjectId, events, aiOutputs, theses },
    fromVersion,
    dropped,
    hasWriting: isObj(x.writing),
    hasSettings: isObj(x.settings),
  };
}

export const BACKUP_KIND = 'ai-wiki-backup';

export function buildBackup(state: AppState) {
  return {
    app: 'AI WIKI',
    kind: BACKUP_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    writing: state.writing,
    selectedId: state.selectedId,
    materials: state.materials,
    projects: state.projects,
    currentProjectId: state.currentProjectId,
    events: state.events,
    aiOutputs: state.aiOutputs,
    theses: state.theses,
  };
}

/** 전체 백업 파일인지 판단 — 신규 형식(kind) 또는 기존 v1 '전체 JSON 백업'({app, settings, materials}) */
export function isFullBackup(x: unknown): boolean {
  return isObj(x) && Array.isArray(x.materials) && (x.kind === BACKUP_KIND || isObj(x.settings) || isObj(x.writing));
}

/* ───────── 가져오기 계획 ───────── */

export type ImportStatus = 'add' | 'update' | 'same' | 'conflict' | 'duplicate';

export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  add: '추가',
  update: '갱신',
  same: '변경 없음',
  conflict: '충돌',
  duplicate: '중복 의심',
};

export interface ImportItem {
  status: ImportStatus;
  incoming: Material; // 가져온 내용 (갱신/충돌이면 기존 자료와 병합된 결과)
  existing?: Material;
  source: string; // 원본 파일명
  reason?: string;
}

export interface ImportError {
  file: string;
  message: string;
}

/** 키 순서와 무관하게 비교하기 위한 직렬화 */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (isObj(x))
    return `{${Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

const withoutTimestamps = (m: Material) => ({ ...m, updatedAt: undefined });

/** ID가 다른 자료 간 중복 판단 키: URL → YouTube ID → 파일명+크기 → 제목+유형 */
export function duplicateKeys(m: Material): string[] {
  const keys: string[] = [];
  if (m.url) keys.push(`url:${m.url.trim().replace(/\/+$/, '').toLowerCase()}`);
  if (m.youtubeId) keys.push(`yt:${m.youtubeId}`);
  if (m.fileName && m.fileSize != null) keys.push(`file:${m.fileName.toLowerCase()}:${m.fileSize}`);
  keys.push(`title:${m.sourceType}:${m.title.trim().replace(/\s+/g, ' ').toLowerCase()}`);
  return keys;
}

/** 원본 객체에 실제로 있던 키만 남긴다 (없는 키를 기본값으로 채워 기존 값을 덮어쓰지 않도록) */
export function pickPresent(raw: unknown, m: Material): Partial<Material> {
  if (!isObj(raw)) return m;
  const out: Partial<Material> = {};
  for (const k of Object.keys(m) as (keyof Material)[]) if (k in raw) (out as Obj)[k] = m[k];
  return out;
}

/** 가져온 값이 있는 필드만 기존 자료 위에 덮어쓴다 (가져온 쪽에 없는 분석·관점 등은 유지). */
export function mergeMaterial(existing: Material, incoming: Partial<Material>): Material {
  const defined = Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined));
  return normalizeMaterial({ ...existing, ...defined, id: existing.id }) ?? existing;
}

/**
 * 가져올 자료를 현재 자료와 비교해 상태를 정한다.
 * - 같은 ID: 내용 동일 → 변경 없음 / 가져온 쪽이 같거나 최신 → 갱신 / 현재 자료가 더 최신 → 충돌
 * - 다른 ID지만 URL·파일·제목이 같음 → 중복 의심
 * - 그 외 → 추가 (가져온 ID 유지)
 */
export function planImport(
  existing: Material[],
  incoming: { partial: Partial<Material>; source: string; fallbackTitle: string }[],
  /** 중복 의심(URL·파일·제목) 판단 범위 — 지정하면 이 자료들과만 비교 (예: 현재 프로젝트 자료) */
  duplicateScope: Material[] = existing,
): { items: ImportItem[]; errors: ImportError[] } {
  const byId = new Map(existing.map((m) => [m.id, m]));
  const keyOwner = new Map<string, Material>();
  for (const m of duplicateScope) for (const k of duplicateKeys(m)) if (!keyOwner.has(k)) keyOwner.set(k, m);

  const items: ImportItem[] = [];
  const errors: ImportError[] = [];
  const batchIds = new Map<string, number>(); // 같은 가져오기 안의 중복 ID → 마지막 항목 사용

  for (const { partial, source, fallbackTitle } of incoming) {
    const hasId = typeof partial.id === 'string' && partial.id.trim() !== '';
    const cur = hasId ? byId.get(partial.id!) : undefined;
    let item: ImportItem;
    if (cur) {
      const merged = mergeMaterial(cur, partial);
      if (canonical(withoutTimestamps(merged)) === canonical(withoutTimestamps(cur))) {
        item = { status: 'same', incoming: merged, existing: cur, source };
      } else {
        const inT = partial.updatedAt ? Date.parse(partial.updatedAt) : NaN;
        const curT = cur.updatedAt ? Date.parse(cur.updatedAt) : NaN;
        const localNewer = Number.isNaN(inT) || (!Number.isNaN(curT) && curT > inT);
        item = localNewer
          ? {
              status: 'conflict',
              incoming: { ...merged, updatedAt: partial.updatedAt ?? merged.updatedAt },
              existing: cur,
              source,
              reason: Number.isNaN(inT) ? '가져온 자료에 수정일이 없음' : '현재 자료가 더 최근에 수정됨',
            }
          : { status: 'update', incoming: { ...merged, updatedAt: partial.updatedAt ?? merged.updatedAt }, existing: cur, source };
      }
    } else {
      const m = normalizeMaterial(partial, fallbackTitle);
      if (!m) {
        errors.push({ file: source, message: '제목이 없는 항목' });
        continue;
      }
      const dupOf = duplicateKeys(m).map((k) => keyOwner.get(k)).find(Boolean);
      item = dupOf
        ? { status: 'duplicate', incoming: m, existing: dupOf, source, reason: `기존 자료 "${dupOf.title}"와 같은 URL·파일·제목` }
        : { status: 'add', incoming: m, source };
    }
    const prev = batchIds.get(item.incoming.id);
    if (prev != null) {
      errors.push({ file: source, message: `같은 ID(${item.incoming.id})가 여러 번 포함되어 마지막 항목만 사용` });
      items[prev] = item;
    } else {
      batchIds.set(item.incoming.id, items.length);
      items.push(item);
    }
  }
  return { items, errors };
}

export type ConflictPolicy = 'keep' | 'overwrite' | 'copy';
export type DuplicatePolicy = 'skip' | 'add';

/** 계획과 사용자의 선택을 실제로 반영할 자료 목록으로 변환 */
export function resolveImport(
  items: ImportItem[],
  conflict: ConflictPolicy,
  duplicate: DuplicatePolicy,
): { add: Material[]; update: Material[] } {
  const add: Material[] = [];
  const update: Material[] = [];
  const now = new Date().toISOString();
  for (const it of items) {
    if (it.status === 'add') add.push(it.incoming);
    else if (it.status === 'update') update.push(it.incoming);
    else if (it.status === 'conflict') {
      if (conflict === 'overwrite') update.push({ ...it.incoming, updatedAt: now });
      else if (conflict === 'copy') add.push({ ...it.incoming, id: uid(), title: `${it.incoming.title} (가져온 사본)`, updatedAt: now });
    } else if (it.status === 'duplicate' && duplicate === 'add') {
      add.push(it.incoming);
    }
  }
  return { add, update };
}
