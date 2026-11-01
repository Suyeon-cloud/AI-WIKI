import assert from 'node:assert/strict';
import { createClaudeHandler, upstreamError } from '../server/claude.mjs';
const env = { VITE_SUPABASE_URL:'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY:'public-test', AI_ALLOWED_EMAILS:'owner@example.com', ANTHROPIC_API_KEY:'private-test-secret' };
const KEY_A = 'sk-ant-test-key-account-a';
const KEY_B = 'sk-ant-test-key-account-b';
let lastKey;
const owner = { id:'owner-id', email:'owner@example.com', email_confirmed_at:'2026-01-01', identities:[{provider:'google'}] };
let calls=0, params;
const dependencies = {
  fetch: async (url, options) => {
    assert.equal(url,'https://example.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey,'public-test');
    if (options.headers.Authorization === 'Bearer forged') return new Response('{}',{status:401});
    return Response.json(options.headers.Authorization === 'Bearer other' ? { ...owner, email:'other@example.com' } : owner);
  },
  makeStream: (input, options) => {
    calls++; params=input;
    assert.ok([KEY_A, KEY_B].includes(options.apiKey)); lastKey=options.apiKey;
    let onText;
    return { on(_event,fn) { onText=fn; }, async finalMessage() { onText('연결됨'); return { model:input.model, stop_reason:'end_turn' }; }, abort() {} };
  },
};
const handle=createClaudeHandler(env,dependencies);
const request=(token='owner', input={system:'test',content:'hello'}, method='POST') => new Request('http://localhost/api/claude', {method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({apiKey:token==='other'?KEY_B:KEY_A,...input})}:{})});
assert.equal((await handle(request(null))).status,401);
assert.equal((await handle(request('forged'))).status,401);

assert.equal(calls,0);
console.log('PASS: anonymous and forged accounts cannot call Claude');
const noGoogle=createClaudeHandler(env,{...dependencies,fetch:async()=>Response.json({...owner,identities:[{provider:'email'}]})});
assert.equal((await noGoogle(request())).status,403);
const unconfirmed=createClaudeHandler(env,{...dependencies,fetch:async()=>Response.json({...owner,email_confirmed_at:null})});
assert.equal((await unconfirmed(request())).status,403);
assert.equal((await handle(request('owner',{system:'',content:'hi',apiKey:undefined}))).status,400);
assert.equal((await handle(request('owner',{system:'',content:'hi',apiKey:'wrong-key'}))).status,400);
console.log('PASS: confirmed Google identity required; missing or malformed personal keys fail closed');
const status=await handle(request('owner',null,'GET'));
assert.deepEqual(await status.json(),{ready:true,mode:'byok',model:'claude-opus-5-5'});
for (const input of [{system:'',content:''},{system:'',content:'hi',maxTokens:32001},{system:'',content:'hi',effort:'max'},{system:'',content:[{type:'document',source:{type:'url',url:'http://internal'}}]}]) assert.equal((await handle(request('owner',input))).status,400);
assert.equal((await handle(request('owner',{system:'',content:'a'.repeat(4_000_001)}))).status,413);
assert.equal(calls,0);
console.log('PASS: readiness reveals no secret; token limits, PDF URLs and oversized requests rejected before billing');
const response=await handle(request('owner',{system:'s',content:'hello',model:'attacker-model',apiKey:KEY_A,maxTokens:2000}));
const text=await response.text();
assert.equal(response.status,200);
assert.equal(response.headers.get('cache-control'),'no-store');
assert.ok(text.includes('연결됨'));
assert.ok(text.includes('"type":"done"'));
assert.ok(!text.includes(KEY_A));
assert.equal(lastKey,KEY_A);
assert.equal(params.max_tokens,2000);
const otherResponse=await handle(request('other'));
assert.equal(otherResponse.status,200);
await otherResponse.text();
assert.equal(lastKey,KEY_B);
console.log('PASS: each Google account uses its request key; shared server key and owner allowlist are ignored');
assert.equal(params.model,'claude-opus-5-5');
assert.equal(params.tools,undefined);
const failing=createClaudeHandler(env,{...dependencies,makeStream:()=>({on(){},async finalMessage(){throw {status:500,message:'private-test-secret prompt data'};},abort(){}})});
const failed=await (await failing(request())).text();
assert.ok(failed.includes('"type":"error"'));
assert.ok(!failed.includes('private-test-secret'));
assert.ok(!failed.includes('prompt data'));
console.log('PASS: streamed output, fixed server model and sanitized upstream errors');
const cancel=new AbortController();
let cancelled=false;
const waiting=createClaudeHandler(env,{...dependencies,makeStream:(_input,{signal})=>({on(){},finalMessage(){return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))));},abort(){cancelled=true;}})});
const req=new Request('http://localhost/api/claude',{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({apiKey:KEY_A,system:'',content:'test'}),signal:cancel.signal});
const streaming=await waiting(req);
await streaming.body.cancel();
assert.ok(cancelled);
console.log('PASS: client cancellation aborts upstream stream');

