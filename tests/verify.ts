/**
 * AI WIKI 데이터·서식 검증 스크립트.  실행: npm run verify
 * 브라우저 없이 src/lib의 실제 코드를 그대로 호출해 확인한다.
 *  1. 저장 데이터 (v1 변환, 손상 데이터 보존, 자동 저장 중지)
 *  2. 전체 백업·복원 왕복
 *  3. 가져오기 계획 (추가·갱신·충돌·중복·오류)
 *  4. Markdown 교류 (내 관점·서지정보·본문 분리, 실제 Obsidian 노트)
 *  5. 참고문헌 서식 (유형별 필수 항목, APA·Chicago·MLA·국내 일반형)
 * 서식 예시 중 한글 저자 자료는 검증용 가상 자료다.
 */
import { buildBackup, normBib, normalizeMaterial, parseFullState, planImport, resolveImport } from '../src/lib/data';
import { parseImportFile } from '../src/lib/importers';
import { materialToMarkdown, markdownToHtml } from '../src/lib/utils';
import { checkBib, formatCitation, sameAuthorYear, segsToHtml, segsToText, sortForStyle, type CitationStyle } from '../src/lib/citation';
import { CORRUPT_PREFIX, LEGACY_KEY_V1, STORAGE_KEY, loadState, saveState, type StorageLike } from '../src/lib/persist';
import { DEFAULT_WRITING, SAMPLE_MATERIALS } from '../src/data/sample';
import type { AppState, Bib, Material } from '../src/types';
import obsidianNote from './fixtures/obsidian-real-note.md';
import v1Storage from './fixtures/v1-storage.json';

const v1StorageText = JSON.stringify(v1Storage); // localStorage에 들어 있던 문자열 형태

/* ───────── 최소 테스트 도구 ───────── */

