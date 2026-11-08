// 변경분 저장(B안) 검사 — 가상 계정·가상 자료만 사용한다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { CloudState } from '../node_modules/.cache/ai-wiki-verify/cloud-state.mjs';
import { parseFullState } from '../node_modules/.cache/ai-wiki-verify/data.mjs';

const sql = (path) => readFile(new URL(`../supabase/${path}`, import.meta.url), 'utf8');
const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const email = { [A]: 'a@example.com', [B]: 'b@example.com', [C]: 'c@example.com' };
await db.exec(`create role anon; create role authenticated;
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values ('${A}','${email[A]}'), ('${B}','${email[B]}'), ('${C}','${email[C]}');`);
await db.exec(await sql('migrations/202611010001_user_state.sql'));
await db.exec(await sql('migrations/202611080001_split_materials.sql'));
// Supabase처럼 슈퍼유저가 아니고 BYPASSRLS도 없는 역할이 테이블·함수를 소유한 상태로 검사한다.
await db.exec(`create role owner_role nosuperuser nobypassrls;
grant usage on schema auth to owner_role; grant execute on function auth.uid() to owner_role;
alter table public.ai_wiki_user_meta owner to owner_role;
alter table public.ai_wiki_materials owner to owner_role;
alter function public.ai_wiki_save_changes(bigint, jsonb, jsonb, text[]) owner to owner_role;
alter function public.ai_wiki_guard_legacy_state() owner to owner_role;`);

const as = async (id) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
};
const admin = async (file, user, replace = {}) => {
  await as(null);
  await db.exec('reset role');
  let text = (await sql(file)).replaceAll('REPLACE_WITH_EMAIL', email[user]);
  for (const [from, to] of Object.entries(replace)) text = text.replace(from, to);
  return db.exec(text);
};
const query = async (user, text, params) => { if (user === 'admin') { await db.exec('reset role'); } else await as(user); return (await db.query(text, params)).rows; };

// 가상 자료: 일부는 큰 본문을 가진다.
const fixture = (n, tag) => {
  const raw = {
    schemaVersion: 2,
    settings: { topic: `가상 주제 ${tag}`, keywords: ['가상'], overview: '', defaultView: '' },
    materials: Array.from({ length: n }, (_, i) => ({
      id: `${tag}-m${i}`, title: `가상 논문 ${tag}-${i}`, createdAt: '2026-01-01T00:00:00.000Z',
      content: i % 5 === 0 ? '가'.repeat(40_000) : `본문 ${i}`, myView: i % 3 ? `관점 ${i}` : undefined,
    })),
  };
  const state = parseFullState(raw).state;
  return { ...state, schemaVersion: 3, theses: state.theses, writing: { ...state.writing } };
};
const seed = async (user, state) => {
  await as(user);
  await db.query('insert into public.ai_wiki_user_state(user_id, state) values ($1, $2::jsonb)', [user, JSON.stringify(state)]);
};
const legacyRow = async (user) => (await query('admin', 'select state, revision::int as revision from public.ai_wiki_user_state where user_id=$1', [user]))[0];

let calls = 0;
let sentChars = 0;
const repoFor = (user) => ({
  async read(id) {
    return (await query(user, 'select state, revision::int as revision from public.ai_wiki_user_state where user_id=$1', [id]))[0] ?? null;
  },
  async write(id, state, rev) {
    const rows = rev === null
      ? await query(user, 'insert into public.ai_wiki_user_state(user_id, state) values ($1,$2::jsonb) returning revision::int as revision', [id, JSON.stringify(state)])
      : await query(user, 'update public.ai_wiki_user_state set state=$2::jsonb, revision=revision+1 where user_id=$1 and revision=$3 returning revision::int as revision', [id, JSON.stringify(state), rev]);
    if (!rows.length) throw new Error('conflict');
    return rows[0].revision;
  },
  async readSplit(id) {
    const meta = (await query(user, 'select state, revision::int as revision from public.ai_wiki_user_meta where user_id=$1', [id]))[0];
    if (!meta) return null;
    const materials = await query(user, 'select id, position, data from public.ai_wiki_materials where user_id=$1 and deleted_at is null order by position, id', [id]);
    return { meta, materials };
  },
  async saveChanges(_id, c) {
    calls++;
    sentChars += JSON.stringify(c.upserts).length;
    try {
      return (await query(user, 'select public.ai_wiki_save_changes($1, $2::jsonb, $3::jsonb, $4::text[]) as r',
        [c.expectedRevision, c.meta && JSON.stringify(c.meta), JSON.stringify(c.upserts), c.deletes]))[0].r;
    } catch (e) {
      if (e.code === 'PT409') throw new Error('conflict');
      throw e;
    }
  },
});
const engine = (user, chunk) => new CloudState(repoFor(user), user, () => true, chunk);

