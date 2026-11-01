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
