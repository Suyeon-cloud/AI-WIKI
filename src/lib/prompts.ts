/**
 * AI 분석 · AI 집필 요청 내용과 응답 형식(JSON Schema)
 * - AI 분석: 모은 자료 전체(또는 한 편)를 연구자가 준 주제·키워드 기준으로 판단 → 인사이트
 * - AI 집필: 외대 학위논문 서식 스킬(SKILL.md)에 따라 장별 원고 작성
 */
import type { Analysis, Material, Project } from '../types';
import { bibAuthors, formatCitation, segsToText } from './citation';

export interface AnalysisBrief {
  topic: string;
  keywords: string[];
  view: string; // 나의 관점
  question?: string; // 이번 분석에서 특히 알고 싶은 것
}

const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…(이하 생략)` : (s ?? ''));

/** 자료 1건을 AI에 넘기는 텍스트 (ID는 결과에서 자료를 가리키는 데 사용) */
export function materialBlock(m: Material, i: number, bodyChars: number): string {
  const authors = bibAuthors(m.bib).join(', ');
  const lines = [
    `<자료 id="${m.id}" 번호="${i + 1}">`,
    `제목: ${m.bib?.title ?? m.title}`,
    authors && `저자: ${authors}`,
    m.bib?.year && `연도: ${m.bib.year}`,
    m.bib?.container && `학술지: ${m.bib.container}${m.bib.volume ? ` ${m.bib.volume}${m.bib.issue ? `(${m.bib.issue})` : ''}` : ''}`,
    `유형: ${m.sourceType}`,
    m.keywords.length && `키워드: ${m.keywords.join(', ')}`,
    `연구자가 매긴 관련도: ${m.relevance}/5`,
    m.abstract && `초록:\n${cut(m.abstract, 2500)}`,
    !m.abstract && m.content && bodyChars > 0 && `본문 일부:\n${cut(m.content, bodyChars)}`,
    m.abstract && m.content && bodyChars > 2500 && `본문 일부:\n${cut(m.content, bodyChars)}`,
    m.myView && `연구자의 관점(직접 작성): ${m.myView}`,
    m.researchLink && `내 연구와의 연결(연구자 메모): ${m.researchLink}`,
    m.researchMemo && `연구 메모: ${m.researchMemo}`,
    m.usage?.length && `연구자가 정한 논문 활용 위치: ${m.usage.join(', ')}`,
    '</자료>',
  ];
  return lines.filter(Boolean).join('\n');
}

const briefText = (b: AnalysisBrief, p: Project) =>
  [
    `연구 주제: ${b.topic}`,
    `핵심 키워드: ${b.keywords.join(', ')}`,
    p.overview && `연구 개요: ${p.overview}`,
    b.view && `연구자의 기본 관점: ${b.view}`,
    b.question && `이번 분석에서 특히 알고 싶은 것: ${b.question}`,
  ]
    .filter(Boolean)
    .join('\n');

/* ───────── 전체 분석 ───────── */

export const ANALYSIS_SYSTEM = `너는 한국 대학원생의 학위논문 선행연구 분석을 돕는 연구 조언자다.
연구자가 모은 자료 전체를 읽고, 연구자가 제시한 주제·키워드의 관점에서 판단과 인사이트를 준다.
- 반드시 제공된 자료 내용에 근거한다. 근거가 되는 자료는 id로 가리킨다. 자료에 없는 사실·문헌을 만들어 내지 않는다.
- 단순 요약 나열이 아니라, 자료들 사이의 관계(공통점, 상충, 빈틈)와 연구자의 논문에 주는 의미를 판단한다.
- 초록만 있는 자료는 초록 범위 안에서만 판단하고, 판단이 불확실하면 그렇다고 말한다.
- 한국어 학술 문체로, 구체적이고 짧게 쓴다.`;

export const COLLECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'themes', 'agreements', 'debates', 'gaps', 'differentiation', 'researchQuestions', 'materialNotes', 'nextKeywords', 'cautions'],
  properties: {
    overview: { type: 'string', description: '모은 자료 전체가 연구 주제에 대해 말해 주는 것 (3~5문장)' },
    themes: {
      type: 'array',
      description: '자료를 묶는 주제 흐름 3~6개',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'materialIds'],
        properties: { name: { type: 'string' }, description: { type: 'string' }, materialIds: { type: 'array', items: { type: 'string' } } },
      },
    },
    agreements: { type: 'array', items: { type: 'string' }, description: '여러 자료가 공통으로 지지하는 발견' },
    debates: {
      type: 'array',
      description: '자료 사이에서 엇갈리는 쟁점',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'positions', 'materialIds'],
        properties: { issue: { type: 'string' }, positions: { type: 'string' }, materialIds: { type: 'array', items: { type: 'string' } } },
      },
    },
    gaps: {
      type: 'array',
      description: '연구 공백 — 자료들이 다루지 않았거나 부족한 부분',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gap', 'evidence'],
        properties: { gap: { type: 'string' }, evidence: { type: 'string', description: '공백이라고 판단한 근거' } },
      },
    },
    differentiation: { type: 'array', items: { type: 'string' }, description: '이 공백에 비추어 연구자의 논문이 내세울 수 있는 차별점' },
    researchQuestions: { type: 'array', items: { type: 'string' }, description: '제안하는 연구 문제 2~4개' },
    materialNotes: {
      type: 'array',
      description: '자료별 역할 판단 (모든 자료)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'role', 'relevance', 'reason'],
        properties: {
          id: { type: 'string' },
          role: { type: 'string', description: '논문에서의 역할 (예: 이론적 근거, 방법 참고, 비교 대상, 주변 자료)' },
          relevance: { type: 'integer', description: '연구 주제와의 관련도 1~5' },
          reason: { type: 'string' },
        },
      },
    },
    nextKeywords: { type: 'array', items: { type: 'string' }, description: '더 수집하면 좋을 검색어 (KCI 검색용)' },
    cautions: { type: 'array', items: { type: 'string' }, description: '자료 구성의 한계·편향 (예: 특정 연도 편중, 초록만 있음)' },
  },
} as const;

export interface CollectionResult {
  overview: string;
  themes: { name: string; description: string; materialIds: string[] }[];
  agreements: string[];
  debates: { issue: string; positions: string; materialIds: string[] }[];
  gaps: { gap: string; evidence: string }[];
  differentiation: string[];
  researchQuestions: string[];
  materialNotes: { id: string; role: string; relevance: number; reason: string }[];
  nextKeywords: string[];
  cautions: string[];
}

export function collectionPrompt(b: AnalysisBrief, p: Project, ms: Material[]): string {
  // 자료가 많으면 자료당 본문 분량을 줄인다
  const body = ms.length > 40 ? 0 : ms.length > 15 ? 2000 : 5000;
  return `${briefText(b, p)}

