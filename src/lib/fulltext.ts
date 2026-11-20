/**
 * 논문 PDF 원문 처리 (AI 호출 없이 로컬에서만): 장·절 분할, 조각 나누기, 질의어 기반 조각 선택,
 * 토큰 추정, 근거 인용 확인, 캐시 키. 원문 자체는 fulltext-store.ts가 IndexedDB·Storage에 따로 보관한다.
 */

export type SectionKind = 'front' | 'abstract' | 'intro' | 'body' | 'conclusion' | 'references';
export interface Section {
  id: string;
  title: string;
  kind: SectionKind;
  pageFrom: number; // 1부터
  pageTo: number;
  text: string;
}
/** 저장되는 원문 문서 (자료 JSON에는 넣지 않는다) */
export interface FullTextDoc {
  materialId: string;
  hash: string;
  fileName: string;
  numPages: number;
  extractedAt: string;
  sections: Section[];
  /** 추출 방식 버전 (2: 한글 CMap·띄어쓰기 보정) */
  extractorVersion?: number;
  quality?: ExtractQuality;
}

/** 2: 한글 CID 글꼴 CMap 적용·조각 사이 띄어쓰기. 이보다 낮으면 다시 추출을 권한다 */
export const EXTRACTOR_VERSION = 2;
export interface ExtractQuality {
  level: 'good' | 'low';
  reasons: string[];
  charsPerPage: number;
  hangulRatio: number;
}

/**
 * 추출 품질 점검 (로컬): 쪽당 글자 수, 한글 비율(한국어 논문일 때), 깨진 글자(대체 문자·사용자 정의 영역·낱자모) 비율.
 */
export function assessQuality(pages: string[], expectHangul: boolean): ExtractQuality {
  const text = pages.join('\n').replace(/\s+/g, '');
  const charsPerPage = Math.round(text.length / Math.max(1, pages.length));
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  const letters = hangul + (text.match(/[A-Za-z㐀-鿿]/g) ?? []).length;
  const hangulRatio = letters ? hangul / letters : 0;
  // 대체 문자(U+FFFD)·사용자 정의 영역·낱자모(호환 자모)는 글꼴 매핑 실패의 흔한 흔적
  const broken = (text.match(/[�-ㄱ-ㆎ]/g) ?? []).length;
  const reasons: string[] = [];
  if (charsPerPage < 300) reasons.push(`쪽당 글자 수가 적음 (평균 ${charsPerPage}자)`);
  if (expectHangul && hangulRatio < 0.3) reasons.push(`한글 비율이 낮음 (${Math.round(hangulRatio * 100)}%) — 한글이 빠졌거나 깨졌을 수 있음`);
  if (text.length && broken / text.length > 0.01) reasons.push(`깨진 글자 비율이 높음 (${Math.round((broken / text.length) * 1000) / 10}%)`);
  return { level: reasons.length ? 'low' : 'good', reasons, charsPerPage, hangulRatio: Math.round(hangulRatio * 100) / 100 };
}

/* ───────── 해시 (동기, 브라우저·Node 공통) ───────── */