let failed = 0;
let passed = 0;
function ok(cond: unknown, msg: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok    ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL  ${msg}`);
    if (detail !== undefined) console.log('        ', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, msg, a === e ? undefined : `expected ${e}\n         actual   ${a}`);
}
const section = (t: string) => console.log(`\n■ ${t}`);
const file = (name: string, text: string) => new File([text], name);

async function materialsOf(name: string, text: string) {
  const r = await parseImportFile(file(name, text));
  if (r.kind !== 'materials') throw new Error(`${name}: 자료 파일로 인식되지 않음`);
  return r.items;
}

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.map.set(k, v);
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, v);
  }
}

const initial = (): AppState => ({
  materials: SAMPLE_MATERIALS.map((m) => normalizeMaterial(m)!),
  settings: parseFullState({ materials: [] }).state.settings,
  writing: DEFAULT_WRITING,
  selectedId: null,
});

const journalBib: Bib = {
  type: 'journal',
  author: '',
  authors: ['Mayer, Richard E.', 'Moreno, Roxana'],
  year: '2003',
  publisher: '',
  title: 'Nine ways to reduce cognitive load in multimedia learning',
  container: 'Educational Psychologist',
  volume: '38',
  issue: '1',
  pages: '43-52',
  doi: '10.1207/S15326985EP3801_6',
};
const mat = (bib: Bib | undefined, extra: Partial<Material> = {}) =>
  normalizeMaterial({ id: extra.id ?? 'm1', title: '자료 제목', sourceType: 'PDF', bib, citationIncluded: true, ...extra })!;
const cite = (m: Material, s: CitationStyle) => {
  const segs = formatCitation(m, s);
  return segs ? segsToText(segs) : null;
};

/* ───────── 1. 저장 데이터 ───────── */

async function storageTests() {
  section('1. 저장 데이터 — v1 변환 · 손상 데이터 · 자동 저장 중지');

  const v1 = new MemoryStorage({ [LEGACY_KEY_V1]: v1StorageText });
  const r1 = loadState(v1, initial);
  const s1 = r1.state;
  eq(s1.materials.map((m) => m.id), ['sample-01', 'user-web-1'], 'v1 자료 2건이 ID 그대로 유지');
  ok(s1.materials[0].myView && s1.materials[0].viewStatus === '작성 중' && s1.materials[1].viewStatus === '미작성', 'v1 내 관점 유지, 관점 없는 자료는 미작성');
  ok(s1.materials[0].analysis?.insights[0] === '인사이트 1' && s1.materials[0].isSample, '분석 결과·샘플 표시 유지');
  eq(s1.materials[0].bib?.authors, ['홍길동'], 'v1 서지정보(저자) 유지');
  ok(s1.materials[0].bib?.publisher === '한국콘텐츠학회논문지' && s1.materials[0].citationIncluded, 'v1 발행처·참고문헌 선택 유지');
  ok(s1.materials[0].bibStatus === '서지정보 확인 필요', "v1 서지정보는 유형이 없어 '확인 필요'로 표시 (완성 인용처럼 보이지 않음)");
  ok(s1.writing.text === '작성 중인 초안' && s1.writing.history.length === 1 && s1.settings.overview === '개요' && s1.selectedId === 'sample-01', '설정·집필 상태·선택 유지');
  ok(!r1.blockSave && r1.notices.some((n) => n.text.includes('옮겼습니다')), '변환 안내 표시');
  saveState(v1, s1);
  ok(v1.getItem(LEGACY_KEY_V1) === v1StorageText && v1.getItem(STORAGE_KEY), '저장 후에도 v1 원본은 그대로, v2 키에 새로 저장');
  const again = loadState(v1, initial);
  eq(again.state, s1, 'v2로 저장한 상태를 다시 읽으면 동일');

  const corruptRaw = '{"schemaVersion":2,"materials":[{"id":"x"'; // 잘린 JSON
  const st2 = new MemoryStorage({ [STORAGE_KEY]: corruptRaw });
  const r2 = loadState(st2, initial, 1700000000000);
  ok(st2.getItem(`${CORRUPT_PREFIX}1700000000000`) === corruptRaw && r2.corruptKey, '손상된 저장 데이터 원본을 별도 키에 그대로 보관');
  ok(!r2.blockSave && r2.notices.some((n) => n.kind === 'error'), '보관에 성공하면 오류 안내 후 계속 사용');
  ok(st2.getItem(STORAGE_KEY) === corruptRaw, '읽기 단계에서는 원본 키를 덮어쓰지 않음');
  const r2b = loadState(st2, initial, 1700000009999); // 개발 모드 이중 초기화·새로고침 반복
  ok(r2b.corruptKey === r2.corruptKey && [...st2.map.keys()].filter((k) => k.startsWith(CORRUPT_PREFIX)).length === 1, '같은 손상 원본은 한 번만 보관 (반복 로드 시 사본 중복 없음)');

  const st3 = new MemoryStorage({ [STORAGE_KEY]: corruptRaw });
  st3.failWrites = true;
  const r3 = loadState(st3, initial);
  ok(r3.blockSave && r3.notices.some((n) => n.text.includes('자동 저장을 중지')), '보관도 실패하면 자동 저장 중지');
  ok(st3.getItem(STORAGE_KEY) === corruptRaw, '자동 저장 중지 상태에서 원본 유지');

  const st4 = new MemoryStorage({ [STORAGE_KEY]: '{"no":"materials"}', [LEGACY_KEY_V1]: v1StorageText });
  const r4 = loadState(st4, initial);
  ok(r4.state.materials.length === 2 && r4.notices.some((n) => n.text.includes('v1')), '형식이 맞지 않는 v2 대신 v1 자료를 불러옴 (v2 원본은 보관)');

  const full = new MemoryStorage();
  full.failWrites = true;
  const sr = saveState(full, s1);
  ok(!sr.ok && sr.reason === '브라우저 저장 공간 부족', '저장 공간 부족을 실패로 보고', sr);
  ok(loadState(null, initial).blockSave, '저장소 접근 불가 시 자동 저장 중지');
}

/* ───────── 2. 백업·복원 ───────── */

async function backupTests() {
  section('2. 전체 백업 → 복원 왕복');
  const base = loadState(new MemoryStorage({ [LEGACY_KEY_V1]: v1StorageText }), initial).state;
  const state: AppState = {
    ...base,
    materials: [
      { ...base.materials[0], bib: normBib({ ...journalBib, editors: ['편집자'] }), researchMemo: '메모', transcript: { points: ['p'], segments: [{ time: '00:01', text: 't' }] } },
      base.materials[1],
    ],
  };
  const restored = await parseImportFile(file('backup.json', JSON.stringify(buildBackup(state))));
  ok(restored.kind === 'backup', '전체 백업 파일로 인식');
  if (restored.kind === 'backup') {
    eq(restored.backup.state, parseFullState(JSON.parse(JSON.stringify(state))).state, '복원 결과가 백업 직전 상태와 동일 (자료·설정·집필·선택)');
    eq(restored.backup.state.materials[0].bib, state.materials[0].bib, '확장 서지정보(유형·권호·쪽·DOI·편저자) 보존');
    ok(restored.backup.hasWriting && restored.backup.hasSettings, '설정·집필 포함 표시');
  }
  const old = await parseImportFile(file('old.json', JSON.stringify({ app: 'AI WIKI', settings: base.settings, materials: base.materials })));
  ok(old.kind === 'backup' && !old.backup.hasWriting, '기존 v1 전체 JSON 백업도 인식 (집필 상태 없음 표시)');
  const future = parseImportFile(file('f.json', JSON.stringify({ kind: 'ai-wiki-backup', schemaVersion: 99, materials: [] })));
  ok(await future.then(() => false, (e: Error) => e.message.includes('새로운 버전')), '더 새로운 버전 백업은 거부');
}

/* ───────── 3. 가져오기 계획 ───────── */

async function planTests() {
  section('3. 가져오기 미리보기 — 추가·갱신·충돌·중복·오류');
  const cur = mat(journalBib, { myView: '관점', analysis: { summary: 'S', topic: '', keywords: [], relevance: 4, rationale: '', connection: '', insights: [], citationCandidate: '' } });
  eq(planImport([cur], await materialsOf('one.json', JSON.stringify(cur))).items.map((i) => i.status), ['same'], '같은 자료 JSON 재가져오기 = 변경 없음');
  const later = new Date(Date.parse(cur.updatedAt!) + 60000).toISOString();
  const part = planImport([cur], await materialsOf('p.json', JSON.stringify({ id: 'm1', title: '새 제목', updatedAt: later })));
  ok(part.items[0].status === 'update' && part.items[0].incoming.myView === '관점' && part.items[0].incoming.analysis && part.items[0].incoming.bib?.volume === '38', '일부 필드만 있는 갱신은 나머지(관점·분석·서지) 유지');
  const older = planImport([cur], await materialsOf('o.json', JSON.stringify({ id: 'm1', title: '옛 제목', updatedAt: '2000-01-01T00:00:00Z' })));
  ok(older.items[0].status === 'conflict', '현재 자료가 더 최근이면 충돌');
  ok(resolveImport(older.items, 'keep', 'skip').update.length === 0, '충돌 기본값 = 현재 유지');
  ok(resolveImport(older.items, 'overwrite', 'skip').update[0]?.title === '옛 제목', '충돌 → 덮어쓰기 선택');
  ok(resolveImport(older.items, 'copy', 'skip').add[0]?.id !== 'm1', '충돌 → 사본 추가 선택 (새 ID)');
  const web = mat(undefined, { id: 'w', sourceType: 'Web', url: 'https://x.com/p/' });
  ok(planImport([web], [{ partial: { title: '다른 제목', sourceType: 'Web', url: 'https://x.com/p' }, source: 's', fallbackTitle: 'x' }]).items[0].status === 'duplicate', 'ID가 달라도 같은 URL이면 중복 의심');
  const twice = planImport([], [
    { partial: { id: 'z', title: 'a', sourceType: 'TXT' }, source: '1', fallbackTitle: 'a' },
    { partial: { id: 'z', title: 'b', sourceType: 'TXT' }, source: '2', fallbackTitle: 'b' },
  ]);
  ok(twice.items.length === 1 && twice.items[0].incoming.title === 'b' && twice.errors.length === 1, '한 번에 같은 ID가 두 번 오면 마지막 항목만 사용하고 알림');

  const bad: [string, string, string][] = [
    ['bad.json', '{oops', 'JSON 문법 오류'],
    ['empty.md', '  ', '빈 파일'],
    ['x.pdf', 'a', '지원하지 않는 형식'],
    ['open.md', '---\ntitle: a\n', '닫히지 않았습니다'],
    ['num.json', '42', '자료 객체가 아님'],
  ];
  for (const [n, t, expect] of bad) {
    const msg = await parseImportFile(file(n, t)).then(() => '(오류 없음)', (e: Error) => e.message);
    ok(msg.includes(expect), `오류 처리: ${n} → ${msg}`);
  }
  const mixed = await parseImportFile(file('arr.json', JSON.stringify([{ title: 'ok' }, 'str', null])));
  ok(mixed.kind === 'materials' && mixed.items.length === 1 && mixed.errors.length === 2, '배열 중 잘못된 항목만 오류로 분리');
}

/* ───────── 4. Markdown ───────── */

async function markdownTests() {
  section('4. Markdown 교류 — 내 관점·서지정보·본문 분리');
  const content = '본문 첫 줄\n\n## 내 관점\n\n본문 속에 같은 제목이 있음\n\n```md\n## 연구 메모\n코드 속 제목\n```';
  const m = mat({ ...journalBib, editors: undefined }, {
    content,
    myView: '내 관점 본문\n\n### 소제목\n\n- 관점 안의 목록',
    researchMemo: '연구 메모 내용',
    keywords: ['모션그래픽', '인지부하'],
    analysis: { summary: 'S', topic: '', keywords: [], relevance: 4, rationale: '', connection: '', insights: ['i'], citationCandidate: '' },
  });
  const md = materialToMarkdown(m);
  const [it] = await materialsOf('note.md', md);
  const p = it.partial;
  ok(p.id === 'm1', 'ID 보존 → 같은 자료로 인식');
  eq(p.content, content, "본문 안의 '## 내 관점'·코드 블록 속 제목이 있어도 본문이 그대로 유지");
  eq(p.myView, m.myView, '내 관점(소제목·목록 포함) 복원');
  eq(p.researchMemo, '연구 메모 내용', '연구 메모 복원');
  eq(normBib(p.bib), m.bib, '확장 서지정보 전체 복원');
  ok(p.citationIncluded === true && p.keywords?.join() === '모션그래픽,인지부하', '참고문헌 선택·태그 복원');
  ok(planImport([m], [it]).items[0].status === 'same', '내보낸 노트를 그대로 다시 가져오면 변경 없음');

  const crlf = await materialsOf('crlf.md', md.replace(/\n/g, '\r\n'));
  ok(crlf[0].partial.myView?.replace(/\r/g, '') === m.myView && crlf[0].partial.content?.replace(/\r/g, '') === content, 'Windows 줄바꿈(CRLF) 노트도 동일하게 분리');

  const edited = md.replace('내 관점 본문', 'Obsidian에서 고친 관점').replace(/updated: "[^"]+"/, `updated: "${new Date(Date.now() + 60000).toISOString()}"`);
  const up = planImport([m], await materialsOf('note.md', edited)).items[0];
  ok(up.status === 'update' && up.incoming.myView?.startsWith('Obsidian에서 고친 관점') && up.incoming.analysis?.insights[0] === 'i', 'Obsidian에서 관점 수정 → 갱신, 분석 결과는 유지');

  const emptyView = await materialsOf('e.md', materialToMarkdown(mat(undefined)));
  ok(emptyView[0].partial.myView === undefined, '빈 관점 안내문(주석)은 관점으로 저장하지 않음');
  ok(!markdownToHtml(materialToMarkdown(mat(undefined))).includes('&lt;!--'), 'HTML 출력에는 안내 주석이 보이지 않음');

  const oldMd = '---\ntitle: "따옴표 \\"제목\\""\nsource_type: Web\norigin: 원본 자료\npara: Areas\nrelevance: 4\ntags: ["가", "나"]\nurl: https://example.com/a\ncreated: 2026-10-05\nauthor: 홍길동\nyear: 2024\npublisher: 출판사\nexported_from: AI WIKI\n---\n\n# 제목\n\n- 주제: x\n\n## 본문\n\n내용\n\n## 내 관점\n\n옛 관점\n';
  const [o] = await materialsOf('old.md', oldMd);
  ok(o.partial.title === '따옴표 "제목"' && o.partial.content === '내용' && o.partial.myView === '옛 관점' && o.partial.bib?.authors?.[0] === '홍길동', '1차 버전이 내보낸 Markdown도 호환');

  section('4-1. 실제 Obsidian 형식 노트 (tests/fixtures/obsidian-real-note.md)');
  for (const [label, text] of [['LF', obsidianNote], ['CRLF', obsidianNote.replace(/\r?\n/g, '\r\n')]] as const) {
    const [n] = await materialsOf('obsidian-real-note.md', text);
    const q = n.partial;
    const c = (q.content ?? '').replace(/\r/g, '');
    ok(q.title === 'Nine Ways to Reduce Cognitive Load in Multimedia Learning', `[${label}] 제목은 코드 블록 속 '#'이 아닌 H1에서`);
    eq(q.keywords, ['선행연구', '멀티미디어학습', 'cognitive-load', '인지부하'], `[${label}] 속성 tags + 본문 #태그 (코드 블록 속 태그 제외)`);
    ok((q.myView ?? '').replace(/\r/g, '').startsWith('모션그래픽 자막에') && q.myView!.includes('### 활용 아이디어') && !q.myView!.includes('관련 노트'), `[${label}] '## 내 관점'은 다음 ## 제목 전까지만 (### 소제목 포함)`, q.myView);
    ok(c.includes('## 관련 노트') && c.includes('[[중국 드라마 문화 요소]]'), `[${label}] 관점 뒤의 다른 섹션은 본문에 남음`);
    ok(c.includes('```markdown\n# 코드 블록 속 제목은 노트 제목이 아님\n## 내 관점\n코드 예시'), `[${label}] 코드 블록 속 '## 내 관점'은 분리하지 않음`);
    ok(c.includes('> [!note] 요약') && c.includes('[[Sweller 인지부하 이론|인지부하 이론]]') && c.includes('![[figure-1.png]]'), `[${label}] 콜아웃·위키링크·임베드 보존`);
    eq(q.bib?.authors, ['Mayer, Richard E.', 'Moreno, Roxana'], `[${label}] author 목록 속성 → 저자`);
    ok(q.bib?.type === 'journal' && q.bib.container === 'Educational Psychologist' && q.bib.year === '2003' && q.bib.volume === '38' && q.bib.pages === '43-52', `[${label}] journal·year·volume·pages 속성 → 서지정보`);
    ok(q.bib?.doi === '10.1207/S15326985EP3801_6', `[${label}] DOI URL → DOI 정규화`);
    ok(q.url === 'https://www.tandfonline.com/doi/abs/10.1207/S15326985EP3801_6' && q.fileName === 'obsidian-real-note.md' && !q.id, `[${label}] url 속성, 파일명 기록, ID 없음(새 자료)`);
    ok(q.createdAt && !Number.isNaN(Date.parse(q.createdAt)), `[${label}] created 속성 → 등록일`);
    const nm = normalizeMaterial(q, 'x')!;
    ok(nm.bibStatus === '서지정보 입력됨', `[${label}] 필수 서지 항목이 모두 있어 '입력됨'`, checkBib(nm));
    ok(cite({ ...nm, bib: { ...nm.bib!, title: undefined } }, 'APA 7')?.startsWith('Mayer, R. E., & Moreno, R. (2003). Nine Ways'), `[${label}] 가져온 서지로 APA 서식 생성`);
  }
}

