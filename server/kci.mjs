// KCI Open API 논문 검색 중계. 요청한 사용자의 인증키만 사용하고, 저장하거나 응답·오류에 싣지 않는다.
import { jsonError, requireGoogleUser } from './auth.mjs';

const ENDPOINT = 'https://open.kci.go.kr/po/openapi/openApiSearch.kci';
const FIELDS = ['title', 'keyword', 'abstract', 'author'];
const PAGE_SIZE = 20;
const BODY_LIMIT = 4096;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => decode(m[1])).filter(Boolean);
const tag = (xml, name) => tags(xml, name)[0] ?? '';
const hasHangul = (s) => /[가-힣]/.test(s);
/** '홍길동(한국외국어대학교)' → '홍길동' */
const authorName = (s) => s.replace(/\([^)]*\)/g, '').replace(/[\d*†‡]+$/, '').trim();

export function parseKciXml(xml) {
  const total = Number(tag(xml, 'total'));
  const items = [...xml.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g)].map(([, r]) => {
    const titles = tags(r, 'article-title');
    const abstracts = tags(r, 'abstract');
    const fpage = tag(r, 'fpage');
    const lpage = tag(r, 'lpage');
    return {
      id: r.match(/<articleInfo[^>]*\barticle-id="([^"]+)"/)?.[1] ?? '',
      title: titles.find(hasHangul) ?? titles[0] ?? '',
      titleEn: titles.find((t) => !hasHangul(t)) ?? '',
      authors: tags(r, 'author').flatMap((a) => a.split(';')).map(authorName).filter(Boolean),
      journal: tag(r, 'journal-name'),
      publisher: tag(r, 'publisher-name'),
      year: tag(r, 'pub-year'),
      volume: tag(r, 'volume'),
      issue: tag(r, 'issue'),
      pages: fpage && lpage ? `${fpage}-${lpage}` : fpage,
      doi: tag(r, 'doi'),
      url: tag(r, 'url'),
      abstractKo: abstracts.find(hasHangul) ?? '',
      abstractEn: abstracts.find((a) => !hasHangul(a)) ?? '',
      citations: Number(r.match(/<citation-count[^>]*\bkci="(\d+)"/)?.[1] ?? 0),
    };
  }).filter((item) => item.title);
  // 오류 응답은 <result>에 total 없이 <resultMsg>만 담아 HTTP 200으로 온다
  return { ok: /<total[\s>]/.test(xml) || items.length > 0, total: Number.isFinite(total) ? total : items.length, items, message: tag(xml, 'resultMsg') };
}

export function createKciHandler(env, deps = {}) {
  const request = deps.fetch ?? fetch;
  return async (req) => {
    if (req.method !== 'POST') return jsonError(405, '지원하지 않는 요청입니다.');
    const auth = await requireGoogleUser(req, env, deps.fetchUser ?? request);
    if (auth.denied) return auth.denied;
    if (Number(req.headers.get('content-length')) > BODY_LIMIT) return jsonError(413, '요청이 너무 큽니다.');
    let input;
    try {
      const text = await req.text();
      if (text.length > BODY_LIMIT) return jsonError(413, '요청이 너무 큽니다.');
      input = JSON.parse(text);
    } catch { return jsonError(400, '요청 형식을 확인해 주세요.'); }
    const key = input?.kciKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9._~-]{4,128}$/.test(key)) return jsonError(400, '본인 KCI 인증키를 입력해 주세요.');
    const q = typeof input.q === 'string' ? input.q.trim() : '';
    const field = input.field ?? 'title';
    const page = Number(input.page ?? 1);
    const from = typeof input.from === 'string' ? input.from : '';
    const to = typeof input.to === 'string' ? input.to : '';
    if (!q || q.length > 200 || !FIELDS.includes(field) || !Number.isInteger(page) || page < 1 || page > 500 || !/^(\d{4})?$/.test(from) || !/^(\d{4})?$/.test(to))
      return jsonError(400, '검색 조건을 확인해 주세요.');

    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ key, apiCode: 'articleSearch', [field]: q, page: String(page), displayCount: String(PAGE_SIZE), ...(from ? { dateFrom: `${from}01` } : {}), ...(to ? { dateTo: `${to}12` } : {}) }).toString();
    let xml;
    try {
      const res = await request(url.toString(), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return jsonError(502, `KCI 서버 응답 오류입니다 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`);
      xml = await res.text();
    } catch { return jsonError(502, 'KCI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    const parsed = parseKciXml(xml);
    if (!parsed.ok) {
      const detail = parsed.message.replaceAll(key, '').slice(0, 200);
      return jsonError(502, `KCI가 검색 결과 대신 오류를 보냈습니다${detail ? ` (${detail})` : ''}. 인증키와 검색 조건을 확인해 주세요.`);
    }
    return Response.json({ total: parsed.total, page, pageSize: PAGE_SIZE, items: parsed.items }, { headers });
  };
}
