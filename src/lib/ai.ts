/** Browser client: only the same-origin server handles Claude credentials. */
import type Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase';
import { authUser, subscribeAuth } from './auth';
import { createSessionKey } from './session-key';
export const AI_MODEL = 'claude-opus-5-5';
export const AI_MODEL_LABEL = 'Claude Opus 5.5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORTS: { key: Effort; label: string }[] = [
  { key:'low', label:'빠르게' }, { key:'medium', label:'보통' },
  { key:'high', label:'꼼꼼하게' }, { key:'xhigh', label:'매우 꼼꼼하게' },
];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const sessionKey = createSessionKey();
const activeRequests = new Set<AbortController>();
let keyOwner = authUser()?.id ?? null;
subscribeAuth(() => {
  const nextOwner = authUser()?.id ?? null;
  if (keyOwner === nextOwner) return;
  keyOwner = nextOwner;
  sessionKey.syncOwner(nextOwner);
  for (const request of activeRequests) request.abort();
  emit();
});
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  sessionKey.clear();
  for (const request of activeRequests) request.abort();
  emit();
});
export function setSessionApiKey(value: string) {
  const userId = authUser()?.id;
  if (!userId) throw new AiError('먼저 로그인해 주세요.');
  const key = value.trim();
  if (key && !/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(key)) throw new AiError('Claude API 키 형식을 확인해 주세요.');
  for (const request of activeRequests) request.abort();
  if (key) sessionKey.set(userId, key); else sessionKey.clear();
  emit();
}
let status = { userId: '', configured: false, message: 'Claude 서버 설정 확인이 필요합니다.' };
export function subscribeAi(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const effortKey = () => `ai-wiki:ai-effort:${authUser()?.id ?? 'signed-out'}`;
export function aiState() {
  let effort: Effort = 'high';
  try { const value = localStorage.getItem(effortKey()); if (EFFORTS.some((e) => e.key === value)) effort = value as Effort; } catch { /* default */ }
  const hasKey = !!sessionKey.get(authUser()?.id ?? null);
  return { configured: hasKey && status.userId === authUser()?.id && status.configured, hasKey, message: hasKey ? status.message : '이 탭에서 사용할 본인 Claude API 키를 입력해 주세요.', effort };
}
export function setEffort(effort: Effort) { try { localStorage.setItem(effortKey(), effort); } catch { /* session */ } emit(); }
export class AiError extends Error {}
async function credentials() {
  if (!supabase || !authUser()) throw new AiError('먼저 Google 계정으로 로그인해 주세요.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session || session.user.id !== authUser()?.id) throw new AiError('로그인을 다시 확인해 주세요.');
  return session.access_token;
}
export async function refreshAi() {
  const userId = authUser()?.id ?? '';
  status = { userId, configured:false, message:'Claude 서버 확인 중…' }; emit();
  try {
    const response = await fetch('/api/claude', { headers:{ Authorization:`Bearer ${await credentials()}` }, cache:'no-store' });
    const result = await response.json();
    if (authUser()?.id !== userId) return;
    status = { userId, configured: response.ok && result.ready === true,
      message: response.ok ? '서버 연결 준비됨 · 입력한 키는 이 탭에서만 사용합니다.' : result.error || 'Claude 서버를 확인하지 못했습니다.' };
  } catch { if (authUser()?.id === userId) status = { userId, configured:false, message:'Claude 서버에 연결하지 못했습니다.' }; }
  emit();
}
export type UserContent = string | Anthropic.Beta.BetaContentBlockParam[];
export interface AiResult<T> { text: string; data: T; model: string }
export async function generate<T = string>(o: {
  system: string; content: UserContent; schema?: Record<string, unknown>; maxTokens?: number;
  effort?: Effort; onProgress?: (chars: number) => void; signal?: AbortSignal;
}): Promise<AiResult<T>> {
  const userId = authUser()?.id ?? '';
  const token = await credentials();
  if (authUser()?.id !== userId) throw new AiError('계정이 변경되었습니다. 다시 시도해 주세요.');
  const apiKey = sessionKey.get(userId);
  if (!apiKey) throw new AiError('연구 설정에서 본인 Claude API 키를 입력해 주세요.');
  const controller = new AbortController();
  activeRequests.add(controller);
  const abort = () => controller.abort();
  o.signal?.addEventListener('abort', abort, { once:true });
  if (o.signal?.aborted) controller.abort();
  const unsubscribe = subscribeAuth(() => { if (authUser()?.id !== userId) controller.abort(); });
  try {
    const body = JSON.stringify({ apiKey, system:o.system, content:o.content, schema:o.schema, maxTokens:o.maxTokens, effort:o.effort ?? aiState().effort });
    if (new TextEncoder().encode(body).byteLength > 4_000_000) throw new AiError('자료가 너무 큽니다. PDF는 텍스트 추출로 가져오거나 대상 범위를 줄여 주세요.');
    const response = await fetch('/api/claude', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body, signal:controller.signal });
    if (!response.ok) { const result = await response.json().catch(() => ({})); throw new AiError(result.error || 'Claude 서버 요청에 실패했습니다.'); }
    if (!response.body) throw new AiError('Claude 응답을 읽지 못했습니다.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', text = '', model = '', done = false;
    while (true) {
      const part = await reader.read();
      pending += decoder.decode(part.value, { stream:!part.done });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0,newline); pending = pending.slice(newline+1);
        if (!line) continue;
        const item = JSON.parse(line);
        if (item.type === 'error') throw new AiError(item.error);
        if (item.type === 'text') { text += item.text; o.onProgress?.(text.length); }
        if (item.type === 'done') { done = true; model = item.model; }
      }
      if (part.done) break;
    }
    if (!done || authUser()?.id !== userId) throw new AiError('응답이 중단되었습니다. 결과는 저장하지 않았습니다.');
    if (!o.schema) return { text, data:text as T, model };
    try { return { text, data:JSON.parse(text) as T, model }; }
    catch { throw new AiError('AI 응답 형식을 읽지 못했습니다. 다시 시도해 주세요.'); }
  } catch (e) {
    const wasAborted = controller.signal.aborted;
    controller.abort();
    if (e instanceof AiError) throw e;
    throw new AiError(wasAborted ? '요청이 취소되었거나 연결이 중단되었습니다.' : 'Claude 응답을 처리하지 못했습니다.');
  } finally { o.signal?.removeEventListener('abort', abort); unsubscribe(); activeRequests.delete(controller); }
}

/** PDF 파일을 Claude 문서 입력 블록으로 (base64) */
export async function pdfBlock(file: Blob, title?: string): Promise<Anthropic.Beta.BetaContentBlockParam> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) }, ...(title ? { title } : {}) };
}