/* ───────── 5. 참고문헌 서식 ───────── */

function citationTests() {
  section('5. 참고문헌 서식 — 유형별 필수 항목 · 4개 양식');
  const j = mat(journalBib);
  eq(cite(j, 'APA 7'), 'Mayer, R. E., & Moreno, R. (2003). Nine ways to reduce cognitive load in multimedia learning. Educational Psychologist, 38(1), 43–52. https://doi.org/10.1207/S15326985EP3801_6', 'APA 7 학술지 (2인, DOI)');
  eq(formatCitation(j, 'APA 7')?.filter((s) => typeof s !== 'string'), [{ i: 'Educational Psychologist' }, { i: '38' }], 'APA 7 학술지명·권 기울임');
  eq(cite(j, 'Chicago'), 'Mayer, Richard E., and Roxana Moreno. 2003. “Nine ways to reduce cognitive load in multimedia learning.” Educational Psychologist 38 (1): 43–52. https://doi.org/10.1207/S15326985EP3801_6.', 'Chicago 저자-연도 학술지');
  eq(cite(j, 'MLA 9'), 'Mayer, Richard E., and Roxana Moreno. “Nine ways to reduce cognitive load in multimedia learning.” Educational Psychologist, vol. 38, no. 1, 2003, pp. 43–52, https://doi.org/10.1207/S15326985EP3801_6.', 'MLA 9 학술지');
  eq(cite(j, '국내 학술지 일반형'), 'Mayer, Richard E.·Moreno, Roxana, 「Nine ways to reduce cognitive load in multimedia learning」, 『Educational Psychologist』 38(1), 2003, 43-52쪽. DOI: https://doi.org/10.1207/S15326985EP3801_6', '국내 일반형 학술지');

  const kj = mat({ type: 'journal', author: '', authors: ['홍길동', '김철수'], year: '2024', publisher: '한국콘텐츠학회', title: '모션그래픽 자막의 문화 정보 전달 연구', container: '한국콘텐츠학회논문지', volume: '24', issue: '3', pages: '45-67' });
  eq(cite(kj, '국내 학술지 일반형'), '홍길동·김철수, 「모션그래픽 자막의 문화 정보 전달 연구」, 『한국콘텐츠학회논문지』 24(3), 한국콘텐츠학회, 2024, 45-67쪽.', '국내 일반형 — 한글 저자 (가상 자료)');
  eq(cite(kj, 'APA 7'), '홍길동, 김철수 (2024). 모션그래픽 자막의 문화 정보 전달 연구. 한국콘텐츠학회논문지, 24(3), 45–67.', 'APA 7 — 한글 저자는 이름 그대로, & 없이');

  const book = mat({ type: 'book', author: '', authors: ['Mayer, Richard E.'], year: '2021', publisher: 'Cambridge University Press', title: 'Multimedia learning', edition: '3', place: 'Cambridge' });
  eq(cite(book, 'APA 7'), 'Mayer, R. E. (2021). Multimedia learning (3rd ed.). Cambridge University Press.', 'APA 7 단행본 (판)');
  eq(cite(book, 'Chicago'), 'Mayer, Richard E. 2021. Multimedia learning. 3rd ed. Cambridge: Cambridge University Press.', 'Chicago 단행본 (출판지)');
  eq(cite(book, 'MLA 9'), 'Mayer, Richard E. Multimedia learning. 3rd ed., Cambridge University Press, 2021.', 'MLA 9 단행본');
  eq(cite(book, '국내 학술지 일반형'), 'Mayer, Richard E., 『Multimedia learning』 제3판, Cambridge: Cambridge University Press, 2021.', '국내 일반형 단행본');

  const chap = mat({ type: 'chapter', author: '', authors: ['Sweller, John'], year: '2005', publisher: 'Cambridge University Press', title: 'Implications of cognitive load theory for multimedia learning', container: 'The Cambridge handbook of multimedia learning', editors: ['Mayer, Richard E.'], pages: '19-30' });
  eq(cite(chap, 'APA 7'), 'Sweller, J. (2005). Implications of cognitive load theory for multimedia learning. In R. E. Mayer (Ed.), The Cambridge handbook of multimedia learning (pp. 19–30). Cambridge University Press.', 'APA 7 편저 수록 장');
  ok(checkBib(chap).warnings.some((w) => w.includes('출판지')), 'Chicago용 출판지는 권장 항목으로 안내');

  const thesis = mat({ type: 'thesis', author: '', authors: ['이수연'], year: '2026', publisher: '한국외국어대학교', title: 'AI 모션그래픽 기반 한중문화콘텐츠 개발 연구', degree: '석사' });
  eq(cite(thesis, 'APA 7'), '이수연 (2026). AI 모션그래픽 기반 한중문화콘텐츠 개발 연구 [석사학위논문, 한국외국어대학교].', 'APA 7 한글 학위논문 (가상 자료)');
  eq(cite(thesis, '국내 학술지 일반형'), '이수연, 「AI 모션그래픽 기반 한중문화콘텐츠 개발 연구」, 한국외국어대학교 석사학위논문, 2026.', '국내 일반형 학위논문');

  const web = mat({ type: 'web', author: '', authors: ['한국콘텐츠진흥원'], year: 'n.d.', publisher: '', title: '콘텐츠 산업 동향', container: 'KOCCA', accessed: '2026-10-11' }, { url: 'https://www.kocca.kr/report' });
  eq(cite(web, '국내 학술지 일반형'), '한국콘텐츠진흥원, 「콘텐츠 산업 동향」, KOCCA, 연도 미상. https://www.kocca.kr/report (검색일: 2026.10.11)', '국내 일반형 웹 문서 (자료 URL 사용, 검색일)');
  eq(cite(web, 'MLA 9'), '한국콘텐츠진흥원. “콘텐츠 산업 동향.” KOCCA, www.kocca.kr/report. Accessed 11 Oct. 2026.', 'MLA 9 웹 문서 (n.d. 생략, 접속일)');

  const video = mat({ type: 'video', author: '', authors: ['채널명'], year: '2025', publisher: '', title: '중국 드라마 속 문화 표현', container: 'YouTube' }, { url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  eq(cite(video, 'APA 7'), '채널명 (2025). 중국 드라마 속 문화 표현 [동영상]. YouTube. https://www.youtube.com/watch?v=abcdefghijk', 'APA 7 영상');

  const authors = (n: number) => Array.from({ length: n }, (_, i) => `Last${i + 1}, First`);
  const many = (n: number) => mat({ ...journalBib, authors: authors(n) });
  ok(cite(many(3), 'APA 7')?.startsWith('Last1, F., Last2, F., & Last3, F. (2003)'), 'APA 7 저자 3명');
  ok(cite(many(21), 'APA 7')?.startsWith('Last1, F., Last2, F.') && cite(many(21), 'APA 7')!.includes('Last19, F., . . . Last21, F. (2003)'), 'APA 7 저자 21명 이상 (19명 … 마지막 저자)');
  ok(cite(many(3), 'MLA 9')?.startsWith('Last1, First, et al. “'), 'MLA 9 저자 3명 이상 et al.');
  ok(cite(many(3), 'Chicago')?.startsWith('Last1, First, First Last2, and First Last3. 2003.'), 'Chicago 저자 3명');

  const noVol = mat({ ...journalBib, volume: undefined });
  ok(formatCitation(noVol, 'APA 7') === null && checkBib(noVol).missing.includes('권') && noVol.bibStatus === '서지정보 확인 필요', '필수 항목(권)이 없으면 서식을 만들지 않고 확인 필요');
  const legacy = mat({ author: '홍길동', year: '2024', publisher: '발행처' });
  ok(legacy.bibStatus === '서지정보 확인 필요' && checkBib(legacy).missing[0] === '자료 유형 미지정', 'v1 서지정보(유형 없음)는 확인 필요');
  ok(checkBib(mat({ ...journalBib, year: '2003년' })).missing.some((x) => x.includes('연도 형식')), '연도 형식 오류 감지');
  ok(checkBib(mat({ ...journalBib, doi: 'abc' })).missing.some((x) => x.includes('DOI')), 'DOI 형식 오류 감지');
  ok(checkBib(mat({ ...journalBib, year: 'n.d.' })).missing.some((x) => x.includes('n.d. 불가')), '학술지 논문에는 n.d. 불가');
  ok(checkBib(mat({ ...journalBib, authors: ['Richard Mayer'] })).warnings.some((w) => w.includes("'성, 이름'")), "쉼표 없는 영문 이름은 '성, 이름' 형식 안내");
  ok(segsToHtml(formatCitation(j, 'APA 7')!).includes('<i>Educational Psychologist</i>'), 'HTML 내보내기에서 기울임 유지');

  const sorted = sortForStyle([mat(journalBib, { id: 'a' }), mat({ ...kj.bib! }, { id: 'b' }), mat({ ...book.bib!, authors: ['Anderson, A.'] }, { id: 'c' })], '국내 학술지 일반형');
  eq(sorted.map((m) => m.id), ['b', 'c', 'a'], '국내 일반형 정렬: 한글 저자 먼저, 이후 영문 성 순');
  eq(sortForStyle([mat(journalBib, { id: 'a' }), mat({ ...book.bib!, authors: ['Anderson, A.'] }, { id: 'c' })], 'APA 7').map((m) => m.id), ['c', 'a'], 'APA 정렬: 첫 저자 성 순');
  eq(sameAuthorYear([mat(journalBib, { id: 'a' }), mat(journalBib, { id: 'b' })]), ['Mayer, Richard E.; Moreno, Roxana (2003)'], '같은 저자·연도 자료 감지 (2003a/b 안내용)');
}

(async () => {
  await storageTests();
  await backupTests();
  await planTests();
  await markdownTests();
  citationTests();
  console.log(`\n${failed ? '실패' : '모두 통과'}: ${passed}건 통과, ${failed}건 실패`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
