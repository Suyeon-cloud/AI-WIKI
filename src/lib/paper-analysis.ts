/**
 * 초록 기반 / 원문 기반 AI 분석 요청 조립 (AI 호출 없음).
 * - 논문별 분석: 원문 기반이면 로컬에서 고른 장·절만 보내고, 응답의 인용은 원문에서 확인한다.
 * - 캐시: 근거(초록 또는 원문 해시)·분석 기준·모델·프롬프트 버전이 같으면 다시 호출하지 않는다.
 * - 전체 분석·집필: 저장된 논문별 분석을 먼저 쓰고, 분석이 없는 자료만 초록이나 원문 일부를 보탠다.
 * - 연구자 기록(나의 관점 등)과 AI 분석은 다른 표지로 구분해 보낸다.
 */
import type { Analysis, AnalysisBasis, Material, Project } from '../types';
import { bibAuthors } from './citation';
import { estimateTokens, queryTerms, sectionsBlock, selectSections, textHash, verifyEvidence, type FullTextDoc, type Selection } from './fulltext';
import { usageCost, type CallPlan, type ModelPrice, type Usage } from './ai-cost';
import { ANALYSIS_SYSTEM, PAPER_SCHEMA, briefText, materialBlock, type AnalysisBrief } from './prompts';

export const PROMPT_VERSION = 'pa-2026-11-20';
/** 출력 상한 (생각 토큰 포함) */
export const PAPER_MAX_TOKENS = 8000;
export const COLLECTION_MAX_TOKENS = 12000;
/** 원문 기반 논문 분석에 보낼 원문 글자 수 상한 */
export const PAPER_FULLTEXT_CHARS = 24000;
/** 전체 분석에서 분석이 없는 자료 1건에 보탤 원문 글자 수 */
export const COLLECTION_FULLTEXT_CHARS = 1500;

const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? ''));
export const briefKey = (b: AnalysisBrief) => textHash(JSON.stringify([b.topic.trim(), [...b.keywords].sort(), b.view.trim(), (b.question ?? '').trim()]));
export const briefTerms = (b: AnalysisBrief) => queryTerms(b.topic, b.keywords, b.question);

/** 초록 기반 분석의 근거 해시 (제목·초록, 초록이 없으면 본문 앞부분) */
const abstractSourceHash = (m: Material) => textHash(`${m.title}\n${m.abstract ?? ''}\n${m.abstract ? '' : (m.content ?? '').slice(0, 1500)}`);

export function paperCacheKey(m: Material, basis: AnalysisBasis, model: string, b: AnalysisBrief): string | null {
  const source = basis === 'fulltext' ? m.fulltext?.hash : abstractSourceHash(m);
  if (!source) return null;
  return [PROMPT_VERSION, basis, model, source, briefKey(b)].join('|');
}
/** 저장된 분석을 그대로 쓸 수 있는지 */
export const cacheHit = (m: Material, key: string | null) => !!key && m.analysis?.cacheKey === key && !!m.analysis.analyzedAt;

/* ───────── 논문별 분석 ───────── */

export const PAPER_FT_SCHEMA = {
  ...PAPER_SCHEMA,
  required: [...PAPER_SCHEMA.required, 'evidence'],
  properties: {
    ...PAPER_SCHEMA.properties,
    evidence: {
      type: 'array',
      description: '판단의 근거가 된 원문 인용 3~6개. quote는 제공된 원문에서 그대로 옮긴 연속된 문장 (150자 이내)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'quote', 'point'],
        properties: {
          section: { type: 'string', description: '인용한 원문 절 이름 (원문 태그의 절 속성)' },
          quote: { type: 'string' },
          point: { type: 'string', description: '이 인용이 뒷받침하는 판단 한 줄' },
        },
      },
    },
  },
} as const;

export interface PaperRequest {
  system: string;
  content: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  scope: string;
  selection?: Selection;
  plan: CallPlan;
}

