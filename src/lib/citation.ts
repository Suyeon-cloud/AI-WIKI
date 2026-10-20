/**
 * 참고문헌 서식.
 * - 자료 유형별 필수/권장 항목 검증 (부족하면 '서지정보 확인 필요')
 * - APA 7 · Chicago(저자-연도) · MLA 9 · 국내 학술지 일반형
 * 사용자가 입력한 값만 사용하며, 비어 있는 항목을 추측해 채우지 않는다.
 * 제목의 대소문자 변환은 하지 않으므로 원문 표기대로 입력해야 한다.
 */
import type { Bib, BibStatus, Material, RefType } from '../types';
import { isValidUrl } from './utils';

export const CITATION_STYLES = ['APA 7', 'Chicago', 'MLA 9', '국내 학술지 일반형'] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

export const REF_TYPES: { key: RefType; label: string }[] = [
  { key: 'journal', label: '학술지 논문' },
  { key: 'book', label: '단행본' },
  { key: 'chapter', label: '편저 수록 장' },
  { key: 'thesis', label: '학위논문' },
  { key: 'report', label: '보고서·기관 자료' },
  { key: 'web', label: '웹 문서' },
  { key: 'video', label: '영상 (YouTube 등)' },
];
export const REF_TYPE_LABEL = Object.fromEntries(REF_TYPES.map((t) => [t.key, t.label])) as Record<RefType, string>;
export const isRefType = (x: unknown): x is RefType => REF_TYPES.some((t) => t.key === x);

export type BibField =
  | 'authors' | 'year' | 'title' | 'container' | 'publisher' | 'volume' | 'issue' | 'pages'
  | 'edition' | 'editors' | 'place' | 'degree' | 'doi' | 'url' | 'accessed';

/** 유형별 입력 항목 (화면 표시 순서) */
export const TYPE_FIELDS: Record<RefType, BibField[]> = {
  journal: ['authors', 'year', 'title', 'container', 'volume', 'issue', 'pages', 'publisher', 'doi', 'url'],
  book: ['authors', 'year', 'title', 'edition', 'publisher', 'place', 'doi', 'url'],
  chapter: ['authors', 'year', 'title', 'editors', 'container', 'edition', 'pages', 'publisher', 'place', 'doi'],
  thesis: ['authors', 'year', 'title', 'degree', 'publisher', 'url'],
  report: ['authors', 'year', 'title', 'publisher', 'place', 'url'],
  web: ['authors', 'year', 'title', 'container', 'url', 'accessed'],
  video: ['authors', 'year', 'title', 'container', 'url', 'accessed'],
};

const REQUIRED: Record<RefType, BibField[]> = {
  journal: ['authors', 'year', 'title', 'container', 'volume', 'pages'],
  book: ['authors', 'year', 'title', 'publisher'],
  chapter: ['authors', 'year', 'title', 'editors', 'container', 'pages', 'publisher'],
  thesis: ['authors', 'year', 'title', 'degree', 'publisher'],
  report: ['authors', 'year', 'title', 'publisher'],
  web: ['authors', 'year', 'title', 'container', 'url'],
  video: ['authors', 'year', 'title', 'container', 'url'],
};

const RECOMMENDED: Record<RefType, BibField[]> = {
  journal: ['issue', 'doi'],
  book: ['place'],
  chapter: ['place'],
  thesis: [],
  report: [],
  web: ['accessed'],
  video: [],
};

export function fieldLabel(type: RefType, f: BibField): string {
  switch (f) {
    case 'authors':
      return type === 'video' ? '저자·채널 (한 줄에 하나)' : '저자 (한 줄에 한 명)';
    case 'year':
      return type === 'web' || type === 'video' || type === 'report' ? '발행 연도 (없으면 n.d.)' : '발행 연도';
    case 'title':
      return ({ journal: '논문 제목', book: '도서명', chapter: '장 제목', thesis: '논문 제목', report: '보고서명', web: '문서 제목', video: '영상 제목' } as const)[type];
    case 'container':
      return ({ journal: '학술지명', chapter: '수록 도서명', web: '웹사이트명', video: '플랫폼 (YouTube 등)' } as Record<string, string>)[type] ?? '수록처';
    case 'publisher':
      return ({ journal: '발행 학회 (선택)', thesis: '학위수여기관 (대학교)', report: '발행기관' } as Record<string, string>)[type] ?? '출판사';
    case 'volume':
      return '권';
    case 'issue':
      return '호';
    case 'pages':
      return type === 'journal' ? '쪽 (예: 45-67, 또는 논문 번호)' : '쪽 (예: 45-67)';
    case 'edition':
      return '판 (예: 2)';
    case 'editors':
      return '편저자 (한 줄에 한 명)';
    case 'place':
      return '출판지';
    case 'degree':
      return '학위';
    case 'doi':
      return 'DOI (10.xxxx/...)';
    case 'url':
      return 'URL (비우면 자료 URL)';
    case 'accessed':
      return '검색일';
  }
}

