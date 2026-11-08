/**
 * 본문 인용 ↔ 참고문헌 점검 (확인용 경고, 자동 수정 없음).
 * - 괄호형 (홍길동, 2020; Kim & Lee, 2019a, p. 3) 과 서술형 홍길동(2020), Smith et al. (2021), 王小明(2018) 을 찾는다.
 * - 첫 저자(영문은 성, 한글·한자는 전체 이름)와 연도로 자료를 찾는다. 하나로 정해지지 않으면 추측하지 않고 '확인 필요'로 둔다.
 */
import type { Material, ThesisChapter } from '../types';

export interface InTextCitation {
  raw: string;
  chapterId: string;
  narrative: boolean;
  author: string; // 첫 저자 (비교용으로 정리한 값)
  second?: string; // 두 번째 저자 (두 명 인용일 때)
  etAl: boolean;
  year: string; // 4자리
  suffix: string; // 2023a의 'a'
}
export interface CitationMatch extends InTextCitation {
  status: 'matched' | 'ambiguous' | 'unmatched';
  ids: string[]; // matched: 1개, ambiguous: 후보들
  note?: string;
}
export interface CiteReport {
  citations: CitationMatch[];
  /** 괄호형 인용인데 자료를 찾지 못함 */
  unmatched: CitationMatch[];
  /** 후보가 여럿이거나, 인용인지 확실하지 않은 서술형 */
  needsCheck: CitationMatch[];
  /** 본문에 인용됐지만 참고문헌(출력 목록)에 없는 자료 */
  citedNotInRefs: { material: Material; reason: '근거 자료 아님' | '서지 미완성' }[];
  /** 참고문헌에만 있고 본문에서 인용을 찾지 못한 자료 (후보로만 걸린 자료는 제외) */
  refsNotCited: Material[];
  /** AI가 기록한 인용 자료(citedIds)와 실제 본문의 차이 — citedIds가 있는 장만 */
  aiMismatch: { chapterId: string; chapterTitle: string; missingInText: { id: string; title: string }[]; notInAi: { id: string; title: string }[] }[];
}

const LATIN_NAME = "[A-Z][A-Za-z'’\\-]+";
const YEARS = '\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*';
const NARRATIVE: { re: RegExp; etAl: RegExp }[] = [
  { re: new RegExp(`\\b(${LATIN_NAME})((?:\\s+et\\s+al\\.?)|(?:\\s+(?:and|&)\\s+${LATIN_NAME}))?\\s*\\((${YEARS})\\)`, 'g'), etAl: /et\s+al/ },
  { re: new RegExp(`(?<![가-힣])([가-힣]{2,4})(\\s*외)?\\s*\\((${YEARS})\\)`, 'g'), etAl: /외/ },
  { re: new RegExp(`(?<![\\u3400-\\u9fff])([\\u3400-\\u9fff]{2,4})(\\s*等)?\\s*\\((${YEARS})\\)`, 'g'), etAl: /等/ },
];
const PAREN = /\(([^()]{1,300})\)/g;
const YEAR_TOKEN = /\b(\d{4})([a-z]?)\b/g;