export function paperRequest(b: AnalysisBrief, p: Project, m: Material, basis: AnalysisBasis, doc?: FullTextDoc, budgetChars = PAPER_FULLTEXT_CHARS): PaperRequest {
  const head = briefText(b, p);
  let content: string;
  let scope: string;
  let selection: Selection | undefined;
  if (basis === 'fulltext' && doc) {
    selection = selectSections(doc.sections, briefTerms(b), budgetChars);
    scope = `${selection.scope} — PDF 전체가 아닌 선별 부분(최대 ${budgetChars.toLocaleString()}자)`;
    content = `${head}

아래 논문 한 편을 위 주제·키워드 관점에서 분석하라.
- 근거는 아래 [자료]의 서지·초록과 <원문> 조각에만 둔다. 원문 조각은 전체 원문 중 일부다(분석 범위: ${scope}).
- 제공되지 않은 부분의 내용은 추측하지 말고, 필요하면 "제공된 범위에서 확인되지 않음"이라고 쓴다.
- evidence의 quote는 <원문>에서 글자 그대로 옮긴다. 연구자 기록은 연구자의 해석이므로 원문 근거로 쓰지 않는다.

${materialBlock(m, 0, 0)}

${sectionsBlock(selection.sections)}`;
  } else {
    scope = m.abstract ? '서지·초록' : m.content ? '서지·본문 앞부분(1,500자)' : '서지 정보만';
    content = `${head}

아래 자료 한 편을 위 주제·키워드 관점에서 분석하라. 근거 범위는 ${scope}이다. 이 범위에 없는 연구 방법·결과는 추측하지 말고 "초록에서 확인되지 않음"이라고 쓴다.

${materialBlock(m, 0, 1500)}`;
  }
  const schema = (basis === 'fulltext' && doc ? PAPER_FT_SCHEMA : PAPER_SCHEMA) as unknown as Record<string, unknown>;
  return {
    system: ANALYSIS_SYSTEM,
    content,
    schema,
    maxTokens: PAPER_MAX_TOKENS,
    scope,
    selection,
    plan: { label: m.title, inputTokens: estimateTokens(ANALYSIS_SYSTEM + content + JSON.stringify(schema)), maxOutputTokens: PAPER_MAX_TOKENS },
  };
}

type PaperData = Omit<Analysis, 'citationCandidate' | 'model' | 'analyzedAt' | 'evidence' | 'basis' | 'cacheKey' | 'scope' | 'usage'> & {
  evidence?: { section: string; quote: string; point?: string }[];
};

/** 응답 → 저장할 분석 (인용 확인, 범위·사용량·캐시 키 기록) */
export function finishPaper(o: {
  data: PaperData;
  basis: AnalysisBasis;
  doc?: FullTextDoc;
  scope: string;
  model: string;
  usage?: Usage;
  prices?: Record<string, ModelPrice>;
  cacheKey: string | null;
  /** 실제로 보낸 원문 절 id (원문 기반) */
  sectionIds?: string[];
  now?: Date;
}): Analysis {
  const { data } = o;
  const usage = o.usage ? { inputTokens: o.usage.inputTokens + (o.usage.cacheReadTokens ?? 0) + (o.usage.cacheWriteTokens ?? 0), outputTokens: o.usage.outputTokens, costUsd: usageCost(o.model, o.usage, o.prices) } : undefined;
  return {
    summary: data.summary,
    topic: data.topic,
    keywords: data.keywords ?? [],
    relevance: Math.min(5, Math.max(1, Math.round(data.relevance))),
    rationale: data.rationale,
    connection: data.connection,
    insights: data.insights ?? [],
    citationCandidate: '',
    method: data.method,
    findings: data.findings,
    limitations: data.limitations,
    usageIdea: data.usageIdea,
    model: o.model,
    analyzedAt: (o.now ?? new Date()).toISOString(),
    basis: o.basis,
    cacheKey: o.cacheKey ?? undefined,
    scope: o.scope,
    evidence: o.basis === 'fulltext' && o.doc && data.evidence ? verifyEvidence(data.evidence, o.doc.sections) : undefined,
    sources: o.basis === 'fulltext' && o.doc && o.sectionIds ? { hash: o.doc.hash, sectionIds: o.sectionIds } : undefined,
    usage,
  };
}

/* ───────── 전체 분석 · 집필용 압축 블록 ───────── */

/**
 * 자료 1건의 압축 블록: 서지 + [AI 분석](있으면) + [연구자 기록] + (분석이 없으면) 초록 또는 원문 일부.
 * extra는 원문에서 고른 조각 (분석이 없을 때만 붙인다).
 */
