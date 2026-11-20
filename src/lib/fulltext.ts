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
export function buildFullText(materialId: string, fileName: string, pages: string[], numPages: number, now = new Date()): FullTextDoc {
  const sections = splitSections(pages);
  return { materialId, hash: docHash(sections), fileName, numPages, extractedAt: now.toISOString(), sections };
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
}
export const fullTextMeta = (d: FullTextDoc, cloud: boolean): FullTextMeta => ({
  hash: d.hash,
  fileName: d.fileName,
  pages: d.numPages,
  chars: d.sections.reduce((n, s) => n + s.text.length, 0),
  sections: d.sections.length,
  savedAt: d.extractedAt,
  cloud,
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
  if (/서론|들어가며|introduction|머리말/i.test(t)) return 'intro';
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

const squash = (s: string) => s.normalize('NFC').replace(/[\s ]+/g, '').replace(/[“”"'‘’]/g, '').toLowerCase();

export interface Evidence {
  section: string;
  quote: string;
  point?: string;
  pages?: string;
  /** 원문에서 그대로 찾았는지 (로컬 확인) */
  verified: boolean;
}

/** AI가 낸 인용을 원문에서 찾아 확인하고, 찾은 절의 쪽 범위를 붙인다 */
export function verifyEvidence(items: { section: string; quote: string; point?: string }[], sections: Section[]): Evidence[] {
  return items.slice(0, 12).map((e) => {
    const q = squash(e.quote ?? '');
    const hit = q.length >= 8 ? sections.find((s) => squash(s.text).includes(q)) : undefined;
    return {
      section: hit?.title ?? e.section ?? '',
      quote: (e.quote ?? '').trim().slice(0, 300),
      ...(e.point ? { point: e.point.trim().slice(0, 300) } : {}),
      ...(hit ? { pages: `${hit.pageFrom}${hit.pageTo !== hit.pageFrom ? `-${hit.pageTo}` : ''}` } : {}),
      verified: !!hit,
    };
  });
}