const isHanCjk = (s: string) => /^[가-힣㐀-鿿]+$/.test(s);
/** 비교용 이름: 영문은 소문자 성, 한글·한자는 공백 없는 전체 이름 */
function nameKey(s: string): string {
  const t = s.normalize('NFC').replace(/\(.*?\)/g, '').trim();
  if (!t) return '';
  const compact = t.replace(/\s+/g, '');
  if (isHanCjk(compact)) return compact;
  const surname = t.includes(',') ? t.split(',')[0] : t.split(/\s+/).pop()!;
  return surname.replace(/[^A-Za-z'’\-]/g, '').toLowerCase();
}
/** 인용 속 저자 문자열 → 첫 저자·두 번째 저자·'외/et al.' */
function splitAuthors(s: string): { author: string; second?: string; etAl: boolean } {
  const etAl = /(et\s+al\.?|외|等)/.test(s);
  const clean = s.replace(/et\s+al\.?|외|等/g, ' ').trim();
  const parts = clean.split(/\s*(?:,|&|\band\b|·|ㆍ|및)\s*/).map((x) => x.trim()).filter(Boolean);
  const key = (x: string) => (isHanCjk(x.replace(/\s+/g, '')) ? x.replace(/\s+/g, '') : (x.split(/\s+/)[0] ?? '').replace(/[^A-Za-z'’\-]/g, '').toLowerCase());
  return { author: key(parts[0] ?? ''), second: parts[1] ? key(parts[1]) : undefined, etAl };
}

/** 장 본문에서 인용 찾기 */
export function extractCitations(text: string, chapterId = ''): InTextCitation[] {
  const out: InTextCitation[] = [];
  for (const { re, etAl } of NARRATIVE) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      const extra = m[2] ?? '';
      const second = /(?:and|&)\s+(.+)$/.exec(extra.trim())?.[1];
      for (const y of m[3].matchAll(YEAR_TOKEN)) {
        out.push({ raw: m[0], chapterId, narrative: true, author: nameKey(name), second: second ? nameKey(second) : undefined, etAl: etAl.test(extra), year: y[1], suffix: y[2] });
      }
    }
  }
  for (const m of text.matchAll(PAREN)) {
    for (const part0 of m[1].split(';')) {
      const part = part0.replace(/,?\s*pp?\.\s*[\d\-–]+/g, '').replace(/,?\s*\d+(?:[-–]\d+)?\s*쪽/g, '').trim();
      const first = /\b\d{4}[a-z]?\b/.exec(part);
      if (!first) continue;
      const authorText = part.slice(0, first.index).replace(/[,\s]+$/, '').trim();
      if (!authorText || !/[A-Za-z가-힣㐀-鿿]/.test(authorText)) continue; // 연도만 있는 괄호 = 서술형에서 처리
      const a = splitAuthors(authorText);
      for (const y of part.slice(first.index).matchAll(YEAR_TOKEN)) out.push({ raw: `(${m[1].trim()})`, chapterId, narrative: false, ...a, year: y[1], suffix: y[2] });
    }
  }
  return out;
}

function materialKeys(m: Material) {
  const authors = m.bib?.authors?.length ? m.bib.authors : (m.bib?.author ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  const y = /^(\d{4})([a-z]?)/.exec(m.bib?.year ?? '');
  return { first: authors[0] ? nameKey(authors[0]) : '', second: authors[1] ? nameKey(authors[1]) : '', year: y?.[1] ?? '', suffix: y?.[2] ?? '' };
}

export function matchCitation(c: InTextCitation, materials: Material[]): CitationMatch {
  if (!c.author) return { ...c, status: 'unmatched', ids: [] };
  const keyed = materials.map((m) => ({ m, k: materialKeys(m) })).filter((x) => x.k.first && x.k.first === c.author);
  let cands = keyed.filter((x) => x.k.year === c.year);
  if (!cands.length) {
    const note = keyed.length ? `같은 저자의 자료는 있으나 ${c.year}년 자료가 없음` : undefined;
    return { ...c, status: 'unmatched', ids: [], note };
  }
  if (cands.length > 1 && c.second) {
    const bySecond = cands.filter((x) => x.k.second === c.second);
    if (bySecond.length) cands = bySecond;
  }
  if (c.suffix) {
    const exact = cands.filter((x) => x.k.suffix === c.suffix);
    if (exact.length === 1) return { ...c, status: 'matched', ids: [exact[0].m.id] };
    const why = cands.length === 1 ? `${c.year}${c.suffix}로 인용됐지만 같은 해 자료가 1건뿐 (연도 표기 확인)` : `${c.year}${c.suffix}를 구분할 연도 표기(a/b)가 자료에 없음`;
    return { ...c, status: 'ambiguous', ids: cands.map((x) => x.m.id), note: why };
  }
  if (cands.length === 1) return { ...c, status: 'matched', ids: [cands[0].m.id] };
  return { ...c, status: 'ambiguous', ids: cands.map((x) => x.m.id), note: `같은 저자·연도 자료 ${cands.length}건 (동명 저자이거나 a/b 표기 필요)` };
}

export function checkCitations(chapters: ThesisChapter[], materials: Material[], refIds: Set<string>, basisIds: Set<string>): CiteReport {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const citations = chapters.flatMap((ch) => extractCitations(ch.text, ch.id).map((c) => matchCitation(c, materials)));
  const matched = new Set(citations.filter((c) => c.status === 'matched').flatMap((c) => c.ids));
  const maybe = new Set(citations.filter((c) => c.status === 'ambiguous').flatMap((c) => c.ids));

  const unmatched = citations.filter((c) => c.status === 'unmatched' && !c.narrative);
  // 서술형인데 자료가 없으면 인용이 아닐 수도 있다(예: '선행연구(2020)') → 단정하지 않고 확인 필요
  const needsCheck = citations.filter((c) => c.status === 'ambiguous' || (c.status === 'unmatched' && c.narrative));
  const citedNotInRefs = [...matched].filter((id) => !refIds.has(id) && byId.has(id))
    .map((id) => ({ material: byId.get(id)!, reason: basisIds.has(id) ? ('서지 미완성' as const) : ('근거 자료 아님' as const) }));
  const refsNotCited = [...refIds].filter((id) => !matched.has(id) && !maybe.has(id)).map((id) => byId.get(id)).filter((m): m is Material => !!m);

  const label = (id: string) => ({ id, title: byId.get(id)?.title ?? '(목록에 없는 자료)' });
  const aiMismatch = chapters.filter((ch) => Array.isArray(ch.citedIds)).map((ch) => {
    const inText = citations.filter((c) => c.chapterId === ch.id);
    const found = new Set(inText.filter((c) => c.status === 'matched').flatMap((c) => c.ids));
    const possible = new Set(inText.filter((c) => c.status === 'ambiguous').flatMap((c) => c.ids));
    const ai = new Set(ch.citedIds);
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      missingInText: [...ai].filter((id) => !found.has(id) && !possible.has(id)).map(label),
      notInAi: [...found].filter((id) => !ai.has(id)).map(label),
    };
  }).filter((x) => x.missingInText.length || x.notInAi.length);

  return { citations, unmatched, needsCheck, citedNotInRefs, refsNotCited, aiMismatch };
}
