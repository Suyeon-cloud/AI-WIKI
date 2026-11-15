/** 참고문헌 후보 검색·서지 유형 필터 (화면 표시용, 데이터는 바꾸지 않는다) */
import type { Material, RefType } from '../types';
import { bibAuthors } from './citation';

export type RefTypeFilter = '전체' | '미지정' | RefType;

const norm = (s: string) => s.normalize('NFC').toLowerCase();

/** 서지 유형 필터: '전체'는 모두, '미지정'은 bib.type이 없는 자료 */
export const matchRefType = (m: Pick<Material, 'bib'>, f: RefTypeFilter) =>
  f === '전체' ? true : f === '미지정' ? !m.bib?.type : m.bib?.type === f;

/**
 * 제목·저자·연도 검색. 띄어쓰기로 나눈 낱말이 모두 들어 있어야 맞음 (대소문자 무시).
 * 자료 제목과 서지 제목, 저자 목록·표시용 저자, 발행연도를 본다.
 */
export function matchBibQuery(m: Pick<Material, 'title' | 'bib'>, q: string): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm([m.title, m.bib?.title, ...bibAuthors(m.bib), m.bib?.author, m.bib?.year].filter(Boolean).join('\n'));
  return words.every((w) => hay.includes(w));
}
