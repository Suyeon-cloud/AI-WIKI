/**
 * 가져올 자료의 논문 관련도(1~5) 초기값을 AI가 판단
 * - 현재 프로젝트의 주제·키워드·개요·기본 관점을 기준으로, 자료의 제목·키워드·초록(없으면 본문 앞부분)만 보고 판단한다.
 * - 결과는 가져오기 확인 화면에 초기값으로만 표시하며, 연구자가 바꾼 뒤 적용한다.
 */
import type { Project } from '../types';
import { generate } from './ai';

export interface RelevanceInput {
  key: string;
  title: string;
  keywords?: string[];
  text?: string; // 초록 또는 본문 앞부분
}
export interface RelevanceJudgement {
  relevance: number;
  reason: string;
}

const BATCH = 40;
const TEXT_CHARS = 1200;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'relevance', 'reason'],
        properties: {
          id: { type: 'string' },
          relevance: { type: 'integer', description: '1~5 (5: 논문의 핵심 근거, 4: 직접 관련, 3: 부분 관련, 2: 주변 자료, 1: 거의 무관)' },
          reason: { type: 'string', description: '판단 이유 한 문장' },
        },
      },
    },
  },
} as const;

const SYSTEM = `너는 대학원생의 학위논문 자료 정리를 돕는 연구 조언자다.
연구자의 논문 주제·키워드를 기준으로 각 자료가 논문에 얼마나 관련 있는지 1~5로 판단한다.
- 5: 논문의 핵심 근거가 될 자료 / 4: 주제와 직접 관련 / 3: 일부 관련 / 2: 배경·주변 자료 / 1: 거의 무관
- 주어진 제목·키워드·내용만 보고 판단하고, 정보가 부족하면 3 이하로 보수적으로 판단한다.
- 모든 자료에 대해 id를 그대로 돌려준다.`;

const cut = (s: string | undefined) => (s && s.length > TEXT_CHARS ? `${s.slice(0, TEXT_CHARS)}…` : (s ?? ''));

/** 자료를 묶음 단위로 판단. 묶음마다 onBatch로 결과를 알린다 */
export async function judgeRelevance(
  p: Project,
  items: RelevanceInput[],
  onBatch: (results: Map<string, RelevanceJudgement>, done: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const brief = [
    `논문 주제: ${p.topic}`,
    p.keywords.length ? `핵심 키워드: ${p.keywords.join(', ')}` : '',
    p.overview ? `연구 개요: ${p.overview}` : '',
    p.defaultView ? `연구자의 관점: ${p.defaultView}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH);
    const body = batch
      .map((it, i) => [`<자료 id="${i}">`, `제목: ${it.title}`, it.keywords?.length ? `키워드: ${it.keywords.join(', ')}` : '', it.text ? `내용: ${cut(it.text)}` : '', '</자료>'].filter(Boolean).join('\n'))
      .join('\n\n');
    const { data } = await generate<{ results: { id: string; relevance: number; reason: string }[] }>({
      system: SYSTEM,
      content: `${brief}\n\n아래 자료 ${batch.length}건의 관련도를 판단하라.\n\n${body}`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8000,
      effort: 'low',
      signal,
    });
    const map = new Map<string, RelevanceJudgement>();
    for (const r of data.results) {
      const it = batch[Number(r.id)];
      if (it) map.set(it.key, { relevance: Math.min(5, Math.max(1, Math.round(Number(r.relevance) || 3))), reason: r.reason });
    }
    onBatch(map, Math.min(items.length, start + BATCH));
  }
}
