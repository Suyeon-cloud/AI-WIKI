/**
 * KCI Open API 검색 — 각 사용자가 입력한 본인 인증키를 앱 서버 함수(/api/kci)를 거쳐 KCI에 전달한다.
 * 키는 이 모듈의 메모리에만 두며, 새로고침·탭 닫기·로그아웃·계정 변경 시 지워진다.
 */
import { supabase } from './supabase';
import { authUser, subscribeAuth } from './auth';
import { createSessionKey } from './session-key';
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

const sessionKey = createSessionKey();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function subscribeKciKey(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const hasKciKey = () => !!sessionKey.get(authUser()?.id ?? null);
subscribeAuth(() => {
  sessionKey.syncOwner(authUser()?.id ?? null);
  emit();
});
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  sessionKey.clear();
  emit();
});
export function setSessionKciKey(value: string) {
  const userId = authUser()?.id;
  if (!userId) throw new Error('먼저 로그인해 주세요.');
  const key = value.trim();
  if (key && !/^[A-Za-z0-9._~-]{4,128}$/.test(key)) throw new Error('KCI 인증키 형식을 확인해 주세요.');
  if (key) sessionKey.set(userId, key);
  else sessionKey.clear();
  emit();
}

export async function searchKci(o: { q: string; field: KciField; page: number; from?: string; to?: string }, signal?: AbortSignal): Promise<KciResult> {
  const kciKey = sessionKey.get(authUser()?.id ?? null);
  if (!kciKey) throw new Error('이 탭에서 사용할 본인 KCI 인증키를 입력해 주세요.');
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error('Google 계정으로 다시 로그인해 주세요.');
  let res: Response;
  try {
    res = await fetch('/api/kci', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ ...o, kciKey }), cache: 'no-store', signal });
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