const { createSessionKey } = await import('../node_modules/.cache/ai-wiki-verify/session-key.mjs');
const vault=createSessionKey();
assert.equal(vault.get('a'),'');
vault.set('a',KEY_A);
assert.equal(vault.get('a'),KEY_A);
assert.equal(vault.get('b'),'');
vault.syncOwner('a');
assert.equal(vault.get('a'),KEY_A);
vault.syncOwner('b');
assert.equal(vault.get('a'),'');
vault.set('b',KEY_B);
vault.syncOwner(null);
assert.equal(vault.get('b'),'');
vault.set('a',KEY_A);
assert.equal(createSessionKey().get('a'),'');
vault.clear();
assert.equal(vault.get('a'),'');
console.log('PASS: key is memory-only; account switch/logout/clear/new instance erase it; same-user refresh event preserves it');

for (const [status, raw, expected] of [
  [401,'private-test-secret','인증'], [402,'private-test-secret','크레딧'],
  [400,'Your credit balance is too low. private-test-secret','크레딧'],
  [400,'max_tokens option invalid private-test-secret','요청 형식'],
  [403,'private-test-secret','권한'], [404,'private-test-secret','모델'],
  [429,'private-test-secret','사용 한도'],[529,'private-test-secret','혼잡'],[500,'private-test-secret','서버'],
]) {
  const result=upstreamError({status,message:raw});
  assert.ok(result.includes(`HTTP ${status}`));
  assert.ok(result.includes(expected));
  assert.ok(!result.includes('private-test-secret'));
}
assert.ok(upstreamError({name:'APIConnectionError',message:'private-test-secret'}).includes('네트워크'));
console.log('PASS: auth/billing/permissions/model/request/rate/server/network errors distinguished without raw sensitive details');