// ── 1. 마이그레이션 적용만으로는 아무 계정도 전환되지 않고 기존 저장이 그대로 동작한다
const original = fixture(30, 'a');
await seed(A, original);
await seed(B, fixture(3, 'b'));
const legacyA = engine(A);
const before = await legacyA.load();
assert.equal(legacyA.mode, 'legacy');
assert.equal(before.materials.length, 30);
await legacyA.save(before);
assert.equal((await legacyRow(A)).revision, 2);
console.log('PASS: schema migration alone switches no account; legacy load/save unchanged');

// ── 2. 권한: 익명·다른 계정은 읽기·쓰기 불가, 직접 쓰기는 소유자도 불가 (RPC로만 저장)
await admin('manual/split-migrate-user.sql', A);
await as(null);
await assert.rejects(db.query('select * from public.ai_wiki_materials'));
await assert.rejects(db.query('select * from public.ai_wiki_user_meta'));
await assert.rejects(db.query("select public.ai_wiki_save_changes(1, null, '[]', '{}')"));
assert.equal((await query(B, 'select * from public.ai_wiki_materials')).length, 0);
assert.equal((await query(B, 'select * from public.ai_wiki_user_meta')).length, 0);
await as(B);
await assert.rejects(db.query("select public.ai_wiki_save_changes(1, null, '[]', '{}')"), (e) => e.code === 'PT409');
await as(A);
await assert.rejects(db.query(`insert into public.ai_wiki_materials(user_id,id,position,data) values ('${A}','x',1,'{"id":"x"}')`));
await assert.rejects(db.query(`update public.ai_wiki_user_meta set revision = 99 where user_id='${A}'`));
console.log('PASS: anon and other accounts cannot read or save; direct table writes denied, saves only via RPC');

// ── 3. 이전 결과: 자료 수·내용·순서·메타가 원본과 같다
const [check] = await query('admin', (await sql('manual/split-verify-user.sql')).replaceAll('REPLACE_WITH_EMAIL', email[A]));
assert.equal(Number(check.legacy_count), 30);
assert.equal(Number(check.new_count), 30);
assert.equal(check.materials_match, true);
assert.equal(check.meta_match, true);
const splitA = engine(A);
const loaded = await splitA.load();
assert.equal(splitA.mode, 'split');
assert.deepEqual(loaded, before);
console.log('PASS: migration keeps every material (content and order) and the whole meta document');

// ── 4. 이전 실패 조건: 재실행·중복 id는 아무것도 바꾸지 않는다
await assert.rejects(admin('manual/split-migrate-user.sql', A), /이미 전환/);
const dup = fixture(4, 'c');
dup.materials[1] = { ...dup.materials[1], id: dup.materials[0].id };
await seed(C, dup);
await assert.rejects(admin('manual/split-migrate-user.sql', C), /같은 id/);
assert.equal((await query('admin', 'select count(*)::int as n from public.ai_wiki_materials where user_id=$1', [C]))[0].n, 0);
assert.equal((await query('admin', 'select count(*)::int as n from public.ai_wiki_user_meta where user_id=$1', [C]))[0].n, 0);
console.log('PASS: re-running or duplicate ids abort the migration with nothing written');

// ── 5. 전환 뒤 기존 저장 경로는 막히고(기존 행 보존), 전환 안 한 계정은 그대로
const frozen = await legacyRow(A);
await assert.rejects(legacyA.save(before));
await as(A);
await assert.rejects(db.query(`delete from public.ai_wiki_user_state where user_id='${A}'`), (e) => e.code === 'PT409');
assert.deepEqual(await legacyRow(A), frozen);
const legacyB = engine(B);
await legacyB.save(await legacyB.load());
console.log('PASS: old-app writes to a migrated account are rejected and its original row is untouched; other accounts unaffected');