아래는 연구자가 모은 자료 ${ms.length}건이다. 이 자료 전체를 위 주제·키워드 관점에서 분석하라.

${ms.map((m, i) => materialBlock(m, i, body)).join('\n\n')}`;
}

export function collectionToMarkdown(r: CollectionResult, b: AnalysisBrief, ms: Material[]): string {
  const name = (id: string) => {
    const i = ms.findIndex((m) => m.id === id);
    return i >= 0 ? `[${i + 1}] ${ms[i].title}` : id;
  };
  const refs = (ids: string[]) => (ids.length ? ` — ${ids.map(name).join('; ')}` : '');
  return [
    `## 분석 기준`,
    `- 주제: ${b.topic}`,
    `- 키워드: ${b.keywords.join(', ')}`,
    b.question ? `- 질문: ${b.question}` : '',
    '',
    '## 전체 개관',
    r.overview,
    '',
    '## 주제 흐름',
    ...r.themes.map((t) => `- **${t.name}**: ${t.description}${refs(t.materialIds)}`),
    '',
    '## 공통 발견',
    ...r.agreements.map((x) => `- ${x}`),
    '',
    '## 쟁점',
    ...r.debates.map((d) => `- **${d.issue}**: ${d.positions}${refs(d.materialIds)}`),
    '',
    '## 연구 공백',
    ...r.gaps.map((g) => `- **${g.gap}** (근거: ${g.evidence})`),
    '',
    '## 내 연구의 차별점',
    ...r.differentiation.map((x) => `- ${x}`),
    '',
    '## 제안 연구 문제',
    ...r.researchQuestions.map((x, i) => `- 연구 문제 ${i + 1}. ${x}`),
    '',
    '## 자료별 역할',
    ...r.materialNotes.map((n) => `- ${name(n.id)} — **${n.role}** (관련도 ${n.relevance}/5): ${n.reason}`),
    '',
    '## 더 찾아볼 검색어',
    `- ${r.nextKeywords.join(', ')}`,
    '',
    '## 자료 구성의 한계',
    ...r.cautions.map((x) => `- ${x}`),
    '',
    '## 분석 대상 자료',
    ...ms.map((m, i) => `- [${i + 1}] ${(formatCitation(m, 'APA 7') && segsToText(formatCitation(m, 'APA 7')!)) || m.title}`),
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

/* ───────── 선택 논문 분석 ───────── */

