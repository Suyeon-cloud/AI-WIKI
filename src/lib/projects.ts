/**
 * v3 데이터: 연구 프로젝트 · 프로젝트 이력 · AI 산출물 · 학위논문 집필 상태의 생성·정규화.
 * 저장 데이터·백업 파일에서 읽은 값을 검증해 쓰며, 알 수 없는 값은 버리고 기본값을 사용한다.
 */
import {
  AI_OUTPUT_KINDS,
  PROJECT_STATUSES,
  type AiOutput,
  type Material,
  type Project,
  type ProjectEvent,
  type ThesisChapter,
  type ThesisDraft,
} from '../types';
import { uid } from './utils';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const nonEmpty = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined);
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v) => v != null && v !== '').map((v) => String(v).trim()).filter(Boolean) : []);
const isoDate = (x: unknown): string | undefined => {
  if (typeof x !== 'string' || !x.trim()) return undefined;
  const t = Date.parse(x);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const listOf = <T>(x: unknown, fn: (v: unknown) => T | null): T[] => (Array.isArray(x) ? (x.map(fn).filter(Boolean) as T[]) : []);

export function newProject(p: Partial<Project> & Pick<Project, 'name'>): Project {
  const t = new Date().toISOString();
  return {
    id: uid(),
    topic: p.name,
    keywords: [],
    overview: '',
    defaultView: '',
    status: '진행 중',
    createdAt: t,
    updatedAt: t,
    degree: '석사',
    department: '',
    advisor: '',
    student: '',
    studentEn: '',
    departmentEn: '',
    ...p,
  };
}

export function normalizeProject(x: unknown): Project | null {
  if (!isObj(x)) return null;
  const name = nonEmpty(x.name)?.trim();
  if (!name) return null;
  const createdAt = isoDate(x.createdAt) ?? new Date().toISOString();
  return compact<Project>({
    id: nonEmpty(x.id)?.trim() ?? uid(),
    name,
    topic: str(x.topic) ?? name,
    keywords: strArr(x.keywords),
    overview: str(x.overview) ?? '',
    defaultView: str(x.defaultView) ?? '',
    status: PROJECT_STATUSES.includes(x.status as Project['status']) ? (x.status as Project['status']) : '진행 중',
    createdAt,
    updatedAt: isoDate(x.updatedAt) ?? createdAt,
    degree: x.degree === '박사' ? '박사' : '석사',
    department: str(x.department) ?? '',
    advisor: str(x.advisor) ?? '',
    student: str(x.student) ?? '',
    studentEn: str(x.studentEn) ?? '',
    departmentEn: str(x.departmentEn) ?? '',
    driveFolderId: nonEmpty(x.driveFolderId),
    driveCreatedAt: isoDate(x.driveCreatedAt),
    obsidianPath: nonEmpty(x.obsidianPath),
    obsidianCreatedAt: isoDate(x.obsidianCreatedAt),
  });
}

const EVENT_KINDS: ProjectEvent['kind'][] = ['생성', '수정', '자료', '분석', '집필', '내보내기', '연동'];

export function normalizeEvent(x: unknown): ProjectEvent | null {
  if (!isObj(x) || !nonEmpty(x.projectId) || !nonEmpty(x.text)) return null;
  return {
    id: nonEmpty(x.id) ?? uid(),
    projectId: x.projectId as string,
    at: isoDate(x.at) ?? new Date().toISOString(),
    kind: EVENT_KINDS.includes(x.kind as ProjectEvent['kind']) ? (x.kind as ProjectEvent['kind']) : '수정',
    text: x.text as string,
  };
}

export function normalizeAiOutput(x: unknown): AiOutput | null {
  if (!isObj(x) || typeof x.content !== 'string' || !nonEmpty(x.projectId)) return null;
  return compact<AiOutput>({
    id: nonEmpty(x.id) ?? uid(),
    projectId: x.projectId as string,
    kind: AI_OUTPUT_KINDS.includes(x.kind as AiOutput['kind']) ? (x.kind as AiOutput['kind']) : '전체 분석',
    title: nonEmpty(x.title) ?? 'AI 결과물',
    createdAt: isoDate(x.createdAt) ?? new Date().toISOString(),
    model: str(x.model) ?? '',
    content: x.content,
    materialIds: strArr(x.materialIds),
    driveFileId: nonEmpty(x.driveFileId),
    driveSyncedAt: isoDate(x.driveSyncedAt),
    obsidianPath: nonEmpty(x.obsidianPath),
  });
}

function normalizeChapter(x: unknown): ThesisChapter | null {
  if (!isObj(x) || !nonEmpty(x.title)) return null;
  return { id: nonEmpty(x.id) ?? uid(), title: x.title as string, sections: strArr(x.sections), text: str(x.text) ?? '' };
}

export function emptyThesis(p: Project): ThesisDraft {
  return {
    projectId: p.id,
    titleKo: p.topic,
    subtitle: '',
    titleEn: '',
    submitYear: String(new Date().getFullYear()),
    submitMonth: '12',
    chapters: [],
    abstractKo: '',
    abstractEn: '',
    keywordsEn: '',
    materialIds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeThesis(x: unknown): ThesisDraft | null {
  if (!isObj(x) || !nonEmpty(x.projectId)) return null;
  return {
    projectId: x.projectId as string,
    titleKo: str(x.titleKo) ?? '',
    subtitle: str(x.subtitle) ?? '',
    titleEn: str(x.titleEn) ?? '',
    submitYear: str(x.submitYear) ?? String(new Date().getFullYear()),
    submitMonth: str(x.submitMonth) ?? '12',
    chapters: listOf(x.chapters, normalizeChapter),
    abstractKo: str(x.abstractKo) ?? '',
    abstractEn: str(x.abstractEn) ?? '',
    keywordsEn: str(x.keywordsEn) ?? '',
    materialIds: strArr(x.materialIds),
    updatedAt: isoDate(x.updatedAt) ?? new Date().toISOString(),
  };
}

/** AI가 만든 자료(origin 'AI 생성 자료')를 AI 산출물로 옮긴다 — 원본 자료 라이브러리와 섞이지 않도록 */
export function aiMaterialToOutput(m: Material, projectId: string): AiOutput {
  return {
    id: m.id,
    projectId,
    kind: '전체 분석',
    title: m.title,
    createdAt: m.createdAt,
    model: '',
    content: m.content ?? m.analysis?.summary ?? '',
    materialIds: [],
  };
}

/** 폴더 이름으로 쓸 수 있게 정리 (Obsidian·Drive 공통) */
export const folderName = (p: Pick<Project, 'name'>) =>
  p.name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '연구 프로젝트';

/** 프로젝트 하위 폴더 구성 — Obsidian과 Google Drive에 같은 이름으로 만든다 */
export const PROJECT_SUBFOLDERS = { materials: '자료', ai: 'AI 생성' } as const;
