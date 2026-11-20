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

/** 2: 한글 CID 글꼴 CMap·띄어쓰기  3: 「제N장」·조각별 쪽 범위  4: 줄 안 조각을 x좌표 순으로(번호 뒤바뀜 방지)·다단계 번호 절. 이보다 낮으면 다시 추출을 권한다 */
export const EXTRACTOR_VERSION = 4;
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
  const quality = assessQuality(pages, !!opts.expectHangul);
  // 쪽 수 상한으로 뒷부분을 못 읽었으면 남겨 둔다 (결론·한계가 빠진 이유를 분석 확인창에서 알 수 있도록)
  if (pages.length < numPages) {
    quality.reasons.push(`PDF ${numPages}쪽 중 앞 ${pages.length}쪽만 추출됨 — ${pages.length + 1}쪽 이후(결론·한계 등)는 분석에 포함되지 않음`);
    quality.level = 'low';
  }
  return { materialId, hash: docHash(sections), fileName, numPages, extractedAt: now.toISOString(), sections, extractorVersion: EXTRACTOR_VERSION, quality };
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
  // '제1장 서론'·'제 2 절'·'제Ⅲ장': JS 정규식의 \b는 한글 뒤에서 성립하지 않으므로 쓰지 않는다 (조사가 붙으면 문장으로 봄)
  // 다단계 번호(1.1. · 1.4.1. · 1.5.1.2.)는 뒤에 조사가 오면('2.1.2 에서 …') 본문 문장으로 본다
  /^(?:제\s*(?:\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4})\s*[장절](?![에의을를은는이가과와도로])(?:\s*\S.*)?|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4}\s*[.．]?\s*\S.*|[IVX]{1,4}\s*[.．]\s+\S.*|\d{1,2}(?:\.\d{1,2}){1,3}\.?\s+(?![에의와과로를을은는이가도](?:\s|서|부터|까지|$))\S.*|(?:국문\s*)?초\s*록|요\s*약|abstract|서\s*론|결\s*론(?:\s*및\s*제\s*언)?|참\s*고\s*문\s*헌|references|bibliography)$/i;
/** 한 단계 번호('1. 서론'): 「제N장」을 쓰는 문서에서는 본문 목록 번호이므로 제목으로 보지 않는다 */
const SINGLE_NUM = /^\d{1,2}\s*[.．]\s*[^\d\s.].*$/;
const CHAPTER = /^(?:제\s*(?:\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4})\s*장|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4}\s*[.．]?\s*\S|[IVX]{1,4}\s*[.．]\s+\S)/;
// 목차 줄: 점선(…… · ····) 뒤에 쪽 번호나 깨진 글자 몇 자, 또는 넓은 공백 뒤 쪽 번호
const TOC_LINE = /(?:\.{4,}|…{2,}|·{4,}|[.·…]{2,}\s*\S{0,6}\s*$|\s{3,}\d{1,3}\s*$)/;
/**
 * 「제 장」의 숫자가 따로 기록되어 '제 장2 AI 이미지 큐레이션 전략'·'제 장 서론1'처럼 추출된 줄 → '제2장 …'.
 * '제 장에서는 …'·'제 장부터 제 장까지' 같은 본문 문장(숫자가 0개·2개 이상이거나 조사로 이어짐)은 그대로 둔다.
 */
export function fixChapterLine(line: string): string {
  const m = /^\s*제\s*장\s*(\d{1,2})?\s*(.*?)\s*$/.exec(line);
  if (!m || /^[에의을를은는이가과와도로부까]/.test(m[2])) return line;
  const tail = /^(.*?\S)\s*(\d{1,2})$/.exec(m[2]);
  const num = m[1] ?? tail?.[2];
  const title = m[1] ? m[2] : tail?.[1];
  if (!num || !title || (m[1] && tail)) return line;
  return `제${num}장 ${title}`;
}
/** 괄호로 감싼 초록 제목 (공백 제거 후): 【中文摘要】 · [국문초록] · (Abstract) · 中文摘要 */
const ABSTRACT_ALT = /^(?:[【\[(〔]\s*(?:중문|국문|영문)?(?:초록|요약|abstract|中文摘要|摘要|内容摘要)\s*[】\])〕]|中文摘要|内容摘要|摘要)$/i;
const hanOverHangul =(l: string) => (l.match(/[㐀-鿿]/g) ?? []).length > (l.match(/[가-힣]/g) ?? []).length;
const kindOf = (title: string): SectionKind => {
  const t = title.replace(/\s+/g, '');
  if (/^(국문)?초록$|^요약$|^abstract$/i.test(t) || ABSTRACT_ALT.test(t)) return 'abstract';
  if (/참고문헌|references|bibliography/i.test(t)) return 'references';
  if (/서론|들어가며|introduction|머리말|^\d\.(?:\d\.?)?연구(의)?배경|^\d\.?연구(의)?배경|문제제기/i.test(t)) return 'intro';
  if (/결론|맺음말|나가며|conclusion|제언/i.test(t)) return 'conclusion';
  return 'body';
};
const isHeadingIn = (line: string, singleLevel: boolean) => {
  const l = line.trim();
  if (l.length < 2 || l.length > 80 || TOC_LINE.test(l)) return false;
  if (/[다요음함]\s*[.。]$/.test(l)) return false; // 문장으로 끝나면 제목이 아님
  if (ABSTRACT_ALT.test(l.replace(/\s+/g, ''))) return true; // 【中文摘要】·[Abstract] 같은 다국어 초록 제목
  if (hanOverHangul(l)) return false; // 중국어 예문·인용 ('8. 使用普通…')
  if (!singleLevel && SINGLE_NUM.test(l)) return false;
  return HEADING.test(l) || (singleLevel && SINGLE_NUM.test(l));
};