/** cyrb53: 충돌 가능성이 낮은 53비트 문자열 해시 → 14자리 16진수 */
export function textHash(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** 절 텍스트 전체의 해시 — 원문이 바뀌었는지(분석 캐시 무효화) 판단에 쓴다 */
export const docHash = (sections: Section[]) => textHash(sections.map((s) => `${s.title}\n${s.text}`).join('\n\f'));

/** PDF에서 뽑은 쪽별 텍스트 → 저장할 원문 문서 */
export function buildFullText(materialId: string, fileName: string, pages: string[], numPages: number, now = new Date(), opts: { expectHangul?: boolean } = {}): FullTextDoc {
  const sections = splitSections(pages);
  return { materialId, hash: docHash(sections), fileName, numPages, extractedAt: now.toISOString(), sections, extractorVersion: EXTRACTOR_VERSION, quality: assessQuality(pages, !!opts.expectHangul) };
}

/** 자료 JSON에 남기는 원문 요약 정보 (원문 자체는 넣지 않는다) */
export interface FullTextMeta {
  hash: string;
  fileName: string;
  pages: number;
  chars: number;
  sections: number;
  savedAt: string;
  cloud: boolean;
  extractorVersion?: number;
  quality?: { level: 'good' | 'low'; reasons: string[] };
}
export const fullTextMeta = (d: FullTextDoc, cloud: boolean): FullTextMeta => ({
  hash: d.hash,
  fileName: d.fileName,
  pages: d.numPages,
  chars: d.sections.reduce((n, s) => n + s.text.length, 0),
  sections: d.sections.length,
  savedAt: d.extractedAt,
  cloud,
  ...(d.extractorVersion ? { extractorVersion: d.extractorVersion } : {}),
  ...(d.quality ? { quality: { level: d.quality.level, reasons: d.quality.reasons } } : {}),
});

/** 원문 문서 형식 검사 (깨졌거나 다른 자료의 문서면 undefined) */
export function validDoc(x: unknown, materialId: string): FullTextDoc | undefined {
  const d = x as FullTextDoc | null;
  if (!d || typeof d !== 'object' || d.materialId !== materialId || typeof d.hash !== 'string' || !Array.isArray(d.sections)) return undefined;
  const ok = d.sections.every((s: Section) => s && typeof s.text === 'string' && typeof s.title === 'string' && Number.isInteger(s.pageFrom));
  if (!ok || docHash(d.sections) !== d.hash) return undefined;
  return d;
}

/* ───────── 장·절 분할 ───────── */

const HEADING =
  /^(?:제\s*\d+\s*[장절]\b.*|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4}\s*[.．]?\s*\S.*|[IVX]{1,4}\s*[.．]\s+\S.*|\d{1,2}\s*[.．]\s*[^\d\s.].*|\d{1,2}\.\d{1,2}\.?\s+\S.*|(?:국문\s*)?초\s*록|요\s*약|abstract|서\s*론|결\s*론(?:\s*및\s*제\s*언)?|참\s*고\s*문\s*헌|references|bibliography)$/i;
const TOC_LINE = /(?:\.{3,}|…{2,}|·{3,}|\s{3,})\s*\d{1,3}\s*$/;
const kindOf = (title: string): SectionKind => {
  const t = title.replace(/\s+/g, '');
  if (/^(국문)?초록$|^요약$|^abstract$/i.test(t)) return 'abstract';
  if (/참고문헌|references|bibliography/i.test(t)) return 'references';
  if (/서론|들어가며|introduction|머리말|^\d\.?연구(의)?배경|문제제기/i.test(t)) return 'intro';
  if (/결론|맺음말|나가며|conclusion|제언/i.test(t)) return 'conclusion';
  return 'body';
};
const isHeading = (line: string) => {
  const l = line.trim();
  if (l.length < 2 || l.length > 60 || TOC_LINE.test(l)) return false;
  if (/[다요음함]\s*[.。]$/.test(l)) return false; // 문장으로 끝나면 제목이 아님
  return HEADING.test(l);
};

/** 쪽별 텍스트 → 장·절 목록 (제목 앞부분은 'front'). 한 절이 maxChars를 넘으면 나눠 '(2/3)'을 붙인다 */
export function splitSections(pages: string[], maxChars = 6000): Section[] {
  const raw: { title: string; pageFrom: number; pageTo: number; lines: string[] }[] = [];
  let cur = { title: '앞부분', pageFrom: 1, pageTo: 1, lines: [] as string[] };
  pages.forEach((page, pi) => {
    for (const line of page.split(/\r?\n/)) {
      if (isHeading(line)) {
        if (cur.lines.join('').trim()) {
          // 내용이 있으면 앞 절을 닫는다
          raw.push(cur);
          cur = { title: line.trim(), pageFrom: pi + 1, pageTo: pi + 1, lines: [] };
        } else if (cur.title === '앞부분') {
          cur = { title: line.trim(), pageFrom: pi + 1, pageTo: pi + 1, lines: [] };
        } else {
          // 장 제목 바로 뒤의 절 제목: 'Ⅰ. 서론 · 1. 연구 배경'처럼 이어 붙인다 (장 종류 유지)
          cur.title = `${cur.title} · ${line.trim()}`;
          cur.pageTo = pi + 1;
        }
      } else {
        cur.lines.push(line);
        cur.pageTo = pi + 1;
      }
    }
  });
  raw.push(cur);
  const out: Section[] = [];
  for (const r of raw) {
    const text = r.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) continue;
    const kind = r.title === '앞부분' ? 'front' : kindOf(r.title);
    const parts = chunkText(text, maxChars);
    parts.forEach((p, i) =>
      out.push({ id: `s${out.length + 1}`, title: parts.length > 1 ? `${r.title} (${i + 1}/${parts.length})` : r.title, kind, pageFrom: r.pageFrom, pageTo: r.pageTo, text: p }),
    );
  }
  return out;
}