export const PAPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'topic', 'keywords', 'relevance', 'rationale', 'connection', 'insights', 'method', 'findings', 'limitations', 'usageIdea'],
  properties: {
    summary: { type: 'string', description: '논문 요약 4~6문장' },
    topic: { type: 'string', description: '논문의 핵심 주제 한 줄' },
    keywords: { type: 'array', items: { type: 'string' } },
    relevance: { type: 'integer', description: '연구자의 주제·키워드 기준 관련도 1~5' },
    rationale: { type: 'string', description: '관련도 판단 근거' },
    connection: { type: 'string', description: '연구자의 논문과 맞닿는 지점' },
    insights: { type: 'array', items: { type: 'string' }, description: '연구자에게 주는 인사이트 3~5개' },
    method: { type: 'string', description: '연구 방법 (대상, 자료, 분석 방법)' },
    findings: { type: 'string', description: '주요 결과' },
    limitations: { type: 'string', description: '한계 또는 비판적으로 볼 점' },
    usageIdea: { type: 'string', description: '연구자의 논문에서 어느 장·절에 어떻게 쓸 수 있는지' },
  },
} as const;

export function paperPrompt(b: AnalysisBrief, p: Project, m: Material): string {
  return `${briefText(b, p)}

아래 자료 한 편을 위 주제·키워드 관점에서 깊이 분석하라. 자료에 없는 내용은 추측하지 말고, 초록만 있으면 초록 범위에서 판단했다고 밝혀라.

${materialBlock(m, 0, 28000)}`;
}

export function paperToMarkdown(a: Analysis, m: Material): string {
  return [
    `## 대상 자료`,
    `- ${(formatCitation(m, 'APA 7') && segsToText(formatCitation(m, 'APA 7')!)) || m.title}`,
    '',
    '## 요약',
    a.summary,
    '',
    `## 관련도 ${a.relevance}/5`,
    a.rationale,
    '',
    '## 연구 방법',
    a.method ?? '',
    '',
    '## 주요 결과',
    a.findings ?? '',
    '',
    '## 한계',
    a.limitations ?? '',
    '',
    '## 내 논문과의 접점',
    a.connection,
    '',
    '## 인사이트',
    ...a.insights.map((x) => `- ${x}`),
    '',
    '## 활용 제안',
    a.usageIdea ?? '',
  ].join('\n');
}

/* ───────── AI 집필 ───────── */

export const OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chapters', 'rationale'],
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'sections'],
        properties: {
          title: { type: 'string', description: "장 제목, 로마 숫자 포함 (예: 'Ⅰ. 서론')" },
          sections: { type: 'array', items: { type: 'string' }, description: "절 제목, 번호 포함 (예: '1. 연구의 필요성 및 목적')" },
        },
      },
    },
    rationale: { type: 'string', description: '이 목차 구성의 이유 2~3문장' },
  },
} as const;

export const CHAPTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'citedIds', 'todo'],
  properties: {
    text: { type: 'string', description: "장 본문. 절은 '## 1. 제목', 항은 '### 1) 제목', 문단은 한 줄에 하나" },
    citedIds: { type: 'array', items: { type: 'string' }, description: '본문에서 인용한 자료 id' },
    todo: { type: 'array', items: { type: 'string' }, description: '연구자가 확인·보완해야 할 점' },
  },
} as const;

export const ABSTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['abstractKo', 'keywordsKo', 'titleEn', 'abstractEn', 'keywordsEn'],
  properties: {
    abstractKo: { type: 'string', description: '국문초록 (목적·방법·결과·의의, 한 단락 600~900자)' },
    keywordsKo: { type: 'array', items: { type: 'string' } },
    titleEn: { type: 'string' },
    abstractEn: { type: 'string', description: 'ABSTRACT (영문, 국문초록과 같은 내용)' },
    keywordsEn: { type: 'string', description: '쉼표로 구분한 영문 키워드' },
  },
} as const;

export function thesisContext(p: Project, title: string, outline: { title: string; sections: string[] }[], ms: Material[], insight?: string): string {
  return [
    `[논문 정보]`,
    `학위: ${p.degree}`,
    `논문 제목: ${title}`,
    `학과: ${p.department || '(미입력)'}`,
    `지도교수: ${p.advisor || '(미입력)'}`,
    `연구 주제: ${p.topic}`,
    `키워드: ${p.keywords.join(', ')}`,
    p.overview && `연구 개요: ${p.overview}`,
    p.defaultView && `연구자의 관점: ${p.defaultView}`,
    '',
    '[확정 목차]',
    ...outline.map((c) => `${c.title}\n${c.sections.map((s) => `  ${s}`).join('\n')}`),
    insight ? `\n[AI 전체 분석 결과 (연구자가 참고용으로 첨부)]\n${cut(insight, 6000)}` : '',
    '',
    `[자료 목록] — 인용은 이 목록의 자료만 (저자, 연도) 형식으로`,
    ...ms.map((m, i) => materialBlock(m, i, ms.length > 20 ? 0 : 1500)),
  ].join('\n');
}