const { createKciHandler, parseKciXml } = await import('../server/kci.mjs');
const KCI_XML = `<?xml version="1.0"?><MetaData><inputData/><outputData><result><total>21</total></result><record><journalInfo><journal-name><![CDATA[한국콘텐츠학회논문지]]></journal-name><publisher-name>한국콘텐츠학회</publisher-name><pub-year>2024</pub-year><pub-mon>03</pub-mon><volume>24</volume><issue>3</issue></journalInfo><articleInfo article-id="ART1"><title-group><article-title lang="original"><![CDATA[모션그래픽 &amp; 문화 연구]]></article-title><article-title lang="english">Motion Graphics Study</article-title></title-group><author-group><author>홍길동(한국외국어대학교)</author><author>Kim, Lee(HUFS)</author></author-group><abstract-group><abstract lang="original"><![CDATA[국문 초록 <b>내용</b>]]></abstract><abstract lang="english">English abstract</abstract></abstract-group><fpage>10</fpage><lpage>20</lpage><doi>10.5392/x.2024.24.3.10</doi><citation-count kci="3" wos="0"/><url>https://www.kci.go.kr/x?id=ART1</url></articleInfo></record></outputData></MetaData>`;
const parsedKci = parseKciXml(KCI_XML);
assert.equal(parsedKci.total, 21);
assert.deepEqual(parsedKci.items[0], { id:'ART1', title:'모션그래픽 & 문화 연구', titleEn:'Motion Graphics Study', authors:['홍길동','Kim, Lee'], journal:'한국콘텐츠학회논문지', publisher:'한국콘텐츠학회', year:'2024', volume:'24', issue:'3', pages:'10-20', doi:'10.5392/x.2024.24.3.10', url:'https://www.kci.go.kr/x?id=ART1', abstractKo:'국문 초록 내용', abstractEn:'English abstract', citations:3 });
console.log('PASS: KCI XML parsed into bibliographic fields, CDATA and entities decoded');
const KCI_KEY = 'kci-test-user-key';
const SHARED_KEY = 'shared-server-key';
let kciUrl;
const kciDeps = { fetchUser: dependencies.fetch, fetch: async (url) => { kciUrl = url; return new Response(KCI_XML); } };
const kciEnv = { ...env, KCI_API_KEY: SHARED_KEY };
const kciReq = (token, body, method = 'POST') => new Request('http://localhost/api/kci', { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const kci = createKciHandler(kciEnv, kciDeps);
const asked = { q: '모션', kciKey: KCI_KEY };
assert.equal((await kci(kciReq(null, asked))).status, 401);
assert.equal((await kci(kciReq('forged', asked))).status, 401);
assert.equal((await kci(kciReq('owner', null, 'GET'))).status, 405);
assert.equal(kciUrl, undefined);
console.log('PASS: anonymous and forged accounts cannot call KCI');
for (const body of [{ q: 'x' }, { q: 'x', kciKey: '' }, { q: 'x', kciKey: 'a b c d' }, { q: '', kciKey: KCI_KEY }, { q: 'x', field: 'key', kciKey: KCI_KEY }, { q: 'x', page: 0, kciKey: KCI_KEY }, { q: 'x', from: '20', kciKey: KCI_KEY }, { q: 'a'.repeat(201), kciKey: KCI_KEY }]) assert.equal((await kci(kciReq('owner', body))).status, 400);
assert.equal((await kci(kciReq('owner', { q: 'a'.repeat(5000), kciKey: KCI_KEY }))).status, 413);
assert.equal(kciUrl, undefined);
console.log('PASS: missing personal key is refused and the shared server key is never used as a fallback');
const kciOk = await kci(kciReq('owner', { q: '모션', field: 'keyword', page: 2, from: '2020', to: '2024', kciKey: KCI_KEY, key: 'attacker', apiCode: 'attacker' }));
const kciBody = await kciOk.text();
assert.equal(kciOk.status, 200);
assert.ok(!kciBody.includes(KCI_KEY));
const sent = new URL(kciUrl);
assert.equal(sent.origin + sent.pathname, 'https://open.kci.go.kr/po/openapi/openApiSearch.kci');
assert.equal(sent.searchParams.get('key'), KCI_KEY);
assert.notEqual(sent.searchParams.get('key'), SHARED_KEY);
assert.equal(sent.searchParams.get('apiCode'), 'articleSearch');
assert.equal(sent.searchParams.get('keyword'), '모션');
assert.equal(sent.searchParams.get('title'), null);
assert.equal(sent.searchParams.get('dateFrom'), '202001');
assert.equal(sent.searchParams.get('dateTo'), '202412');
console.log('PASS: request uses its own key on a fixed endpoint; client cannot override parameters; key never returned');
for (const failing of [async () => { throw new Error(KCI_KEY); }, async () => new Response('fail '+KCI_KEY,{status:500}), async () => new Response('<error>'+KCI_KEY+'</error>')]) {
  const failed = await createKciHandler(kciEnv, { fetchUser: dependencies.fetch, fetch: failing })(kciReq('owner', asked));
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes(KCI_KEY));
}
const refused = await createKciHandler(kciEnv, { fetchUser: dependencies.fetch, fetch: async () => new Response(`<MetaData><outputData><result><resultMsg>필수 요청 파라미터가 없음 =&gt; title ${KCI_KEY}</resultMsg></result></outputData></MetaData>`) })(kciReq('owner', asked));
assert.equal(refused.status, 502);
const refusedText = await refused.text();
assert.ok(refusedText.includes('필수 요청 파라미터') && !refusedText.includes(KCI_KEY));
const empty = parseKciXml('<MetaData><outputData><result><total>0</total></result></outputData></MetaData>');
assert.ok(empty.ok && empty.items.length === 0);
console.log('PASS: KCI failures return safe errors without the key; zero results stay a normal response');