/** 줄 경계를 지키며 maxChars 이하 조각으로 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf && buf.length + line.length + 1 > maxChars) {
      parts.push(buf);
      buf = '';
    }
    if (line.length > maxChars) {
      for (let i = 0; i < line.length; i += maxChars) parts.push(line.slice(i, i + maxChars));
      continue;
    }
    buf = buf ? `${buf}\n${line}` : line;
  }
  if (buf) parts.push(buf);
  return parts;
}

/* ───────── 토큰 추정 · 질의어 기반 조각 선택 ───────── */

/** 보수적 추정: 한글·한자·가나는 글자당 1토큰, 나머지는 3.5자당 1토큰 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯豈-﫿]/g) ?? []).length;
  return Math.ceil(cjk + (text.length - cjk) / 3.5);
}

/** 주제·키워드·질문 → 검색어 (2자 이상, 중복 제거) */
export function queryTerms(...texts: (string | string[] | undefined)[]): string[] {
  const words = texts.flatMap((t) => (Array.isArray(t) ? t : (t ?? '').split(/[\s,·/()「」『』<>《》"'“”‘’:;?!.]+/)));
  return [...new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2))].slice(0, 40);
}

const count = (hay: string, needle: string) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < 5; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** 조각별 관련 점수 (검색어 출현 빈도 × 희소성) */
export function scoreSections(sections: Section[], terms: string[]): Map<string, number> {
  const low = sections.map((s) => `${s.title}\n${s.text}`.toLowerCase());
  const df = new Map(terms.map((t) => [t, low.filter((x) => x.includes(t)).length]));
  const n = sections.length || 1;
  return new Map(
    sections.map((s, i) => [s.id, terms.reduce((sum, t) => sum + (df.get(t) ? count(low[i], t) * Math.log(1 + n / df.get(t)!) : 0), 0)]),
  );
}

export interface Selection {
  sections: Section[];
  chars: number;
  totalChars: number;
  /** 사람이 읽는 분석 범위 설명 */
  scope: string;
}

/**
 * 예산(글자 수) 안에서 분석에 보낼 조각을 고른다.
 * 초록·서론 첫 조각·결론을 먼저 넣고, 남은 예산은 검색어 점수 순서. 참고문헌은 제외. 결과는 문서 순서.
 */
export function selectSections(sections: Section[], terms: string[], budgetChars: number): Selection {
  const pool = sections.filter((s) => s.kind !== 'references');
  const total = pool.reduce((n, s) => n + s.text.length, 0);
  const score = scoreSections(pool, terms);
  const picked = new Set<string>();
  let used = 0;
  const take = (s: Section | undefined, cap = budgetChars) => {
    if (!s || picked.has(s.id) || s.text.length > cap || used + s.text.length > budgetChars) return;
    picked.add(s.id);
    used += s.text.length;
  };
  take(pool.find((s) => s.kind === 'abstract'));
  take(pool.find((s) => s.kind === 'intro'), budgetChars * 0.3);
  const concl = pool.filter((s) => s.kind === 'conclusion');
  take(concl[concl.length - 1], budgetChars * 0.3);
  for (const s of [...pool].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0))) {
    if ((score.get(s.id) ?? 0) <= 0) break;
    take(s);
  }
  const chosen = pool.filter((s) => picked.has(s.id));
  const scope = chosen.length
    ? `원문 ${total.toLocaleString()}자 중 ${used.toLocaleString()}자(${Math.round((used / (total || 1)) * 100)}%): ${chosen.map((s) => `${s.title}(p.${s.pageFrom}${s.pageTo !== s.pageFrom ? `-${s.pageTo}` : ''})`).join(', ')}`
    : '원문에서 분석 범위에 맞는 부분을 찾지 못함';
  return { sections: chosen, chars: used, totalChars: total, scope };
}

/** AI에 보낼 원문 블록 (조각마다 장·절과 쪽 표시) */
export const sectionsBlock = (ss: Section[]) =>
  ss.map((s) => `<원문 절="${s.title}" 쪽="${s.pageFrom}${s.pageTo !== s.pageFrom ? `-${s.pageTo}` : ''}">\n${s.text}\n</원문>`).join('\n\n');

/* ───────── 근거 인용 확인 ───────── */

