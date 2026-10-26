/**
 * Claude API 호출 (브라우저에서 직접 호출 — 별도 백엔드 없음)
 * - API 키: .env의 VITE_ANTHROPIC_API_KEY 또는 연구 설정 화면에서 입력한 키
 *   입력한 키는 기본적으로 이 탭(sessionStorage)에만 두고, '이 브라우저에 기억'을 고른 경우에만 localStorage에 둔다.
 *   백업 파일에는 넣지 않는다.
 * - 모델: Claude Opus 5.5, adaptive thinking. 거절(refusal) 시 서버 측 fallback 사용.
 */
import Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = 'claude-opus-5-5';
export const AI_MODEL_LABEL = 'Claude Opus 5.5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORTS: { key: Effort; label: string }[] = [
  { key: 'low', label: '빠르게' },
  { key: 'medium', label: '보통' },
  { key: 'high', label: '꼼꼼하게' },
  { key: 'xhigh', label: '매우 꼼꼼하게' },
];

const ENV_KEY = (import.meta.env.VITE_ANTHROPIC_API_KEY ?? '').trim();
const KEY = 'ai-wiki:anthropic-key';
const EFFORT_KEY = 'ai-wiki:ai-effort';

const listeners = new Set<() => void>();
export function subscribeAi(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const emit = () => listeners.forEach((l) => l());

function readKey(): string {
  if (ENV_KEY) return ENV_KEY;
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function aiState() {
  const key = readKey();
  let effort: Effort = 'high';
  try {
    const e = localStorage.getItem(EFFORT_KEY);
    if (EFFORTS.some((x) => x.key === e)) effort = e as Effort;
  } catch {
    /* 기본값 */
  }
  let remembered = false;
  try {
    remembered = !!localStorage.getItem(KEY);
  } catch {
    /* 무시 */
  }
  return { configured: !!key, fromEnv: !!ENV_KEY, remembered, masked: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : '', effort };
}

export function setApiKey(key: string, remember: boolean) {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
    if (key.trim()) (remember ? localStorage : sessionStorage).setItem(KEY, key.trim());
  } catch {
    /* 저장 불가 환경 */
  }
  emit();
}

export function setEffort(e: Effort) {
  try {
    localStorage.setItem(EFFORT_KEY, e);
  } catch {
    /* 무시 */
  }
  emit();
}

export class AiError extends Error {}

export type UserContent = string | Anthropic.Beta.BetaContentBlockParam[];

export interface AiResult<T> {
  text: string;
  data: T;
  model: string;
}

/**
 * 한 번의 요청. schema를 주면 구조화된 JSON 응답(output_config.format)을 받아 파싱한다.
 * onProgress는 받은 글자 수를 알려 진행 상황을 보여주는 데 쓴다.
 */
export async function generate<T = string>(o: {
  system: string;
  content: UserContent;
  schema?: Record<string, unknown>;
  maxTokens?: number;
  effort?: Effort;
  onProgress?: (chars: number) => void;
  signal?: AbortSignal;
}): Promise<AiResult<T>> {
  const apiKey = readKey();
  if (!apiKey) throw new AiError('Claude API 키가 설정되지 않았습니다. 연구 설정 → AI 설정에서 키를 입력하세요.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const effort = o.effort ?? aiState().effort;
  let chars = 0;
  try {
    const stream = client.beta.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: o.maxTokens ?? 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort, ...(o.schema ? { format: { type: 'json_schema', schema: o.schema } } : {}) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: o.system,
        messages: [{ role: 'user', content: o.content }],
      },
      { signal: o.signal },
    );
    stream.on('text', (t) => {
      chars += t.length;
      o.onProgress?.(chars);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AiError('AI가 이 요청에 응답하지 않았습니다. 요청 내용을 바꿔 다시 시도하세요.');
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (msg.stop_reason === 'max_tokens') throw new AiError('응답이 너무 길어 중간에 끊겼습니다. 대상 자료나 범위를 줄여 다시 시도하세요.');
    if (!o.schema) return { text, data: text as T, model: msg.model };
    try {
      return { text, data: JSON.parse(text) as T, model: msg.model };
    } catch {
      throw new AiError('AI 응답 형식을 읽지 못했습니다. 다시 시도하세요.');
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('API 키가 올바르지 않습니다. 연구 설정에서 키를 확인하세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('이 API 키로는 해당 모델을 사용할 수 없습니다.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('요청이 많아 잠시 제한되었습니다. 1분 뒤 다시 시도하세요.');
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`요청 오류: ${e.message}`);
    if (e instanceof Anthropic.APIUserAbortError) throw new AiError('요청을 취소했습니다.');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Claude API에 연결할 수 없습니다. 인터넷 연결을 확인하세요.');
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude API 오류 (${e.status ?? '알 수 없음'}): ${e.message}`);
    throw new AiError(e instanceof Error ? e.message : String(e));
  }
}

/** PDF 파일을 Claude 문서 입력 블록으로 (base64) */
export async function pdfBlock(file: Blob, title?: string): Promise<Anthropic.Beta.BetaContentBlockParam> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) }, ...(title ? { title } : {}) };
}