// ── 6. 변경분 저장: 바뀐 자료만 보내고, 추가·삭제·순서·메타가 유지된다
calls = 0; sentChars = 0;
await splitA.save(loaded);
assert.equal(calls, 0, 'no change → no request');
const edited = { ...loaded, materials: loaded.materials.map((m, i) => (i === 7 ? { ...m, myView: '수정한 관점' } : m)) };
await splitA.save(edited);
assert.equal(calls, 1);
assert.ok(sentChars < 2_000, `only one small material sent (${sentChars})`);
const added = { ...edited, materials: [{ ...edited.materials[0], id: 'kci-new', title: 'KCI 가상 논문' }, ...edited.materials] };
await splitA.save(added);
const removed = { ...added, materials: added.materials.filter((m) => m.id !== 'a-m3'), selectedId: null, writing: { ...added.writing } };
await splitA.save(removed);
assert.equal((await query('admin', "select count(*)::int as n from public.ai_wiki_materials where user_id=$1 and id='a-m3' and deleted_at is not null", [A]))[0].n, 1, 'deletion is a mark, row kept');
const restored = JSON.parse(JSON.stringify(removed));
calls = 0;
await splitA.save(parseFullState(restored).state);
assert.equal(calls, 0, 'same content with new objects (backup restore) sends nothing');
const reloaded = await engine(A).load();
assert.deepEqual(reloaded.materials.map((m) => m.id), removed.materials.map((m) => m.id));
assert.equal(reloaded.materials.find((m) => m.id === 'a-m7').myView, '수정한 관점');
assert.deepEqual(reloaded.projects, removed.projects);
console.log('PASS: only changed materials are sent; add, edit, delete mark, order and meta survive reload');

// ── 7. 큰 변경은 묶음으로 나눠 저장되고, 결과가 같다
const chunked = engine(A, 50_000);
const base = await chunked.load();
calls = 0;
const bulk = { ...base, materials: base.materials.map((m) => ({ ...m, relevance: 5 })) };
await chunked.save(bulk);
assert.ok(calls > 3, `split into several requests (${calls})`);
assert.deepEqual((await engine(A).load()).materials, bulk.materials);
console.log('PASS: large changes are sent in chunks and reload identically');

// ── 8. 동시 저장 충돌: 오래된 탭은 덮어쓰지 못한다
const tab1 = engine(A);
const tab2 = engine(A);
const s1 = await tab1.load();
const s2 = await tab2.load();
await tab1.save({ ...s1, materials: s1.materials.map((m, i) => (i === 0 ? { ...m, title: '탭1' } : m)) });
await assert.rejects(tab2.save({ ...s2, materials: s2.materials.map((m, i) => (i === 0 ? { ...m, title: '탭2' } : m)) }), /conflict/);
assert.equal((await engine(A).load()).materials[0].title, '탭1');
console.log('PASS: a stale tab cannot overwrite newer data (revision conflict)');

// ── 9. 손상 방지: 순서 정보에 있는 자료가 없으면 불러오기를 멈춘다
const broken = { ...repoFor(A), async readSplit(id) { const r = await repoFor(A).readSplit(id); return { ...r, materials: r.materials.slice(1) }; } };
await assert.rejects(new CloudState(broken, A, () => true).load(), /찾지 못했습니다/);
console.log('PASS: missing material rows fail closed');