/** 누락 안내용 짧은 이름 — 입력 예시 괄호를 뺀다 (예: '쪽 (예: 45-67)' → '쪽') */
export const fieldName = (type: RefType, f: BibField) => fieldLabel(type, f).replace(/\s*\(.*\)$/, '');

/* ───────── 값 정리 ───────── */

export const hasHangul = (s: string) => /[ㄱ-ㆎ가-힣]/.test(s);
const clean = (s?: string) => (s ?? '').trim();
export const normalizeDoi = (s?: string) =>
  clean(s).replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');

export const bibTitle = (m: Material) => clean(m.bib?.title) || m.title;
export const bibUrl = (m: Material) => clean(m.bib?.url) || m.url || '';
export const bibAuthors = (b?: Bib): string[] =>
  b?.authors?.length ? b.authors.map(clean).filter(Boolean) : clean(b?.author) ? [clean(b?.author)] : [];

function hasField(m: Material, f: BibField): boolean {
  const b = m.bib;
  if (!b) return false;
  switch (f) {
    case 'authors':
      return bibAuthors(b).length > 0;
    case 'editors':
      return (b.editors ?? []).some((e) => clean(e));
    case 'title':
      return !!bibTitle(m);
    case 'url':
      return !!bibUrl(m);
    case 'degree':
      return b.degree === '석사' || b.degree === '박사';
    default:
      return !!clean(b[f]);
  }
}

export interface BibCheck {
  complete: boolean;
  missing: string[]; // 필수 항목 누락·형식 오류 (완성 인용으로 쓰지 않음)
  warnings: string[]; // 권장 항목·확인 사항
}

/** 서지정보가 선택한 유형의 인용을 만들기에 충분한지 확인 */
export function checkBib(m: Material): BibCheck {
  const b = m.bib;
  if (!b || (!bibAuthors(b).length && !clean(b.year) && !clean(b.publisher) && !b.type)) return { complete: false, missing: ['서지정보 미입력'], warnings: [] };
  if (!b.type) return { complete: false, missing: ['자료 유형 미지정'], warnings: ['이전 버전 서지정보입니다. 자료 유형을 고르고 항목을 확인하세요.'] };
  const t = b.type;
  const missing = REQUIRED[t].filter((f) => !hasField(m, f)).map((f) => fieldName(t, f));
  const warnings = RECOMMENDED[t].filter((f) => !hasField(m, f)).map((f) => `${fieldName(t, f)} 권장`);
  const year = clean(b.year);
  if (year && !/^(\d{4}[a-z]?|n\.d\.)$/.test(year)) missing.push('발행 연도 형식 (YYYY 또는 n.d.)');
  else if (year === 'n.d.' && !['web', 'video', 'report'].includes(t)) missing.push('발행 연도 (이 유형은 n.d. 불가)');
  const doi = normalizeDoi(b.doi);
  if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) missing.push('DOI 형식 (10.xxxx/...)');
  const url = bibUrl(m);
  if (url && !isValidUrl(url) && TYPE_FIELDS[t].includes('url')) missing.push('URL 형식');
  if (clean(b.accessed) && !/^\d{4}-\d{2}-\d{2}$/.test(clean(b.accessed))) missing.push('검색일 형식 (YYYY-MM-DD)');
  const people = [...bibAuthors(b), ...(TYPE_FIELDS[t].includes('editors') ? b.editors ?? [] : [])];
  if (people.some((a) => !hasHangul(a) && /\s/.test(clean(a)) && !a.includes(',')))
    warnings.push("쉼표가 없는 영문 이름은 기관명으로 보고 그대로 표기합니다. 개인 저자는 '성, 이름' 형식으로 입력하세요.");
  return { complete: missing.length === 0, missing, warnings };
}

export const bibStatusOf = (m: Material): BibStatus => (checkBib(m).complete ? '서지정보 입력됨' : '서지정보 확인 필요');

/* ───────── 이름 표기 ───────── */

