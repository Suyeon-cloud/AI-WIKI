/**
 * KCI(한국학술지인용색인) 학술논문 PDF에서 서지사항·초록·주제어 추출
 * 1) 규칙 기반 추출: DOI, 권·호, 쪽, 학술지명, 국문/영문 초록, 주제어 (KCI·DBpia 표지 형식 포함)
 * 2) (선택) Claude로 보완: 규칙으로 찾지 못한 항목을 첫 몇 쪽의 텍스트로 다시 추출
 * 추출 결과는 바로 저장하지 않고, 사용자가 확인 창에서 고친 뒤 라이브러리에 넣는다.
 */
import type { Bib } from '../types';
import type { PdfText } from './pdf';
import { generate } from './ai';
import { normalizeDoi } from './citation';

export interface KciMeta {
  title: string;
  titleEn?: string;
  authors: string[];
  year: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  doi: string;
  abstractKo: string;
  abstractEn: string;
  keywords: string[];
  /** 각 항목을 어디서 얻었는지 */
  source: 'rule' | 'ai' | 'rule+ai';
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const firstMatch = (text: string, res: RegExp[]) => {
  for (const re of res) {
    const m = text.match(re);
    if (m) return m;
  }
  return null;
};

/** '라벨 : 값' 형식의 표지 (DBpia·KCI 원문 표지 등) */
function labeled(text: string, labels: string[]): string {
  const re = new RegExp(`(?:^|\\n)\\s*(?:${labels.join('|')})\\s*[:：]\\s*(.+)`, 'i');
  return clean(text.match(re)?.[1]);
}

/** 초록 본문: 시작 표지 다음부터 끝 표지 전까지 */
function section(text: string, starts: RegExp, ends: RegExp, max = 3000): string {
  const s = text.search(starts);
  if (s < 0) return '';
  const after = text.slice(s).replace(starts, '');
  const e = after.search(ends);
  return clean((e >= 0 ? after.slice(0, e) : after).slice(0, max));
}

function splitList(s: string): string[] {
  return Array.from(new Set(s.split(/\s*[,，;·ㆍ]\s*/).map((x) => x.replace(/[.\s]+$/, '').trim()).filter((x) => x && x.length < 40)));
}

/** 규칙 기반 추출 */
export function parseKci(pdf: PdfText, fileName: string): KciMeta {
  const head = pdf.pages.slice(0, 3).join('\n');
  const all = pdf.pages.join('\n');

  const doi = normalizeDoi(firstMatch(head, [/doi\.org\/(10\.\d{4,9}\/[^\s,;]+)/i, /DOI\s*[:：]?\s*(10\.\d{4,9}\/[^\s,;]+)/i])?.[1] ?? labeled(head, ['DOI']));

  // 권·호·쪽·연도
  const volIss = firstMatch(head, [
    /Vol\.?\s*(\d+)\s*,?\s*No\.?\s*(\d+)/i,
    /제\s*(\d+)\s*권\s*제?\s*(\d+)\s*호/,
    /(\d+)\s*권\s*(\d+)\s*호/,
  ]);
  const jip = head.match(/제\s*(\d+)\s*집/);
  const pages = firstMatch(head, [/pp?\.\s*(\d+)\s*[-–~]\s*(\d+)/i, /(\d+)\s*[-–~]\s*(\d+)\s*\(\s*\d+\s*pages?\)/i, /(\d{1,4})\s*[-–~]\s*(\d{1,4})\s*쪽/]);
  const year = firstMatch(head, [/(?:Vol\.?\s*\d+[^\n]{0,40}?)\b((?:19|20)\d{2})\b/i, /\b((?:19|20)\d{2})\s*[.년]\s*\d{1,2}/, /\(((?:19|20)\d{2})\)/, /\b((?:19|20)\d{2})\b/]);

  // 학술지명: 「」/『』 안, 또는 표지의 '출처/학술지명'
  const source = labeled(head, ['출처', 'Source', '학술지명', '학술지']);
  const journal =
    clean(head.match(/[「『]([^」』\n]{2,40})[」』]/)?.[1]) ||
    clean(source.split(/\s+\d|,/)[0]) ||
    clean(head.match(/^([가-힣A-Za-z\s]{2,30}(?:학회지|논문지|연구|학보|논총|저널|Journal[^\n]{0,40}))\s*$/m)?.[1]);

  const publisher = labeled(head, ['발행처', 'Publisher', '발행기관']);

  // 제목: 표지 라벨 → 1쪽의 가장 큰 글자 → PDF 문서 정보 → 파일명
  const labeledTitle = labeled(head, ['논문명', '논문 제목', 'Title']);
  const bigTitle = pdf.largestLines.filter((l) => !/^(vol|no\.|issn|doi|\d+)$/i.test(l) && l.length >= 4).join(' ');
  const title = labeledTitle || clean(bigTitle) || clean(pdf.title) || fileName.replace(/\.pdf$/i, '');

  // 저자: 표지 라벨 → 제목 다음 줄의 한글 이름 목록
  let authors = splitList(labeled(head, ['저자', 'Authors?', '저자명']).replace(/\([^)]*\)/g, ''));
  if (!authors.length) {
    const lines = head.split('\n').map((l) => l.trim());
    const ti = lines.findIndex((l) => title.startsWith(l.slice(0, 8)) && l.length > 3);
    for (const l of lines.slice(Math.max(0, ti + 1), ti + 6)) {
      const names = l.replace(/[*†‡\d)）]+/g, ' ').match(/[가-힣]{2,4}/g);
      if (names && names.length <= 6 && l.length < 60 && !/(대학교|학과|연구|교수|강사|과정)/.test(l)) {
        authors = names;
        break;
      }
    }
  }
  if (!authors.length && pdf.author) authors = splitList(pdf.author);

  const endKo = /(주제어|핵심어|주요어|키워드|검색어)\s*[:：]?|\n\s*(Ⅰ|I)\s*\.|\n\s*1\s*\.\s*서\s*론|\n\s*Abstract\b/i;
  const abstractKo = section(all, /(국문\s*초록|국\s*문\s*요\s*약|【\s*요\s*약\s*】|\n\s*요\s*약\s*\n|\n\s*초\s*록\s*\n|<\s*요\s*약\s*>)/, endKo);
  const abstractEn = section(all, /\n\s*(ABSTRACT|Abstract)\b\s*\n?/, /(Key\s*words?|Keywords)\s*[:：]?/i);
  const kwKo = all.match(/(?:주제어|핵심어|주요어|키워드|검색어)\s*[:：]?\s*([^\n]{2,200})/)?.[1] ?? '';

  return {
    title,
    authors,
    year: year?.[1] ?? '',
    journal,
    volume: volIss?.[1] ?? jip?.[1] ?? '',
    issue: volIss?.[2] ?? '',
    pages: pages ? `${pages[1]}-${pages[2]}` : '',
    publisher,
    doi,
    abstractKo,
    abstractEn,
    keywords: splitList(kwKo),
    source: 'rule',
  };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'titleEn', 'authors', 'year', 'journal', 'volume', 'issue', 'pages', 'publisher', 'doi', 'abstractKo', 'abstractEn', 'keywords'],
  properties: {
    title: { type: 'string', description: '논문 제목 (원문 언어 그대로)' },
    titleEn: { type: 'string', description: '영문 제목. 없으면 빈 문자열' },
    authors: { type: 'array', items: { type: 'string' }, description: '저자 이름 (원문 표기 그대로, 소속·각주 기호 제외)' },
    year: { type: 'string', description: '발행 연도 YYYY. 모르면 빈 문자열' },
    journal: { type: 'string', description: '학술지명' },
    volume: { type: 'string' },
    issue: { type: 'string' },
    pages: { type: 'string', description: '시작쪽-끝쪽' },
    publisher: { type: 'string', description: '발행 기관(학회). 모르면 빈 문자열' },
    doi: { type: 'string', description: '10.으로 시작하는 DOI. 없으면 빈 문자열' },
    abstractKo: { type: 'string', description: '국문 초록 원문 그대로. 없으면 빈 문자열' },
    abstractEn: { type: 'string', description: '영문 초록 원문 그대로. 없으면 빈 문자열' },
    keywords: { type: 'array', items: { type: 'string' }, description: '주제어(국문 우선)' },
  },
} as const;

