/**
 * AI 모델·단가·한도 설정과 비용 추정 (서버 호출 없음).
 * 단가는 기본값을 두고 사용자가 연구 설정에서 바꿀 수 있다 (계정별 localStorage, 비밀값 아님).
 */

export interface ModelPrice {
  /** 입력·출력 100만 토큰당 달러 */
  input: number;
  output: number;
  /** 이 입력 토큰 수를 넘는 요청은 high 단가 (없으면 단일 단가) */
  tierAbove?: number;
  inputHigh?: number;
  outputHigh?: number;
}
export interface ModelInfo {
  id: string;
  label: string;
  note: string;
}

/** 서버(server/claude.mjs)의 허용 목록과 같아야 한다 */
export const AI_MODELS: ModelInfo[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '저비용 · 기본' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '중간' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '고성능 · 고비용' },
];
export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** AI 집필 기본 모델 (긴 원고 품질을 위해 중간 모델) */
export const DEFAULT_WRITING_MODEL = 'claude-sonnet-5-5';
export const modelLabel = (id: string | undefined) => AI_MODELS.find((m) => m.id === id)?.label ?? id ?? 'Claude';
export const isModel = (x: unknown): x is string => AI_MODELS.some((m) => m.id === x);

/** 2026-11 기준 Anthropic API 표준 단가 (연구 설정에서 수정 가능) */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, tierAbove: 100_000, inputHigh: 0.5, outputHigh: 2.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

export interface CostSettings {
  /** AI 분석·서지 보정·관련도 등 기본 모델 */
  model: string;
  /** AI 집필(목차·장 본문·초록) 기본 모델 */
  writingModel: string;
  prices: Record<string, ModelPrice>;
  /** 한 번의 분석(여러 호출 포함)에서 허용하는 입력 토큰·비용 상한 */
  maxInputTokens: number;
  maxCostUsd: number;
}
export const DEFAULT_COST: CostSettings = { model: DEFAULT_MODEL, writingModel: DEFAULT_WRITING_MODEL, prices: DEFAULT_PRICES, maxInputTokens: 60_000, maxCostUsd: 0.3 };

const num = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : undefined);

/** 저장된 값 검증 (형식이 틀린 항목은 기본값) */
export function normCost(x: unknown): CostSettings {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const prices: Record<string, ModelPrice> = {};
  for (const m of AI_MODELS) {
    const p = ((o.prices as Record<string, unknown> | undefined)?.[m.id] ?? {}) as Record<string, unknown>;
    const d = DEFAULT_PRICES[m.id];
    prices[m.id] = {
      ...d,
      input: num(p.input, 0, 1000) ?? d.input,
      output: num(p.output, 0, 1000) ?? d.output,
      ...(d.tierAbove ? { inputHigh: num(p.inputHigh, 0, 1000) ?? d.inputHigh, outputHigh: num(p.outputHigh, 0, 1000) ?? d.outputHigh } : {}),
    };
  }
  return {
    model: isModel(o.model) ? o.model : DEFAULT_MODEL,
    writingModel: isModel(o.writingModel) ? o.writingModel : DEFAULT_WRITING_MODEL,
    prices,
    maxInputTokens: num(o.maxInputTokens, 1000, 1_000_000) ?? DEFAULT_COST.maxInputTokens,
    maxCostUsd: num(o.maxCostUsd, 0.001, 100) ?? DEFAULT_COST.maxCostUsd,
  };
}

/** 토큰 수 → 달러 (입력이 구간을 넘으면 구간 단가) */
export function costUsd(model: string, inputTokens: number, outputTokens: number, prices: Record<string, ModelPrice> = DEFAULT_PRICES): number {
  const p = prices[model] ?? DEFAULT_PRICES[model] ?? DEFAULT_PRICES[DEFAULT_MODEL];
  const high = p.tierAbove !== undefined && inputTokens > p.tierAbove;
  const i = high ? p.inputHigh ?? p.input : p.input;
  const o = high ? p.outputHigh ?? p.output : p.output;
  return (inputTokens * i + outputTokens * o) / 1_000_000;
}

export interface CallPlan {
  label: string;
  inputTokens: number;
  /** 출력 상한 (생각 토큰 포함, max_tokens) */
  maxOutputTokens: number;
}
export interface Estimate {
  model: string;
  calls: number;
  inputTokens: number;
  maxOutputTokens: number;
  /** 출력이 상한의 40%라고 볼 때 / 상한까지 다 쓸 때 */
  expectedUsd: number;
  maxUsd: number;
  overTokens: boolean;
  overCost: boolean;
}

export function estimate(model: string, calls: CallPlan[], s: CostSettings): Estimate {
  const inputTokens = calls.reduce((n, c) => n + c.inputTokens, 0);
  const maxOutputTokens = calls.reduce((n, c) => n + c.maxOutputTokens, 0);
  const sum = (ratio: number) => calls.reduce((n, c) => n + costUsd(model, c.inputTokens, Math.ceil(c.maxOutputTokens * ratio), s.prices), 0);
  const maxUsd = sum(1);
  return {
    model,
    calls: calls.length,
    inputTokens,
    maxOutputTokens,
    expectedUsd: sum(0.4),
    maxUsd,
    overTokens: inputTokens > s.maxInputTokens,
    overCost: maxUsd > s.maxCostUsd,
  };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
/** 실제 사용량 → 추정 비용 (캐시 읽기 0.1배, 캐시 쓰기 1.25배로 계산) */
export function usageCost(model: string, u: Usage, prices: Record<string, ModelPrice> = DEFAULT_PRICES): number {
  const p = prices[model] ?? DEFAULT_PRICES[model] ?? DEFAULT_PRICES[DEFAULT_MODEL];
  const allIn = u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  const high = p.tierAbove !== undefined && allIn > p.tierAbove;
  const i = high ? p.inputHigh ?? p.input : p.input;
  const o = high ? p.outputHigh ?? p.output : p.output;
  return (u.inputTokens * i + (u.cacheReadTokens ?? 0) * i * 0.1 + (u.cacheWriteTokens ?? 0) * i * 1.25 + u.outputTokens * o) / 1_000_000;
}

export const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

/* ───────── 계정별 저장 ───────── */

const key = (userId: string | null | undefined) => `ai-wiki:ai-cost:${userId ?? 'signed-out'}`;
export function loadCost(userId: string | null | undefined): CostSettings {
  try {
    return normCost(JSON.parse(localStorage.getItem(key(userId)) ?? 'null'));
  } catch {
    return normCost(null);
  }
}
export function saveCost(userId: string | null | undefined, s: CostSettings) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(normCost(s)));
  } catch {
    /* 저장 불가 환경: 이번 탭에서만 기본값 사용 */
  }
}
