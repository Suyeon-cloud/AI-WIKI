/** KCI Open API 검색 — 인증키가 서버에 있으므로 앱 서버 함수(/api/kci)를 거친다. */
import { supabase } from './supabase';
import type { KciMeta } from './kci';

export type KciField = 'title' | 'keyword' | 'abstract' | 'author';
export const KCI_FIELDS: { key: KciField; label: string }[] = [
  { key: 'title', label: '제목' },
  { key: 'keyword', label: '키워드' },
  { key: 'abstract', label: '초록' },
  { key: 'author', label: '저자' },
];

export interface KciRecord {
  id: string;
  title: string;
  titleEn: string;
  authors: string[];
  journal: string;
  publisher: string;
  year: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  abstractKo: string;
  abstractEn: string;
  citations: number;
}
export interface KciResult {
  total: number;
  page: number;
  pageSize: number;
  items: KciRecord[];
}

export async function searchKci(o: { q: string; field: KciField; page: number; from?: string; to?: string }, signal?: AbortSignal): Promise<KciResult> {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error('Google 계정으로 다시 로그인해 주세요.');
  const query = new URLSearchParams({ q: o.q, field: o.field, page: String(o.page), ...(o.from ? { from: o.from } : {}), ...(o.to ? { to: o.to } : {}) });
  let res: Response;
  try {
    res = await fetch(`/api/kci?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store', signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error('KCI 검색 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }
  const body = (await res.json().catch(() => null)) as (KciResult & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `KCI 검색에 실패했습니다 (HTTP ${res.status}).`);
  return body;
}

/** 검색 결과 → 가져오기 확인 창에서 쓰는 서지 형식. KCI 응답에 주제어가 없어 비워 둔다. */
export const recordToMeta = (r: KciRecord): KciMeta => ({
  title: r.title,
  titleEn: r.titleEn || undefined,
  authors: r.authors,
  year: r.year,
  journal: r.journal,
  volume: r.volume,
  issue: r.issue,
  pages: r.pages,
  publisher: r.publisher,
  doi: r.doi,
  abstractKo: r.abstractKo,
  abstractEn: r.abstractEn,
  keywords: [],
  source: 'api',
});