/** Claude로 서지 보완 — 규칙 추출 결과보다 AI 결과를 우선하되, AI가 비운 항목은 규칙 결과 유지 */
export async function refineWithAi(pdf: PdfText, rule: KciMeta, signal?: AbortSignal): Promise<KciMeta> {
  const text = pdf.pages.slice(0, 4).join('\n\n----- 다음 쪽 -----\n\n').slice(0, 24000);
  const { data } = await generate<Omit<KciMeta, 'source'>>({
    system:
      '너는 한국 학술논문 PDF에서 서지사항을 정확히 옮겨 적는 도우미다. 주어진 텍스트에 실제로 있는 내용만 옮기고, 없는 항목은 빈 값으로 둔다. 추측하거나 만들어 내지 않는다.',
    content: `다음은 KCI 학술논문 PDF의 앞부분 텍스트다. 서지사항·초록·주제어를 추출하라.\n\n파일명: ${rule.title}\n\n${text}`,
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8000,
    effort: 'low',
    signal,
  });
  const pick = (a: string | undefined, b: string) => clean(a) || b;
  return {
    title: pick(data.title, rule.title),
    titleEn: clean(data.titleEn) || rule.titleEn,
    authors: data.authors?.length ? data.authors.map(clean).filter(Boolean) : rule.authors,
    year: pick(data.year, rule.year),
    journal: pick(data.journal, rule.journal),
    volume: pick(data.volume, rule.volume),
    issue: pick(data.issue, rule.issue),
    pages: pick(data.pages, rule.pages),
    publisher: pick(data.publisher, rule.publisher),
    doi: normalizeDoi(pick(data.doi, rule.doi)),
    abstractKo: pick(data.abstractKo, rule.abstractKo),
    abstractEn: pick(data.abstractEn, rule.abstractEn),
    keywords: data.keywords?.length ? data.keywords.map(clean).filter(Boolean) : rule.keywords,
    source: 'rule+ai',
  };
}

/** 추출 결과 → 참고문헌 서지정보 (학술지 논문) */
export function kciToBib(k: KciMeta): Bib {
  return {
    type: 'journal',
    author: k.authors.join('; '),
    authors: k.authors.length ? k.authors : undefined,
    year: k.year,
    publisher: k.publisher,
    title: k.title,
    container: k.journal || undefined,
    volume: k.volume || undefined,
    issue: k.issue || undefined,
    pages: k.pages || undefined,
    doi: k.doi || undefined,
  };
}