interface Name {
  last: string;
  first: string;
}
/** '성, 이름' 형식의 영문 개인 이름만 분해. 한글 이름·기관명은 null (입력 그대로 사용) */
function splitName(a: string): Name | null {
  const i = a.indexOf(',');
  if (i < 0 || hasHangul(a)) return null;
  return { last: a.slice(0, i).trim(), first: a.slice(i + 1).trim() };
}
const initials = (first: string) =>
  first
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split('-').map((p) => `${p[0].toUpperCase()}.`).join('-'))
    .join(' ');

const apaName = (a: string) => {
  const n = splitName(a);
  return n ? (n.first ? `${n.last}, ${initials(n.first)}` : n.last) : a;
};
const apaEditor = (a: string) => {
  const n = splitName(a);
  return n ? `${n.first ? `${initials(n.first)} ` : ''}${n.last}` : a;
};
const invName = (a: string) => {
  const n = splitName(a);
  return n ? (n.first ? `${n.last}, ${n.first}` : n.last) : a;
};
const plainName = (a: string) => {
  const n = splitName(a);
  return n ? `${n.first} ${n.last}`.trim() : a;
};

const allHangul = (xs: string[]) => xs.every(hasHangul);

function apaAuthors(xs: string[]) {
  const n = xs.map(apaName);
  if (allHangul(xs)) return n.join(', ');
  if (n.length === 1) return n[0];
  if (n.length <= 20) return `${n.slice(0, -1).join(', ')}, & ${n[n.length - 1]}`;
  return `${n.slice(0, 19).join(', ')}, . . . ${n[n.length - 1]}`;
}
function chicagoAuthors(xs: string[]) {
  if (allHangul(xs)) return xs.join(', ');
  const list = xs.length > 10 ? xs.slice(0, 7) : xs;
  const n = list.map((a, i) => (i === 0 ? invName(a) : plainName(a)));
  if (xs.length > 10) return `${n.join(', ')}, et al`;
  if (n.length === 1) return n[0];
  // 첫 저자를 '성, 이름'으로 도치하면 2인이어도 쉼표를 둔다 (Mayer, Richard E., and Roxana Moreno)
  if (n.length === 2) return `${n[0]}${splitName(xs[0]) ? ',' : ''} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')}, and ${n[n.length - 1]}`;
}
function mlaAuthors(xs: string[]) {
  if (allHangul(xs)) return xs.join(', ');
  if (xs.length === 1) return invName(xs[0]);
  if (xs.length === 2) return `${invName(xs[0])}, and ${plainName(xs[1])}`;
  return `${invName(xs[0])}, et al`;
}
function joinAnd(xs: string[], amp = false) {
  if (xs.length <= 1) return xs.join('');
  if (xs.length === 2) return `${xs[0]} ${amp ? '&' : 'and'} ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, ${amp ? '&' : 'and'} ${xs[xs.length - 1]}`;
}

/* ───────── 서식 ───────── */

/** 인용문 조각: 문자열 또는 기울임 */
export type Seg = string | { i: string };
const it = (s: string): Seg => ({ i: s });
/** 기울임 제목 + 마침표 (마침표는 기울이지 않음) */
const itd = (s: string): Seg[] => [it(s), /[.?!]$/.test(s) ? '' : '.'];