/** 인용 비교용 정규화: 호환 문자(NFKC)·공백·줄바꿈·줄 끝 하이픈·따옴표·가운뎃점/대시 변형 차이만 없앤다 (글자 자체는 바꾸지 않음) */
export const squash = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[­​-‍﻿]/g, '') // 소프트 하이픈·폭 없는 문자
    .replace(/-\s*\n\s*/g, '') // 줄 끝에서 하이픈으로 나뉜 단어
    .replace(/[\s ]+/g, '')
    .replace(/[“”"'‘’`´]/g, '')
    .replace(/[·•ㆍ･]/g, '·')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase();

export interface Evidence {
  section: string;
  quote: string;
  point?: string;
  pages?: string;
  /** 원문에서 그대로 찾았는지 (로컬 확인) */
  verified: boolean;
  /** exact: 원문과 일치 · similar: 문구는 다르나 원문 표현과 상당 부분 겹침 · none: 원문 미확인 */
  match?: EvidenceMatch;
}

export type EvidenceMatch = 'exact' | 'similar' | 'none';

/** 예전 결과(verified만 있음)도 포함해 일치 수준을 정한다 */
export const evidenceMatch = (e: { verified: boolean; match?: EvidenceMatch }): EvidenceMatch =>
  e.verified ? 'exact' : e.match === 'similar' ? 'similar' : 'none';

/** 정규화한 인용의 6자 조각 중 원문에 있는 비율 (exact 아님을 이미 확인한 뒤에만 쓴다) */
export function overlapRatio(q: string, all: string): number {
  const n = 6;
  if (q.length < 12) return 0;
  let hit = 0;
  let tot = 0;
  for (let i = 0; i + n <= q.length; i += 3) {
    tot++;
    if (all.includes(q.slice(i, i + n))) hit++;
  }
  return tot ? hit / tot : 0;
}

/** AI가 낸 인용을 원문에서 찾아 확인하고, 찾은 절의 쪽 범위를 붙인다 */
export function verifyEvidence(items: { section: string; quote: string; point?: string }[], sections: Section[]): Evidence[] {
  // 절마다 정규화한 텍스트를 이어 붙이고 시작 위치를 기억한다 (절 경계를 넘는 인용도 찾음)
  const norm = sections.map((s) => squash(s.text));
  const starts: number[] = [];
  let pos = 0;
  for (const n of norm) {
    starts.push(pos);
    pos += n.length;
  }
  const all = norm.join('');
  const sectionAt = (i: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= i) k++;
    return sections[k];
  };
  return items.slice(0, 12).map((e) => {
    const q = squash(e.quote ?? '');
    const at = q.length >= 8 ? all.indexOf(q) : -1;
    const match: EvidenceMatch = at >= 0 ? 'exact' : overlapRatio(q, all) >= 0.6 ? 'similar' : 'none';
    const first = at >= 0 ? sectionAt(at) : undefined;
    const last = at >= 0 ? sectionAt(at + q.length - 1) : undefined;
    const pages = first && last ? `${first.pageFrom}${Math.max(first.pageTo, last.pageTo) !== first.pageFrom ? `-${Math.max(first.pageTo, last.pageTo)}` : ''}` : undefined;
    return {
      section: first?.title ?? e.section ?? '',
      quote: (e.quote ?? '').trim().slice(0, 300),
      ...(e.point ? { point: e.point.trim().slice(0, 300) } : {}),
      ...(pages ? { pages } : {}),
      verified: at >= 0,
      match,
    };
  });
}

const MD_LABEL: Record<EvidenceMatch, string> = { exact: '원문 확인', similar: '의미 유사 · 문구 불일치', none: '원문 미확인' };

/** 산출물용 근거 목록: 원문과 일치한 문장만 따옴표로 인용하고, 나머지는 직접 인용이 아님을 밝힌다 */
export function evidenceMarkdown(list: { section: string; quote: string; point?: string; pages?: string; verified: boolean; match?: EvidenceMatch }[]): string {
  const lines = list.map((e) => {
    const mt = evidenceMatch(e);
    const where = `${e.section}${e.pages ? ` p.${e.pages}` : ''}`;
    const body = mt === 'exact' ? `"${e.quote}"` : `(직접 인용 아님) ${e.quote}`;
    return `- [${MD_LABEL[mt]}] ${where}: ${body}${e.point ? ` → ${e.point}` : ''}`;
  });
  if (list.some((e) => !e.verified)) lines.push('', '> ‘원문 확인’이 아닌 문장은 직접 인용이 아니므로 학술 인용에 사용할 수 없습니다.');
  return lines.join('\n');
}