// ── 9b. 여러 묶음 저장 도중 실패: 이미 보낸 묶음만 반영되고, 잃는 자료·버전 불일치 없이 이어서 저장된다
{
  const target = (s) => ({ ...s, materials: [{ ...s.materials[0], id: 'chunk-new', title: '묶음 중 추가' }, ...s.materials.map((m) => ({ ...m, relevance: 2 }))] });
  const rowsOf = async () => new Map((await query('admin', 'select id, data from public.ai_wiki_materials where user_id=$1 and deleted_at is null', [A])).map((r) => [r.id, r.data]));
  // (1) 2번째 묶음 요청이 서버에 닿기 전에 실패
  let n = 0;
  const failBefore = { ...repoFor(A), async saveChanges(id, c) { if (++n === 2) throw new Error('network down'); return repoFor(A).saveChanges(id, c); } };
  const e1 = new CloudState(failBefore, A, () => true, 50_000);
  const startState = await e1.load();
  const beforeRows = await rowsOf();
  const goal = target(startState);
  await assert.rejects(e1.save(goal), /network down/);
  const mid = await rowsOf();
  for (const [id, data] of beforeRows) assert.ok(mid.has(id), `material ${id} still on server`);
  for (const [id, data] of mid) {
    const want = goal.materials.find((m) => m.id === id);
    assert.ok(isDeepStrictEqual(data, beforeRows.get(id)) || isDeepStrictEqual(data, JSON.parse(JSON.stringify(want))), `${id} is either old or new, never mixed`);
  }
  const midLoad = await engine(A).load();
  assert.equal(midLoad.materials.length, beforeRows.size + (mid.has('chunk-new') ? 1 : 0), 'reload after a partial save loses nothing');
  assert.deepEqual(midLoad.projects, startState.projects, 'meta changes only with the last chunk');
  calls = 0;
  await e1.save(goal);
  const sentAfterRetry = calls;
  assert.deepEqual((await engine(A).load()).materials, goal.materials, 'retry completes the save');
  assert.ok(sentAfterRetry < n, `retry resends only the remaining chunks (${sentAfterRetry} < ${n})`);

  // (2) 서버는 반영했지만 응답을 받지 못한 경우: 다음 저장은 충돌로 멈추고 덮어쓰지 않는다
  const e2 = new CloudState({ ...repoFor(A), async saveChanges(id, c) { await repoFor(A).saveChanges(id, c); throw new Error('response lost'); } }, A, () => true);
  const s = await e2.load();
  const lost = { ...s, materials: s.materials.map((m, i) => (i === 1 ? { ...m, title: '응답 유실' } : m)) };
  await assert.rejects(e2.save(lost), /response lost/);
  await assert.rejects(e2.save({ ...lost, materials: lost.materials.map((m, i) => (i === 2 ? { ...m, title: '다음 수정' } : m)) }), /conflict|response lost/);
  const afterLost = await engine(A).load();
  assert.equal(afterLost.materials[1].title, '응답 유실');
  assert.notEqual(afterLost.materials[2].title, '다음 수정');
}
console.log('PASS: a failed chunk keeps every material (old or new, never missing); meta waits for the last chunk; retry resumes; lost responses end in a conflict, not an overwrite');

// ── 9c. 저장 함수는 SQL NULL과 JSON null을 같게 처리한다 (메타 유지, 빈 변경)
{
  const metaBefore = (await query('admin', 'select state, revision::int as revision from public.ai_wiki_user_meta where user_id=$1', [A]))[0];
  const r1 = (await query(A, "select public.ai_wiki_save_changes($1, 'null'::jsonb, 'null'::jsonb, null) as r", [metaBefore.revision]))[0].r;
  const r2 = (await query(A, "select public.ai_wiki_save_changes($1, null, null, '{}') as r", [r1.revision]))[0].r;
  assert.equal(r2.revision, metaBefore.revision + 2);
  const metaAfter = (await query('admin', 'select state from public.ai_wiki_user_meta where user_id=$1', [A]))[0];
  assert.deepEqual(metaAfter.state, metaBefore.state);
  await as(A);
  await assert.rejects(db.query("select public.ai_wiki_save_changes($1, '[]'::jsonb, null, null)", [r2.revision]), (e) => e.code === '22023');
}
console.log('PASS: save function treats SQL NULL and JSON null alike and keeps the stored meta');

// ── 10. 되돌리기: keep_changes는 새 구조의 내용으로, discard는 전환 전 원본으로
const current = await engine(A).load();
const splitRows = (await query('admin', 'select count(*)::int as n from public.ai_wiki_materials where user_id=$1', [A]))[0].n;
await admin('manual/split-rollback-user.sql', A, { "v_mode text := 'discard'": "v_mode text := 'keep_changes'" });
const back = engine(A);
const afterKeep = await back.load();
assert.equal(back.mode, 'legacy');
assert.deepEqual(afterKeep, current);
assert.equal((await query('admin', "select count(*)::int as n from public.ai_wiki_split_rollback_backup where user_id=$1 and kind='material'", [A]))[0].n, splitRows);
await back.save(afterKeep);
console.log('PASS: rollback (keep_changes) rebuilds the legacy row with current data, backs up split rows, legacy saving works again');