/** 쪽별 텍스트 → 장·절 목록 (제목 앞부분은 'front'). 한 절이 maxChars를 넘으면 나눠 '(2/3)'을 붙인다 */
export function splitSections(pages: string[], maxChars = 6000): Section[] {
  type Line = { t: string; p: number };
  const raw: { title: string; pageFrom: number; pageTo: number; lines: Line[] }[] = [];
  let cur = { title: '앞부분', pageFrom: 1, pageTo: 1, lines: [] as Line[] };
  const flat = (t: string) => t.replace(/\s+/g, '');
  let chapter = ''; // 현재 장 제목 (제N장·Ⅰ. 등)
  const fixed = pages.map((p) => p.split(/\r?\n/).map(fixChapterLine));
  // 「제N장」 제목이 둘 이상이면 장은 「제N장」, 절은 '1.1.'로 쓰는 문서 → 한 단계 번호('8. …')는 본문 목록
  const singleLevel = fixed.flat().filter((l) => /^제\d{1,2}장\s/.test(l) && !TOC_LINE.test(l)).length < 2;
  const isHeading = (l: string) => isHeadingIn(l, singleLevel);
  fixed.forEach((lines, pi) => {
    for (const line of lines) {
      // 쪽마다 반복되는 머리글(현재 장·절 제목과 같은 줄)은 새 절로 보지 않고 버린다
      if (isHeading(line) && cur.title !== '앞부분' && [chapter, ...cur.title.split(' · ')].some((t) => t && flat(t) === flat(line))) continue;
      if (isHeading(line) && CHAPTER.test(line.trim())) chapter = line.trim();
      if (isHeading(line)) {
        if (cur.lines.some((l) => l.t.trim())) {
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
        cur.lines.push({ t: line, p: pi + 1 });
        cur.pageTo = pi + 1;
      }
    }
  });
  raw.push(cur);
  const out: Section[] = [];
  const tidy = (ls: Line[]) => ls.map((l) => l.t).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let chapterKind: SectionKind = 'body';
  for (const r of raw) {
    if (CHAPTER.test(r.title)) chapterKind = kindOf(r.title);
    if (!tidy(r.lines)) continue;
    // 서론·결론 장 안의 번호 절('6.3. 연구의 한계점')은 장의 종류를 물려받는다
    const own: SectionKind = r.title === '앞부분' ? 'front' : kindOf(r.title);
    const kind: SectionKind = own === 'body' && /^\d/.test(r.title) && (chapterKind === 'intro' || chapterKind === 'conclusion') ? chapterKind : own;
    // 줄 단위로 나눠 조각마다 실제 쪽 범위를 기록한다 (긴 절의 모든 조각이 절 전체 쪽 범위를 갖지 않도록)
    const parts: { text: string; from: number; to: number }[] = [];
    let buf: Line[] = [];
    let len = 0;
    const flush = () => {
      const text = tidy(buf);
      if (text) {
        const ps = buf.filter((l) => l.t.trim()).map((l) => l.p);
        parts.push({ text, from: ps[0] ?? r.pageFrom, to: ps[ps.length - 1] ?? r.pageTo });
      }
      buf = [];
      len = 0;
    };
    for (const l of r.lines) {
      if (l.t.length > maxChars) {
        flush();
        for (const piece of chunkText(l.t, maxChars)) parts.push({ text: piece, from: l.p, to: l.p });
        continue;
      }
      if (len && len + l.t.length + 1 > maxChars) flush();
      buf.push(l);
      len += l.t.length + 1;
    }
    flush();
    // 제목 줄이 있는 쪽부터 시작하도록 (절 첫 조각)
    if (parts[0]) parts[0].from = Math.min(parts[0].from, r.pageFrom);
    parts.forEach((p, i) =>
      out.push({ id: `s${out.length + 1}`, title: parts.length > 1 ? `${r.title} (${i + 1}/${parts.length})` : r.title, kind, pageFrom: p.from, pageTo: p.to, text: p.text }),
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
  /** 사람이 읽는 분석 범위 설명 (실제로 보내는 조각의 역할·제목·쪽) */
  scope: string;
  /** 장·절 인식이 불확실하거나 필요한 부분을 찾지 못했을 때의 경고 (추측해서 채우지 않음) */
  warnings: string[];
}

/** 분석에서 챙길 부분: 제목(장 제목 포함)으로만 판단한다 */
export type SectionRole = 'abstract' | 'intro' | 'method' | 'results' | 'conclusion' | 'limits' | 'front' | 'other';
export const ROLE_LABEL: Record<SectionRole, string> = { abstract: '초록', intro: '서론', method: '연구방법', results: '핵심 분석·결과', conclusion: '결론', limits: '한계', front: '앞부분', other: '본문' };
export function roleOf(s: Section): SectionRole {
  if (s.kind === 'front' || s.kind === 'abstract') return s.kind;
  const t = s.title.replace(/\s+|\(\d+\/\d+\)$/g, '').toLowerCase();
  // 연구의 한계: '연구의 한계(점)'·'한계점'·'제한점', 또는 결론 장 안의 '한계' 절 ('…시스템의 한계와 통합의 필요성' 같은 본문 절은 제외)
  if ((/연구의한계|한계점|제한점|limitation/.test(t) || (s.kind === 'conclusion' && /한계/.test(t))) && !/결론/.test(t)) return 'limits';
  if (s.kind === 'conclusion') return 'conclusion';
  if (/연구방법|연구.{0,6}방법|방법론|연구설계|연구절차|연구대상|연구도구|분석방법|분석틀|자료수집|자료분석|method|design|procedure/.test(t)) return 'method';
  if (/결과|분석|논의|고찰|사례|실험|검증|findings|results|discussion|analysis/.test(t)) return 'results';
  if (s.kind === 'intro') return 'intro';
  return 'other';
}

const pagesOf = (s: Section) => `p.${s.pageFrom}${s.pageTo !== s.pageFrom ? `-${s.pageTo}` : ''}`;

/** 장·절 인식 상태 점검: 제목 없이 남은 앞부분이 크거나, 필요한 부분의 제목을 못 찾으면 경고 */
export function structureWarnings(sections: Section[]): string[] {
  const pool = sections.filter((s) => s.kind !== 'references');
  const total = pool.reduce((n, s) => n + s.text.length, 0) || 1;
  const front = pool.filter((s) => s.kind === 'front');
  const frontChars = front.reduce((n, s) => n + s.text.length, 0);
  const w: string[] = [];
  const titled = new Set(pool.filter((s) => s.kind !== 'front').map((s) => s.title.replace(/ \(\d+\/\d+\)$/, ''))).size;
  if (titled < 2) w.push('장·절 제목을 거의 인식하지 못했습니다. 자동 선택은 검색어에만 의존하므로 필요한 부분이 빠질 수 있습니다.');
  else if (front.length > 1 && frontChars / total > 0.25)
    w.push(`장·절 제목 없이 인식된 앞부분이 큽니다 (${pagesOf({ ...front[0], pageTo: front[front.length - 1].pageTo })}, 원문의 ${Math.round((frontChars / total) * 100)}%). 이 구간의 장·절 구분은 인식하지 못했습니다.`);
  const roles = new Set(pool.map(roleOf));
  const missing = (['method', 'results', 'conclusion'] as const).filter((r) => !roles.has(r)).map((r) => ROLE_LABEL[r]);
  if (titled >= 2 && missing.length) w.push(`장·절 제목에서 ${missing.join('·')} 부분을 찾지 못해 그 부분은 따로 넣지 않았습니다 (추측하지 않음).`);
  return w;
}

/**
 * 예산(글자 수) 안에서 분석에 보낼 조각을 고른다. 참고문헌은 제외, 결과는 문서 순서.
 * 1) 초록·연구방법·핵심 분석·결과·결론·한계에서 한 조각씩(검색어 점수가 높은 조각, 조각당 예산의 30% 이하)
 * 2) 서론 첫 조각  3) 남은 예산은 검색어 점수 순 (제목 없는 앞부분은 장·절을 못 찾았을 때만)
 */
export function selectSections(sections: Section[], terms: string[], budgetChars: number): Selection {
  const pool = sections.filter((s) => s.kind !== 'references');
  const total = pool.reduce((n, s) => n + s.text.length, 0);
  const score = scoreSections(pool, terms);
  const sc = (s: Section) => score.get(s.id) ?? 0;
  const picked = new Set<string>();
  let used = 0;
  const take = (s: Section | undefined, cap = budgetChars) => {
    if (!s || picked.has(s.id) || s.text.length > cap || used + s.text.length > budgetChars) return false;
    picked.add(s.id);
    used += s.text.length;
    return true;
  };
  const byRole = (r: SectionRole) => pool.filter((s) => roleOf(s) === r);
  const best = (ss: Section[], cap: number) => {
    // 점수 높은 순, 같으면 문서 순서. 예산에 맞는 첫 조각을 넣는다
    for (const s of [...ss].sort((a, b) => sc(b) - sc(a))) if (take(s, cap)) return;
  };
  const cap = budgetChars * 0.3;
  const structured = pool.some((s) => s.kind !== 'front');
  take(byRole('abstract')[0]);
  // 초록 제목이 없고 장·절도 못 찾은 문서만 첫 부분(서지·초록일 가능성)을 조금 넣는다 (학위논문 표지·목차는 넣지 않음)
  if (!byRole('abstract').length && !structured) take(byRole('front')[0], budgetChars * 0.15);
  best(byRole('method'), cap);
  best(byRole('results'), cap);
  const concl = byRole('conclusion');
  if (concl.length) take(concl[concl.length - 1], cap) || best(concl, cap);
  best(byRole('limits'), cap);
  take(byRole('intro')[0], budgetChars * 0.2);
  for (const s of [...pool].sort((a, b) => sc(b) - sc(a))) {
    if (sc(s) <= 0) break;
    if (structured && s.kind === 'front') continue;
    take(s);
  }
  // 검색어가 맞지 않아 예산이 남으면 결과·방법 부분을 문서 순서로 더 채운다
  for (const s of [...byRole('results'), ...byRole('method')]) take(s);
  const chosen = pool.filter((s) => picked.has(s.id));
  return { sections: chosen, chars: used, totalChars: total, scope: describeSelection(chosen, used, total), warnings: structureWarnings(sections) };
}

/** 보내는 조각의 사람이 읽는 설명 (자동·직접 선택 공통) */
function describeSelection(chosen: Section[], used: number, total: number, prefix = ''): string {
  return chosen.length
    ? `${prefix}원문 ${total.toLocaleString()}자 중 ${used.toLocaleString()}자(${Math.round((used / (total || 1)) * 100)}%): ${chosen.map((s) => `[${ROLE_LABEL[roleOf(s)]}] ${s.title}(${pagesOf(s)})`).join(', ')}`
    : '원문에서 분석 범위에 맞는 부분을 찾지 못함';
}

/**
 * 사용자가 직접 고른 조각 (장·절 인식이 틀려도 쪽 범위·조각 단위로 고를 수 있게). 문서 순서로 정렬하고
 * 모르는 id는 무시한다. 예산을 넘으면 잘라 보내지 않고 overBudget으로 알린다 (실행 화면에서 막음).
 */
export function manualSelection(sections: Section[], ids: string[], budgetChars: number): Selection & { overBudget: boolean } {
  const want = new Set(ids);
  const chosen = sections.filter((s) => want.has(s.id));
  const used = chosen.reduce((n, s) => n + s.text.length, 0);
  const total = sections.filter((s) => s.kind !== 'references').reduce((n, s) => n + s.text.length, 0);
  const overBudget = used > budgetChars;
  const warnings = overBudget ? [`직접 선택한 원문이 ${used.toLocaleString()}자로 한도 ${budgetChars.toLocaleString()}자를 넘습니다. 일부 조각을 해제하세요.`] : [];
  return { sections: chosen, chars: used, totalChars: total, scope: describeSelection(chosen, used, total, '직접 선택 — '), warnings, overBudget };
}

/** 쪽 범위와 겹치는 조각 id (문서 순서) — 장·절 제목과 상관없이 실제 쪽 기준으로 고른다 */
export const sectionsInPages = (sections: Section[], from: number, to: number): string[] =>
  sections.filter((s) => s.pageTo >= Math.min(from, to) && s.pageFrom <= Math.max(from, to)).map((s) => s.id);

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
