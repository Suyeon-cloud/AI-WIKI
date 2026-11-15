/**
 * YouTube 자막 노트(.md, scripts/yt-transcript로 생성)로 기존 YouTube 자료의 빈 필드만 채운다.
 * - youtube_id로 기존 자료와 1:1 짝짓기 (같은 영상 자료가 여럿이거나, 같은 영상 노트가 여럿이면 제외)
 * - 채우는 필드: content(자막 본문)·url·bib.year — 비어 있을 때만. 메모·관점·분석 결과·서지의 다른 항목은 그대로
 */
import type { Bib, Material } from '../types';
import type { TrackKind } from './yt-transcript';

export interface TranscriptNote {
  youtubeId: string;
  title?: string;
  url?: string;
  year?: string;
  kind?: TrackKind;
  lang?: string;
  translated?: boolean;
  /** 자료 본문으로 넣을 노트 본문 (Markdown 가져오기와 같은 내용) */
  content: string;
}
export interface TranscriptFile {
  name: string;
  text: string;
}
export type YtField = 'content' | 'url' | 'year';
export const YT_FIELD_LABEL: Record<YtField, string> = { content: '자막 본문', url: '영상 URL', year: '게시연도' };
export interface YtChange {
  field: YtField;
  before?: string;
  after: string;
}
export interface YtRow {
  file: TranscriptFile;
  note: TranscriptNote;
  material: Material;
  changes: YtChange[];
  /** 이미 값이 있어 유지하는 필드 */
  kept: YtChange[];
}
export type YtSkipReason = 'not-transcript' | 'dup-note' | 'unmatched' | 'dup-material' | 'nothing';
export const YT_SKIP_LABEL: Record<YtSkipReason, string> = {
  'not-transcript': 'YouTube 자막 노트 아님',
  'dup-note': '같은 영상의 노트가 여러 개',
  unmatched: '같은 영상의 기존 자료 없음',
  'dup-material': '같은 영상의 기존 자료가 여러 개',
  nothing: '채울 빈 필드 없음 (기존 값 유지)',
};
export interface YtSkip {
  name: string;
  reason: YtSkipReason;
  youtubeId?: string;
  title?: string;
}
export interface YtPlan {
  rows: YtRow[];
  skipped: YtSkip[];
}

const blank = (s: string | undefined) => !s || !s.trim();

export function diffTranscript(m: Material, n: TranscriptNote): { changes: YtChange[]; kept: YtChange[] } {
  const changes: YtChange[] = [];
  const kept: YtChange[] = [];
  const check = (field: YtField, before: string | undefined, after: string | undefined, same: (a: string, b: string) => boolean) => {
    if (!after) return;
    if (blank(before)) changes.push({ field, after });
    else if (!same(before!.trim(), after)) kept.push({ field, before, after });
  };
  check('content', m.content, n.content, (a, b) => a === b.trim());
  check('url', m.url, n.url, (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, ''));
  check('year', m.bib?.year, n.year, (a, b) => a.slice(0, 4) === b);
  return { changes, kept };
}

/** 승인한 필드만, 반영 직전 자료 기준으로 비어 있을 때만 채우는 patch */
export function transcriptPatch(m: Material, changes: YtChange[]): Partial<Material> {
  const patch: Partial<Material> = {};
  for (const c of changes) {
    if (c.field === 'content' && blank(m.content)) patch.content = c.after;
    if (c.field === 'url' && blank(m.url)) patch.url = c.after;
    if (c.field === 'year' && blank(m.bib?.year)) {
      const bib: Bib = { ...(m.bib ?? { author: '', year: '', publisher: '' }), year: c.after };
      patch.bib = bib;
    }
  }
  return patch;
}

export function planTranscriptEnrich(materials: Material[], files: TranscriptFile[], read: (text: string) => TranscriptNote | undefined): YtPlan {
  const rows: YtRow[] = [];
  const skipped: YtSkip[] = [];
  const notes = files.map((f) => ({ f, n: read(f.text) }));
  const perId = new Map<string, number>();
  for (const { n } of notes) if (n) perId.set(n.youtubeId, (perId.get(n.youtubeId) ?? 0) + 1);
  const byId = new Map<string, Material[]>();
  for (const m of materials) if (m.youtubeId) byId.set(m.youtubeId, [...(byId.get(m.youtubeId) ?? []), m]);
  for (const { f, n } of notes) {
    if (!n) {
      skipped.push({ name: f.name, reason: 'not-transcript' });
      continue;
    }
    const base = { name: f.name, youtubeId: n.youtubeId, title: n.title };
    if ((perId.get(n.youtubeId) ?? 0) > 1) {
      skipped.push({ ...base, reason: 'dup-note' });
      continue;
    }
    const ms = byId.get(n.youtubeId) ?? [];
    if (!ms.length) {
      skipped.push({ ...base, reason: 'unmatched' });
      continue;
    }
    if (ms.length > 1) {
      skipped.push({ ...base, reason: 'dup-material' });
      continue;
    }
    const { changes, kept } = diffTranscript(ms[0], n);
    if (!changes.length) {
      skipped.push({ ...base, title: ms[0].title, reason: 'nothing' });
      continue;
    }
    rows.push({ file: f, note: n, material: ms[0], changes, kept });
  }
  return { rows, skipped };
}

/** 저장 전 확인: 선택한 자료 수와 필드별 변경 수 */
export function summarizeTranscript(rows: YtRow[], approved: Set<string>, fields: Record<string, Set<YtField>>) {
  const byField: Record<YtField, number> = { content: 0, url: 0, year: 0 };
  let count = 0;
  for (const r of rows) {
    if (!approved.has(r.material.id)) continue;
    const p = transcriptPatch(r.material, r.changes.filter((c) => fields[r.material.id]?.has(c.field)));
    const keys = (['content', 'url', 'year'] as const).filter((f) => (f === 'year' ? !!p.bib : p[f] !== undefined));
    if (!keys.length) continue;
    count++;
    for (const k of keys) byField[k]++;
  }
  return { count, byField };
}