const dot = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);
const dash = (p: string) => p.replace(/(\d)\s*[-~–]\s*(\d)/g, '$1–$2');
const doiUrl = (d: string) => `https://doi.org/${d}`;
function edition(e: string, ko: boolean) {
  if (!e) return '';
  if (/^\d+$/.test(e)) {
    const n = Number(e);
    if (ko) return `제${n}판`;
    const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
    return `${n}${suf} ed.`;
  }
  return e;
}
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
function fmtAccessed(d: string, style: 'mla' | 'ko' | 'en') {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  if (style === 'ko') return `${m[1]}.${m[2]}.${m[3]}`;
  if (style === 'mla') return `${Number(m[3])} ${MLA_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return d;
}

interface Ctx {
  t: RefType;
  authors: string[];
  year: string;
  title: string;
  container: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  edition: string;
  editors: string[];
  place: string;
  degree: string;
  doi: string;
  url: string;
  accessed: string;
  ko: boolean; // 제목이 한글인지 (APA 학위논문·판 표기 등)
}

function ctxOf(m: Material): Ctx {
  const b = m.bib!;
  const title = bibTitle(m);
  return {
    t: b.type!,
    authors: bibAuthors(b),
    year: clean(b.year),
    title,
    container: clean(b.container),
    publisher: clean(b.publisher),
    volume: clean(b.volume),
    issue: clean(b.issue),
    pages: clean(b.pages),
    edition: clean(b.edition),
    editors: (b.editors ?? []).map(clean).filter(Boolean),
    place: clean(b.place),
    degree: b.degree ?? '',
    doi: normalizeDoi(b.doi),
    url: bibUrl(m),
    accessed: clean(b.accessed),
    ko: hasHangul(title),
  };
}

function apa(c: Ctx): Seg[] {
  const out: Seg[] = [`${apaAuthors(c.authors)} (${c.year}). `];
  const link = c.doi ? doiUrl(c.doi) : c.url;
  const tail = link ? [` ${link}`] : [];
  const ed = edition(c.edition, c.ko);
  switch (c.t) {
    case 'journal': {
      out.push(`${dot(c.title)} `, it(c.container), ', ', it(c.volume));
      if (c.issue) out.push(`(${c.issue})`);
      out.push(`, ${dash(c.pages)}.`, ...tail);
      return out;
    }
    case 'book':
      out.push(it(c.title), ed ? ` (${ed})` : '', '. ', dot(c.publisher), ...tail);
      return out;
    case 'chapter': {
      const eds = allHangul(c.editors) ? `${c.editors.join(', ')} (편)` : `${joinAnd(c.editors.map(apaEditor), true)} (${c.editors.length > 1 ? 'Eds.' : 'Ed.'})`;
      out.push(`${dot(c.title)} In ${eds}, `, it(c.container), ` (${ed ? `${ed}, ` : ''}pp. ${dash(c.pages)}). `, dot(c.publisher), ...tail);
      return out;
    }
    case 'thesis': {
      const label = c.ko ? `${c.degree}학위논문` : c.degree === '박사' ? 'Doctoral dissertation' : "Master's thesis";
      out.push(it(c.title), ` [${label}, ${c.publisher}].`, ...tail);
      return out;
    }
    case 'report':
      out.push(...itd(c.title), ' ', dot(c.publisher), ...tail);
      return out;
    case 'web':
      out.push(...itd(c.title), ` ${dot(c.container)}`, ...tail);
      return out;
    case 'video':
      out.push(it(c.title), ` [${c.ko ? '동영상' : 'Video'}]. ${dot(c.container)}`, ...tail);
      return out;
  }
}

function chicago(c: Ctx): Seg[] {
  const out: Seg[] = [`${dot(chicagoAuthors(c.authors))} ${dot(c.year)} `];
  const link = c.doi ? doiUrl(c.doi) : c.url;
  const tail = link ? [` ${dot(link)}`] : [];
  const pub = c.place ? `${c.place}: ${c.publisher}` : c.publisher;
  const ed = edition(c.edition, c.ko);
  switch (c.t) {
    case 'journal':
      out.push(`“${dot(c.title)}” `, it(c.container), ` ${c.volume}${c.issue ? ` (${c.issue})` : ''}: ${dash(c.pages)}.`, ...tail);
      return out;
    case 'book':
      out.push(...itd(c.title), ed ? ` ${dot(ed)}` : '', ` ${dot(pub)}`, ...tail);
      return out;
    case 'chapter':
      out.push(`“${dot(c.title)}” In `, it(c.container), `, edited by ${joinAnd(c.editors.map(plainName))}, ${dash(c.pages)}. `, dot(pub), ...tail);
      return out;
    case 'thesis':
      out.push(`“${dot(c.title)}” ${c.degree === '박사' ? 'PhD diss.' : "Master's thesis"}, ${dot(c.publisher)}`, ...tail);
      return out;
    case 'report':
      out.push(...itd(c.title), ` ${dot(pub)}`, ...tail);
      return out;
    case 'web':
      out.push(`“${dot(c.title)}” ${dot(c.container)}`, ...tail);
      return out;
    case 'video':
      out.push(`“${dot(c.title)}” ${c.container} video.`, ...tail);
      return out;
  }
}

function mla(c: Ctx): Seg[] {
  const out: Seg[] = [`${dot(mlaAuthors(c.authors))} `];
  const year = c.year === 'n.d.' ? '' : c.year;
  const link = c.doi ? doiUrl(c.doi) : c.url.replace(/^https?:\/\//, '');
  const pp = c.pages ? `${/[-~–]/.test(c.pages) ? 'pp.' : 'p.'} ${dash(c.pages)}` : '';
  const acc = c.accessed ? ` Accessed ${fmtAccessed(c.accessed, 'mla')}.` : '';
  const ed = edition(c.edition, c.ko);
  const parts = (xs: string[]) => xs.filter(Boolean).join(', ');
  switch (c.t) {
    case 'journal':
      out.push(`“${dot(c.title)}” `, it(c.container), `, ${dot(parts([`vol. ${c.volume}`, c.issue && `no. ${c.issue}`, year, pp, link]))}`);
      return out;
    case 'book':
      out.push(...itd(c.title), ' ', dot(parts([ed, c.publisher, year])), link ? ` ${dot(link)}` : '');
      return out;
    case 'chapter':
      out.push(`“${dot(c.title)}” `, it(c.container), `, ${dot(parts([`edited by ${joinAnd(c.editors.map(plainName))}`, ed, c.publisher, year, pp]))}`);
      return out;
    case 'thesis':
      out.push(...itd(c.title), ' ', dot(parts([year])), ` ${dot(parts([c.publisher, c.degree === '박사' ? 'PhD dissertation' : "Master's thesis"]))}`, link ? ` ${dot(link)}` : '');
      return out;
    case 'report':
      out.push(...itd(c.title), ' ', dot(parts([c.publisher, year, link])));
      return out;
    case 'web':
    case 'video':
      out.push(`“${dot(c.title)}” `, it(c.container), `, ${dot(parts([year, link]))}${acc}`);
      return out;
  }
}

function korean(c: Ctx): Seg[] {
  const a = c.authors.join('·');
  const year = c.year === 'n.d.' ? '연도 미상' : c.year;
  const pages = c.pages ? `${c.pages.replace(/–/g, '-')}쪽` : '';
  const pub = c.place ? `${c.place}: ${c.publisher}` : c.publisher;
  const ed = edition(c.edition, true);
  const link = c.doi ? ` DOI: ${doiUrl(c.doi)}` : c.url ? ` ${c.url}` : '';
  const acc = c.accessed ? ` (검색일: ${fmtAccessed(c.accessed, 'ko')})` : '';
  const j = (xs: string[]) => xs.filter(Boolean).join(', ');
  switch (c.t) {
    case 'journal': {
      const vi = `${c.volume}${c.issue ? `(${c.issue})` : ''}`;
      return [`${j([a, `「${c.title}」`, `『${c.container}』 ${vi}`, c.publisher, year, pages])}.${link}`];
    }
    case 'book':
      return [`${j([a, `『${c.title}』${ed ? ` ${ed}` : ''}`, pub, year])}.${link}`];
    case 'chapter':
      return [`${j([a, `「${c.title}」`, `${c.editors.join('·')} 편, 『${c.container}』${ed ? ` ${ed}` : ''}`, pub, year, pages])}.${link}`];
    case 'thesis':
      return [`${j([a, `「${c.title}」`, `${c.publisher} ${c.degree}학위논문`, year])}.${link}`];
    case 'report':
      return [`${j([a, `『${c.title}』`, pub, year])}.${link}`];
    case 'web':
    case 'video':
      return [`${j([a, `「${c.title}」`, c.container, year])}.${link}${acc}`];
  }
}

/** 완성 가능한 자료만 서식화. 정보가 부족하면 null (임의로 채우지 않음) */
export function formatCitation(m: Material, style: CitationStyle): Seg[] | null {
  if (!checkBib(m).complete) return null;
  const c = ctxOf(m);
  const segs = style === 'APA 7' ? apa(c) : style === 'Chicago' ? chicago(c) : style === 'MLA 9' ? mla(c) : korean(c);
  return segs.filter((s) => (typeof s === 'string' ? s !== '' : s.i !== ''));
}

export const segsToText = (segs: Seg[]) => segs.map((s) => (typeof s === 'string' ? s : s.i)).join('');
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
export const segsToHtml = (segs: Seg[]) => segs.map((s) => (typeof s === 'string' ? esc(s) : `<i>${esc(s.i)}</i>`)).join('');

/** 정렬 키: 첫 저자(성) → 연도. 국내 일반형은 한글 저자를 먼저 */
export function sortForStyle(ms: Material[], style: CitationStyle): Material[] {
  const key = (m: Material) => {
    const first = bibAuthors(m.bib)[0] ?? bibTitle(m);
    return (splitName(first)?.last ?? first).toLowerCase();
  };
  return [...ms].sort((a, b) => {
    if (style === '국내 학술지 일반형') {
      const d = Number(!hasHangul(key(a))) - Number(!hasHangul(key(b)));
      if (d) return d;
    }
    return key(a).localeCompare(key(b), 'ko') || clean(a.bib?.year).localeCompare(clean(b.bib?.year));
  });
}

/** 같은 저자·같은 연도 자료 (APA 등은 2024a/2024b 구분 필요) */
export function sameAuthorYear(ms: Material[]): string[] {
  const seen = new Map<string, number>();
  for (const m of ms) {
    const k = `${bibAuthors(m.bib).join('; ')} (${clean(m.bib?.year)})`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}
