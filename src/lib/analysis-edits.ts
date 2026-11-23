import type { Analysis, AnalysisEdits, Material } from '../types';

/** 사용자가 직접 고칠 수 있는 AI 분석 항목. list는 한 줄에 하나씩 입력한다. */
export const EDITABLE_FIELDS = [
  { key: 'summary', label: '요약' },
  { key: 'topic', label: '핵심 주제' },
  { key: 'rationale', label: '관련도 근거' },
  { key: 'method', label: '연구 방법' },
  { key: 'findings', label: '주요 결과' },
  { key: 'connection', label: '내 논문과의 접점' },
  { key: 'insights', label: '인사이트', list: true },
  { key: 'limitations', label: '한계' },
  { key: 'usageIdea', label: '활용 제안' },
  { key: 'citationCandidate', label: '인용 후보' },
  { key: 'keywords', label: '핵심 키워드', list: true },
] as const;
export type EditKey = (typeof EDITABLE_FIELDS)[number]['key'];
const LIST_KEYS = new Set<string>(EDITABLE_FIELDS.filter((f) => 'list' in f).map((f) => f.key));
export const isListKey = (k: EditKey) => LIST_KEYS.has(k);

const same = (x: unknown, y: unknown) => JSON.stringify(x ?? '') === JSON.stringify(y ?? '');

/** AI 원본 값 (수정본과 상관없이 보존된 값) */
export const originalOf = (a: Analysis, k: EditKey): string | string[] => (a[k] ?? (isListKey(k) ? [] : '')) as string | string[];

export const isEmptyValue = (v: string | string[]) => (Array.isArray(v) ? !v.length : !v.trim());

/** 재분석이 끝난 시점의 최신 분석에 수정본이 있으면 돌려준다 (분석 기록에 따로 보관하기 위해) */
export const latestEdited = (ms: Material[], id: string): Analysis | undefined => {
  const a = ms.find((x) => x.id === id)?.analysis;
  return a && editedKeys(a).length ? a : undefined;
};

/** 수정본이 있는 항목 */
export const editedKeys = (a: Analysis): EditKey[] => EDITABLE_FIELDS.map((f) => f.key).filter((k) => a.edits?.[k] !== undefined);

/** 화면·전체 분석·내보내기에 쓰는 값: 수정본이 있으면 수정본, 없으면 AI 원본. 원본 필드는 바꾸지 않는다. */
export function withEdits(a: Analysis): Analysis;
export function withEdits(a: Analysis | undefined): Analysis | undefined;
export function withEdits(a: Analysis | undefined): Analysis | undefined {
  if (!a?.edits || !editedKeys(a).length) return a;
  return { ...a, ...(a.edits as Partial<Analysis>) };
}

/** 항목 하나를 수정한 새 분석. 원본과 같아지면 수정본을 지운다 (원본 필드는 그대로). */
export function setEdit(a: Analysis, k: EditKey, value: string | string[]): Analysis {
  const v = Array.isArray(value) ? value.map((x) => x.trim()).filter(Boolean) : value.trim();
  if (same(v, originalOf(a, k))) return revertEdit(a, k);
  return { ...a, edits: { ...a.edits, [k]: v } as AnalysisEdits, editedAt: new Date().toISOString() };
}

/** 원본으로 되돌리기 */
export function revertEdit(a: Analysis, k: EditKey): Analysis {
  if (!a.edits || a.edits[k] === undefined) return a;
  const { [k]: _drop, ...rest } = a.edits;
  const left = Object.keys(rest).length > 0;
  const { edits: _e, editedAt: _t, ...base } = a;
  return left ? { ...base, edits: rest, editedAt: new Date().toISOString() } : base;
}

/** 저장 데이터에서 읽은 수정본 정리 (알 수 없는 키·잘못된 형식은 버린다) */
export function normEdits(x: unknown): AnalysisEdits | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const { key } of EDITABLE_FIELDS) {
    const v = o[key];
    if (isListKey(key) ? Array.isArray(v) : typeof v === 'string') out[key] = Array.isArray(v) ? v.map(String) : (v as string);
  }
  return Object.keys(out).length ? (out as AnalysisEdits) : undefined;
}
