// 브라우저 검증용 가짜 Supabase + 정적 파일 서버 (운영 DB에 접속하지 않음).
// - http://localhost:<port> 한 곳에서 테스트 빌드(정적 파일)와 Auth·PostgREST 흉내를 함께 제공한다.
// - 데이터는 이 프로세스 메모리에만 있는 가상 계정·가상 자료다. 서버를 끄면 사라진다.
//
// 사용 순서 (.env.local·Vercel 환경변수는 바꾸지 않는다. 빌드할 때만 주소·키를 덮어쓴다)
//  1) 테스트 빌드 (저장소 밖 폴더에):
//     VITE_SUPABASE_URL=http://localhost:54329 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localtest \
//       ./node_modules/.bin/vite build --outDir <임시 폴더> --emptyOutDir
//  2) 서버 실행: node tests/browser/fake-supabase.mjs <임시 폴더> [port=54329]
//     빌드에 운영 Supabase 프로젝트 주소가 들어 있으면 시작하지 않고 멈춘다.
//  3) 브라우저에서 http://localhost:54329 를 열고, 콘솔에서 가상 로그인 상태를 넣은 뒤 새로고침:
//     localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ access_token: 'local-test-token', token_type: 'bearer',
//       expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'local-test-refresh',
//       user: { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'local-test@example.invalid', user_metadata: { full_name: '로컬 테스트' }, app_metadata: {} } }))
//  4) 검증용 주소: GET /__state (서버 이력·저장 기록), GET /__fail-next (다음 저장 한 번 실패)
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [dir, portArg] = process.argv.slice(2);
if (!dir) throw new Error('사용: node tests/browser/fake-supabase.mjs <빌드 폴더> [port]');
const port = Number(portArg ?? 54329);

// 안전장치: 운영 Supabase 프로젝트 주소(<20자 ref>.supabase.co)가 든 빌드는 서비스하지 않는다
for (const f of await readdir(join(dir, 'assets')).catch(() => [])) {
  if (/\.js$/.test(f) && /[a-z0-9]{20}\.supabase\.co/.test(await readFile(join(dir, 'assets', f), 'utf8'))) {
    console.error(`중단: ${f}에 운영 Supabase 주소가 들어 있습니다. 1)의 테스트 빌드로 다시 만드세요.`);
    process.exit(1);
  }
}

const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'local-test@example.invalid', user_metadata: { full_name: '로컬 테스트' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const project = (id, name) => ({ id, name, topic: name, keywords: ['가상'], overview: '', defaultView: '', status: '진행 중', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', degree: '석사', department: '시험학과', advisor: '', student: '로컬 테스트', studentEn: '', departmentEn: '' });
const material = (id, projectId, title) => ({ id, title, sourceType: 'PDF', origin: '원본 자료', topic: '', keywords: [], relevance: 3, para: 'Resources', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', viewStatus: '미작성', bibStatus: '서지정보 확인 필요', citationIncluded: false, projectId });

// 변경분 저장(B안) 방식으로 전환된 가상 계정
const db = {
  meta: { revision: 1, state: { schemaVersion: 3, settings: {}, writing: {}, selectedId: null, projects: [project('P1', '가상 프로젝트 A'), project('P2', '가상 프로젝트 B')], currentProjectId: 'P1', events: [], aiOutputs: [], theses: [], materialOrder: ['v1', 'v2', 'v3'] } },
  materials: new Map([['v1', { position: 0, data: material('v1', 'P1', '가상 자료 1') }], ['v2', { position: 1, data: material('v2', 'P1', '가상 자료 2') }], ['v3', { position: 2, data: material('v3', 'P2', '가상 자료 3') }]]),
  log: [], // 받은 저장 요청 기록 (검증용)
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s ? JSON.parse(s) : null)); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204);
  // ── Auth ──
  if (p === '/auth/v1/user') return send(res, 200, USER);
  if (p === '/auth/v1/token') return send(res, 200, { access_token: 'local-test-token', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'local-test-refresh', user: USER });
  if (p === '/auth/v1/logout') return send(res, 204);
  // ── PostgREST ──
  if (p === '/rest/v1/ai_wiki_user_meta') {
    const row = { state: db.meta.state, revision: db.meta.revision };
    return (req.headers.accept ?? '').includes('vnd.pgrst.object') ? send(res, 200, row) : send(res, 200, [row]);
  }
  if (p === '/rest/v1/ai_wiki_materials') {
    const rows = [...db.materials].filter(([, r]) => !r.deleted_at).sort((a, b) => a[1].position - b[1].position || a[0].localeCompare(b[0])).map(([id, r]) => ({ id, position: r.position, data: r.data }));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? rows.length);
    return send(res, 200, rows.slice(offset, offset + limit));
  }
  if (p === '/rest/v1/ai_wiki_user_state') return send(res, 200, []);
  if (p === '/rest/v1/rpc/ai_wiki_save_changes' && req.method === 'POST') {
    const b = await readBody(req);
    const failing = url.searchParams.get('fail') ?? db.failNext;
    if (failing) { db.failNext = 0; db.log.push({ at: new Date().toISOString(), result: 'fail' }); return send(res, 500, { code: '57014', message: 'fake timeout' }); }
    if (b.p_expected_revision !== db.meta.revision) { db.log.push({ result: 'conflict' }); return send(res, 409, { code: 'PT409', message: 'revision conflict' }); }
    for (const u of b.p_upserts ?? []) db.materials.set(u.data.id, { position: u.position, data: u.data });
    for (const id of b.p_deletes ?? []) { const r = db.materials.get(id); if (r) r.deleted_at = new Date().toISOString(); }
    if (b.p_meta) db.meta.state = b.p_meta;
    db.meta.revision += 1;
    const count = [...db.materials.values()].filter((r) => !r.deleted_at).length;
    db.log.push({ at: new Date().toISOString(), result: 'ok', upserts: (b.p_upserts ?? []).length, meta: !!b.p_meta, revision: db.meta.revision });
    return send(res, 200, { revision: db.meta.revision, count });
  }
  // ── 검증용 ──
  if (p === '/__state') return send(res, 200, { revision: db.meta.revision, events: db.meta.state.events, materials: [...db.materials.keys()], log: db.log });
  if (p === '/__fail-next') { db.failNext = 1; return send(res, 200, { ok: true }); }
  if (p.startsWith('/api/')) return send(res, 200, { configured: false, message: '로컬 테스트: AI 서버 없음' });
  // ── 정적 파일 (SPA) ──
  const file = normalize(join(dir, p === '/' ? 'index.html' : p));
  if (!file.startsWith(normalize(dir))) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    const html = await readFile(join(dir, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(html);
  }
}).listen(port, 'localhost', () => console.log(`fake supabase + app on http://localhost:${port}`));