export function compactBlock(m: Material, i: number, extra?: Selection): string {
  const a = m.analysis?.analyzedAt ? m.analysis : undefined;
  const ev = a?.evidence?.filter((e) => e.verified).slice(0, 2) ?? [];
  const lines = [
    `<자료 id="${m.id}" 번호="${i + 1}">`,
    `제목: ${m.bib?.title ?? m.title}`,
    bibAuthors(m.bib).length && `저자: ${bibAuthors(m.bib).join(', ')}`,
    m.bib?.year && `연도: ${m.bib.year}`,
    a && `[AI 분석 · ${a.basis === 'fulltext' ? '원문 기반' : '초록 기반'}${a.scope ? ` · 범위: ${cut(a.scope, 120)}` : ''}]`,
    a && `요약: ${cut(a.summary, 500)}`,
    a?.method && `방법: ${cut(a.method, 250)}`,
    a?.findings && `결과: ${cut(a.findings, 300)}`,
    a?.limitations && `한계: ${cut(a.limitations, 200)}`,
    ...ev.map((e) => `원문 근거(${e.section}${e.pages ? `, p.${e.pages}` : ''}): "${cut(e.quote, 150)}"`),
    !a && m.abstract && `초록: ${cut(m.abstract, 1200)}`,
    !a && extra?.sections.length && `원문 일부(${extra.scope}):\n${sectionsBlock(extra.sections)}`,
    !a && !m.abstract && !extra?.sections.length && '(초록·원문 없음 — 제목 수준에서만 판단 가능)',
    (m.myView || m.researchLink || m.researchMemo) && '[연구자 기록 — AI 분석이 아닌 연구자의 해석]',
    m.myView && `나의 관점: ${cut(m.myView, 400)}`,
    m.researchLink && `내 연구와의 연결: ${cut(m.researchLink, 250)}`,
    m.researchMemo && `연구 메모: ${cut(m.researchMemo, 250)}`,
    '</자료>',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * 전체 분석 요청. 분석이 없는 자료는 원문 기반이면 원문에서 짧게 골라 보탠다 (부족한 근거만 원문에서).
 */
export function collectionRequest(b: AnalysisBrief, p: Project, ms: Material[], basis: AnalysisBasis, docs: Map<string, FullTextDoc>) {
  const terms = briefTerms(b);
  let fromAnalysis = 0;
  let fromFulltext = 0;
  const blocks = ms.map((m, i) => {
    if (m.analysis?.analyzedAt) fromAnalysis++;
    const doc = !m.analysis?.analyzedAt && basis === 'fulltext' ? docs.get(m.id) : undefined;
    const extra = doc ? selectSections(doc.sections, terms, COLLECTION_FULLTEXT_CHARS) : undefined;
    if (extra?.sections.length) fromFulltext++;
    return compactBlock(m, i, extra);
  });
  const scope = `자료 ${ms.length}건: 저장된 논문별 분석 ${fromAnalysis}건, 원문 일부 보충 ${fromFulltext}건, 나머지 ${ms.length - fromAnalysis - fromFulltext}건은 초록·서지`;
  const content = `${briefText(b, p)}

아래는 연구자가 모은 자료 ${ms.length}건이다 (${scope}). 이 자료 전체를 위 주제·키워드 관점에서 분석하라.
- [AI 분석]은 이전 분석 결과, [연구자 기록]은 연구자의 해석이다. 둘을 구분해 활용하고 근거 범위를 넘는 추측은 하지 않는다.

${blocks.join('\n\n')}`;
  return { content, scope, fromAnalysis, fromFulltext, inputTokens: estimateTokens(ANALYSIS_SYSTEM + content) };
}

/**
 * 집필용 원문 근거: 장 제목·절로 검색해 근거 자료의 원문에서 조각을 고른다 (자료당 최대 2조각, 전체 budgetChars).
 * 원문 전체는 보내지 않는다.
 */
export function writingEvidence(terms: string[], ms: Material[], docs: Map<string, FullTextDoc>, budgetChars = 8000): { block: string; used: number; materials: number } {
  const per = Math.max(800, Math.floor(budgetChars / Math.max(1, docs.size)));
  let used = 0;
  let count = 0;
  const parts: string[] = [];
  ms.forEach((m, i) => {
    const doc = docs.get(m.id);
    if (!doc || used >= budgetChars) return;
    const sel = selectSections(doc.sections, terms, Math.min(per, budgetChars - used));
    const chosen = sel.sections.filter((s) => s.kind !== 'abstract').slice(0, 2);
    if (!chosen.length) return;
    used += chosen.reduce((n, s) => n + s.text.length, 0);
    count++;
    parts.push(`<원문근거 자료id="${m.id}" 번호="${i + 1}">\n${sectionsBlock(chosen)}\n</원문근거>`);
  });
  return { block: parts.join('\n\n'), used, materials: count };
}