await admin('manual/split-migrate-user.sql', A);
const legacyBefore = await legacyRow(A);
const again = engine(A);
const st = await again.load();
await again.save({ ...st, materials: st.materials.slice(2) });
await admin('manual/split-rollback-user.sql', A);
assert.deepEqual(await legacyRow(A), legacyBefore);
assert.equal((await engine(A).load()).materials.length, legacyBefore.state.materials.length);
console.log('PASS: rollback (discard) returns to the untouched pre-migration row');

// ── 11. 서버 백업: 비공개 스키마, 앱 역할 접근 불가, 원본과 일치, 덮어쓰기 불가
{
  await db.exec('reset role');
  // Supabase처럼 새 테이블에 앱 역할 권한이 자동으로 붙는 상태를 흉내 낸다.
  await db.exec('alter default privileges grant all on tables to anon, authenticated');
  await db.exec(await sql('manual/backup-user-state.sql'));
  await db.exec('alter default privileges revoke all on tables from anon, authenticated');
  const total = (await query('admin', 'select count(*)::int as n from public.ai_wiki_user_state'))[0].n;
  assert.equal((await query('admin', 'select count(*)::int as n from ai_wiki_backup.user_state_20261108'))[0].n, total);
  for (const who of [null, A]) {
    await as(who);
    await assert.rejects(db.query('select * from ai_wiki_backup.user_state_20261108'));
  }
  await db.exec('reset role');
  await assert.rejects(db.exec(await sql('manual/backup-user-state.sql')), /already exists/);
  await db.exec('rollback');
  assert.equal((await query('admin', 'select count(*)::int as n from ai_wiki_backup.user_state_20261108'))[0].n, total);
}
console.log('PASS: backup lives in a private schema, matches the source, is unreadable by anon/authenticated and is never overwritten');

// ── 12. 테스트 계정 가상 자료: 실제 자료가 있는 계정은 거부, 약 14MB 생성, 전환·묶음 저장까지 동작
{
  const D = '44444444-4444-4444-8444-444444444444';
  email[D] = 'test@example.com';
  await query('admin', 'insert into auth.users values ($1, $2)', [D, email[D]]);
  const seedSql = async (mail, confirm = mail) => {
    await db.exec('reset role');
    const text = (await sql('manual/test-seed-virtual-data.sql'))
      .replace("v_email text := 'REPLACE_WITH_TEST_EMAIL'", `v_email text := '${mail}'`)
      .replace("v_confirm text := 'REPLACE_WITH_TEST_EMAIL'", `v_confirm text := '${confirm}'`);
    return db.exec(text);
  };
  await assert.rejects(seedSql(email[D]), /저장 행이 없습니다/);
  const fresh = engine(D);
  assert.equal(await fresh.load(), null);
  const empty = fixture(0, 'd');
  await fresh.save(empty);
  await assert.rejects(seedSql(email[D], 'other@example.com'), /같게 입력/);
  const bBefore = await legacyRow(B);
  await assert.rejects(seedSql(email[B]), /가상 자료가 아닌/);
  assert.deepEqual(await legacyRow(B), bBefore);
  await seedSql(email[D]);
  await seedSql(email[D]);
  const seeded = await legacyRow(D);
  const bytes = Buffer.byteLength(JSON.stringify(seeded.state));
  assert.ok(bytes > 13_000_000 && bytes < 15_500_000, `about 14MB (${bytes})`);
  const loadedD = await engine(D).load();
  assert.equal(loadedD.materials.length, 202);
  assert.deepEqual(loadedD.projects, empty.projects);
  assert.ok(loadedD.materials.every((m) => m.id.startsWith('virtual-') && m.projectId === empty.projects[0].id));
  await admin('manual/split-migrate-user.sql', D);
  const big = engine(D);
  const s = await big.load();
  assert.equal(big.mode, 'split');
  calls = 0;
  const bulk = { ...s, materials: s.materials.map((m) => ({ ...m, relevance: 5 })) };
  await big.save(bulk);
  assert.ok(calls >= 10, `14MB bulk change sent in ${calls} chunks of about 1MB`);
  assert.deepEqual((await engine(D).load()).materials, bulk.materials);
  assert.deepEqual(await legacyRow(B), bBefore);
}
console.log('PASS: virtual 14MB seed only for an exact test account with no real materials; migrates and saves in ~1MB chunks');
await db.close();
