import Anthropic from '@anthropic-ai/sdk';
import { requireGoogleUser } from './auth.mjs';
const MODEL = 'claude-opus-5-5';
const LIMIT = 4_000_000;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (status, message) => Response.json({ error: message }, { status, headers });
// Classify internally; never return provider messages, headers, prompts or keys.
export function upstreamError(e) {
  const status = Number.isInteger(e?.status) ? e.status : null;
  const raw = [e?.message, e?.error?.message, e?.error?.error?.message].filter((v) => typeof v === 'string').join(' ').toLowerCase();
  let message;
  if (status === 401) message = 'API 키 인증에 실패했습니다. 키를 잘못 복사했거나 폐기·만료된 키인지 확인해 주세요.';
  else if (status === 402 || (status === 400 && /credit|balance|billing|payment|spend limit|spending limit/.test(raw)))
    message = 'Claude API 결제·크레딧·지출 한도를 확인해 주세요. Claude 채팅 구독과 API 사용 요금은 별개입니다.';
  else if (status === 403) message = '이 API 키에는 요청한 모델을 사용할 권한이 없습니다. Claude Console의 조직·워크스페이스 권한을 확인해 주세요.';
  else if (status === 404) message = '요청한 Claude 모델 또는 API 경로를 찾지 못했습니다. 앱의 모델 설정과 계정의 모델 접근 여부를 확인해야 합니다.';
  else if (status === 400) message = 'Claude가 앱의 요청 형식이나 옵션을 받아들이지 못했습니다. 앱의 요청 설정을 점검해야 하며, 키 오류로 단정할 수 없습니다.';
  else if (status === 413) message = 'Claude 요청 자료가 너무 큽니다. 대상 자료나 PDF 범위를 줄여 주세요.';
  else if (status === 429) message = 'Claude 요청량 또는 사용 한도에 도달했습니다. API 사용 한도와 크레딧을 확인하고 잠시 후 다시 시도해 주세요.';
  else if (status === 529) message = 'Claude 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.';
  else if (status && status >= 500) message = 'Claude 서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  else if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError') message = '앱 서버에서 Claude API에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.';
  else message = 'Claude 응답을 처리하지 못했습니다. 연결 또는 앱의 요청 설정을 추가로 확인해야 합니다.';
  return `[Claude ${status ? `HTTP ${status}` : '연결 오류'}] ${message}`;
}

async function bodyJson(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('format');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('format');
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function validContent(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  return Array.isArray(content) && content.length > 0 && content.length <= 100 && content.every((block) =>
    block?.type === 'text' ? typeof block.text === 'string' :
    block?.type === 'document' && block.source?.type === 'base64' && block.source.media_type === 'application/pdf' && typeof block.source.data === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(block.source.data));
}
export function createClaudeHandler(env, deps = {}) {
  const fetchUser = deps.fetch ?? fetch;
  const makeStream = deps.makeStream ?? ((params, options) => new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: 240000 }).beta.messages.stream(params, { signal: options.signal }));
  return async (request) => {
    if (!['GET', 'POST'].includes(request.method)) return error(405, '지원하지 않는 요청입니다.');
    const auth = await requireGoogleUser(request, env, fetchUser);
    if (auth.denied) return auth.denied;
    if (request.method === 'GET') return Response.json({ ready: true, mode: 'byok', model: MODEL }, { headers });
    if (Number(request.headers.get('content-length')) > LIMIT) return error(413, '자료가 너무 큽니다. PDF는 텍스트 추출로 가져오거나 범위를 줄여 주세요.');
    let input;
    try { input = await bodyJson(request); } catch (e) { return error(e.message === 'size' ? 413 : 400, '자료가 너무 크거나 요청 형식이 올바르지 않습니다.'); }
    if (typeof input?.apiKey !== 'string' || input.apiKey.length > 256 || !/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(input.apiKey)) return error(400, '본인 Claude API 키를 입력해 주세요.');
    if (!input || typeof input.system !== 'string' || input.system.length > 200000 || !validContent(input.content) ||
        (input.maxTokens !== undefined && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32000)) ||
        (input.effort !== undefined && !['low','medium','high','xhigh'].includes(input.effort)) ||
        (input.schema !== undefined && (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema)))) return error(400, '요청 형식을 확인해 주세요.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) controller.abort();
    let heartbeat;
    const cleanup = () => { clearInterval(heartbeat); clearTimeout(timeout); request.signal.removeEventListener('abort', abort); };
    const encoder = new TextEncoder();
    let stream;
    try {
      stream = makeStream({ model: MODEL, max_tokens: input.maxTokens ?? 32000, thinking: { type: 'adaptive' },
        output_config: { effort: input.effort ?? 'high', ...(input.schema ? { format: { type: 'json_schema', schema: input.schema } } : {}) },
        system: input.system, messages: [{ role: 'user', content: input.content }] }, { apiKey: input.apiKey, signal: controller.signal });
    } catch (e) { cleanup(); return error(502, upstreamError(e)); }
    const response = new ReadableStream({
      start(output) {
        const send = (data) => { if (!controller.signal.aborted) output.enqueue(encoder.encode(JSON.stringify(data) + '\n')); };
        heartbeat = setInterval(() => send({ type: 'ping' }), 10000);
        stream.on('text', (text) => send({ type: 'text', text }));
        void stream.finalMessage().then((message) => {
          if (message.stop_reason === 'max_tokens') return send({ type: 'error', error: '응답이 길어 중간에 끊겼습니다. 범위를 줄여 다시 시도해 주세요.' });
          if (message.stop_reason === 'refusal') return send({ type: 'error', error: 'AI가 요청에 응답하지 않았습니다. 요청 내용을 바꿔 주세요.' });
          send({ type: 'done', model: message.model });
        }).catch((e) => send({ type: 'error', error: controller.signal.aborted ? '응답 제한 시간을 초과했거나 요청이 취소되었습니다.' : upstreamError(e) }))
          .finally(() => { cleanup(); try { output.close(); } catch { /* cancelled */ } });
      },
      cancel() { controller.abort(); stream.abort(); cleanup(); },
    });
    return new Response(response, { headers: { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
  };
}
