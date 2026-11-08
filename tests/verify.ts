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
import { nextRecoveryAcks, recoveryAckKey, recoveryKey, visibleRecovery, type RecoveryCopy } from '../src/lib/idb-store';
import { checkCitations, extractCitations, matchCitation } from '../src/lib/cite-check';
import { normalizeEvent, normalizeThesis } from '../src/lib/projects';
import { applySaveRecord, changedProjects, eventLabel, formatSave, MAX_EVENTS, parseSave, recordSaves, type SaveChange } from '../src/lib/project-history';
import { SaveLoop } from '../src/lib/save-loop';
import { analyzeTemplate, TEMPLATE_LIMITS, TemplateError, toHwpxTemplate } from '../src/lib/hwpx-template';
import { checkFootnotes, segmentLine, splitNotes } from '../src/lib/footnotes';
import { buildThesisHwpx, thesisXml, zipStore, type ThesisDoc } from '../src/lib/hwpx';
import sampleThesis from '../.claude/skills/hufs-thesis-writing/examples/sample-thesis.json';
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
  // JSON object member order is not data; array order remains significant.
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
  const a = canonical(actual);
  const e = canonical(expected);
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
  projects: [],
  currentProjectId: null,
  events: [],
  aiOutputs: [],
  theses: [],
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

function recoveryAckTests() {
  console.log('\n[6] 복구 사본 확인 기록');
  const copy = (user: string, id: string, savedAt: string) => ({ key: recoveryKey(user, id), version: 1, savedAt, state: {} as AppState }) as RecoveryCopy;
  const a1 = copy('user-a', 'tab1', '2026-11-08T05:00:00.000Z');
  const a2 = copy('user-a', 'tab2', '2026-11-08T06:00:00.000Z');
  eq(visibleRecovery([a1, a2], []).map((c) => c.key), [a1.key, a2.key], '확인 기록이 없으면(읽기 실패 포함) 모든 사본을 안내');
  const acks = nextRecoveryAcks([], [a1, a2], [a1, a2]);
  eq(visibleRecovery([a1, a2], acks), [], '확인한 사본은 안내에서 제외');
  const a1Again = { ...a1, savedAt: '2026-11-08T07:00:00.000Z' };
  eq(visibleRecovery([a1Again, a2], acks).map((c) => c.key), [a1.key], '같은 사본이 다시 저장되면(savedAt 변경) 다시 안내');
  const a3 = copy('user-a', 'tab3', '2026-11-08T08:00:00.000Z');
  eq(visibleRecovery([a1, a2, a3], acks).map((c) => c.key), [a3.key], '새로 생긴 사본은 안내');
  eq(nextRecoveryAcks(acks, [a3], [a2, a3]), [{ key: a2.key, savedAt: a2.savedAt }, { key: a3.key, savedAt: a3.savedAt }], '이미 없어진 사본의 기록은 정리하고 남은 사본의 기록은 유지');
  eq(nextRecoveryAcks(acks, [a1Again], [a1Again, a2]), [{ key: a2.key, savedAt: a2.savedAt }, { key: a1.key, savedAt: a1Again.savedAt }], '다시 확인하면 새 savedAt으로 바뀜(중복 기록 없음)');
  ok(recoveryAckKey('user-a') !== recoveryAckKey('user-b'), '확인 기록은 계정마다 따로 저장');
  const b1 = copy('user-b', 'tab1', a1.savedAt);
  eq(visibleRecovery([b1], acks).map((c) => c.key), [b1.key], '다른 계정의 확인 기록은 적용되지 않음');
  ok(!recoveryAckKey('user-a').startsWith('ai-wiki:cloud-draft:user-a:'), '확인 기록 키는 복구 사본으로 읽히지 않음');
  ok(acks.every((a) => !('state' in a)), '확인 기록에는 key·savedAt만 저장(사본 내용 복제 없음)');
}

function citeCheckTests() {
  console.log('\n[7] 본문 인용 점검');
  const m = (id: string, authors: string[], year: string): Material =>
    ({ ...normalizeMaterial({ id, title: `자료 ${id}`, sourceType: 'PDF' })!, bib: { author: authors.join('; '), authors, year, publisher: '' } }) as Material;
  const mats = [
    m('hong', ['홍길동'], '2020'),
    m('mayer', ['Mayer, Richard E.', 'Moreno, Roxana'], '2003'),
    m('smith', ['Smith, J.', 'Doe, A.', 'Roe, B.'], '2021'),
    m('wang', ['王小明'], '2018'),
    m('kim1', ['Kim, Minsu'], '2019'),
    m('lee-a', ['Lee, Ara'], '2023a'),
    m('lee-b', ['Lee, Ara'], '2023b'),
    m('park1', ['박지민'], '2022'),
    m('park2', ['박지민'], '2022'),
  ];
  const one = (text: string) => extractCitations(text).map((c) => matchCitation(c, mats));
  const ids = (text: string) => one(text).map((c) => `${c.status}:${c.ids.join('+')}`);

  eq(ids('선행연구가 있다(홍길동, 2020).'), ['matched:hong'], '괄호형 한글 인용');
  eq(ids('홍길동(2020)은 이를 지적했다.'), ['matched:hong'], '서술형 한글 인용');
  eq(ids('(홍길동 외, 2020)'), ['matched:hong'], "'외' 인용");
  eq(ids('(Mayer & Moreno, 2003)'), ['matched:mayer'], '영문 두 저자 괄호형');
  eq(ids('Smith et al. (2021) found'), ['matched:smith'], '영문 et al. 서술형');
  eq(ids('王小明(2018)指出'), ['matched:wang'], '중국어 서술형');
  eq(ids('(王小明 等, 2018)'), ['matched:wang'], '중국어 等 괄호형');
  eq(ids('(Kim, 2019, p. 12)'), ['matched:kim1'], '쪽 번호가 붙은 인용');
  eq(ids('(홍길동, 2020; Kim, 2019)'), ['matched:hong', 'matched:kim1'], '한 괄호 안 여러 인용');
  eq(ids('(Lee, 2023b)'), ['matched:lee-b'], '2023a/b 표기가 자료와 일치하면 연결');
  eq(one('(박지민, 2022)').map((c) => c.status), ['ambiguous'], '같은 저자·연도 자료가 여럿이면 확인 필요 (동명 저자)');
  eq(one('(박지민, 2022a)').map((c) => c.status), ['ambiguous'], '2022a로 인용했지만 자료에 a/b 표기가 없으면 확인 필요');
  eq(one('(홍길동, 2019)').map((c) => [c.status, !!c.note]), [['unmatched', true]], '저자는 있으나 연도가 다르면 연결하지 않고 이유 표시');
  eq(one('(박영희, 2015)').map((c) => c.status), ['unmatched'], '목록에 없는 저자는 연결되지 않음');
  eq(extractCitations('2020년 기준(2020년)으로 집계했다(N=120).').length, 0, '연도만 있는 괄호·숫자 괄호는 인용으로 보지 않음');

  const chapters = [
    { id: 'c1', title: 'Ⅰ. 서론', sections: [], text: '홍길동(2020)은 … (Mayer & Moreno, 2003). 선행연구(2020)에 따르면 … (박영희, 2015) (박지민, 2022)', citedIds: ['hong', 'smith'] },
    { id: 'c2', title: 'Ⅱ. 이론', sections: [], text: 'Smith et al. (2021)' },
  ];
  const refIds = new Set(['hong', 'smith', 'wang', 'park1']);
  const basisIds = new Set(['hong', 'smith', 'wang', 'park1', 'mayer']);
  const r = checkCitations(chapters, mats, refIds, basisIds);
  eq(r.citedNotInRefs.map((x) => [x.material.id, x.reason]), [['mayer', '서지 미완성']], '본문에 인용됐지만 참고문헌에 없는 자료와 이유');
  eq(r.refsNotCited.map((x) => x.id), ['wang'], '참고문헌에만 있는 자료 (후보로 걸린 자료는 단정하지 않음)');
  eq(r.unmatched.map((c) => c.raw), ['(박영희, 2015)'], '자료와 연결되지 않는 괄호형 인용');
  eq(r.needsCheck.map((c) => c.status).sort(), ['ambiguous', 'unmatched'], "서술형 비인용 의심('선행연구(2020)')과 동명 저자는 확인 필요");
  eq(r.aiMismatch.map((x) => [x.chapterId, x.missingInText.map((y) => y.id), x.notInAi.map((y) => y.id)]), [['c1', ['smith'], ['mayer']]], 'AI 인용 기록과 본문 차이 (기록이 있는 장만)');

  const loaded = normalizeThesis({ projectId: 'p', titleKo: 't', chapters: [{ id: 'a', title: 'Ⅰ', text: 'x', citedIds: ['hong'] }, { id: 'b', title: 'Ⅱ', text: 'y' }] });
  eq(loaded?.chapters.map((c) => c.citedIds), [['hong'], undefined], '장별 citedIds는 저장·복원되고, 이전 원고는 필드 없이 그대로');
}

async function footnoteTests() {
  console.log('\n[8] 각주');
  const s = splitNotes('본문입니다.[^1]\n[^1]: 첫 각주\n[^1]: 다시 정의\n[^a]:   두 번째  ');
  eq([s.body, [...s.defs], s.duplicates], ['본문입니다.[^1]', [['1', '첫 각주'], ['a', '두 번째']], ['1']], '정의 줄 분리·중복 정의 기록(처음 정의 사용)');
  const defs = new Map([['1', '각주 하나'], ['b', '각주 둘']]);
  eq(segmentLine('앞[^1] 뒤[^b]', defs), [{ text: '앞' }, { note: '각주 하나' }, { text: ' 뒤' }, { note: '각주 둘' }], '문단을 글자/각주 조각으로 나눔');
  eq(segmentLine('정의 없는 표시[^9]', defs), [{ text: '정의 없는 표시[^9]' }], '정의 없는 표시는 글자로 남김');
  eq(segmentLine('[^1]로 시작', defs), [{ note: '각주 하나' }, { text: '로 시작' }], '문단 맨 앞 각주');

  const chk = checkFootnotes([
    { title: 'Ⅰ', text: '가[^1] 나[^1] 다[^x] 라[^e]\n[^1]: 내용\n[^1]: 중복\n[^u]: 안 씀\n[^e]:' },
    { title: 'Ⅱ', text: '각주 없음' },
  ]);
  eq(chk.count, 2, '각주로 바뀌는 표시 수(정의 없는·빈 표시 제외)');
  eq(chk.issues.map((x) => `${x.label}:${x.kind}`).sort(), ['1:여러 번 참조', '1:중복 정의', 'e:내용 없음', 'u:사용되지 않음', 'x:정의 없음'].sort(), '정의 없음·중복·미사용·빈 내용·여러 번 참조 경고');

  // HWPX: 실제 각주 객체, 문서 전체 연속 번호, 고유 instId, 이스케이프
  const doc = {
    ...(sampleThesis as unknown as ThesisDoc),
    chapters: [
      { title: 'Ⅰ. 서론', text: '첫 문장이다.[^1] 중간[^2] 끝.\n## 1. 배경[^1]\n[^1]: A & B <C> "인용"\n[^2]: 두 번째' },
      { title: 'Ⅱ. 본론', text: '다음 장 문장.[^1]\n정의 없는 표시[^9] 유지\n[^1]: 세 번째' },
    ],
  };
  for (const docType of ['학위논문', '학술지논문'] as const) {
    const { section, header } = thesisXml({ ...doc, docType });
    const notes = [...section.matchAll(/<hp:footNote number="(\d+)" suffixChar="41" instId="(\d+)">/g)];
    eq(notes.map((m) => m[1]), ['1', '2', '3', '4'], `${docType}: 각주 4개, 문서 전체 연속 번호`);
    eq(new Set(notes.map((m) => m[2])).size, 4, `${docType}: instId가 모두 다름`);
    eq([...section.matchAll(/<hp:autoNum num="(\d+)" numType="FOOTNOTE">/g)].map((m) => m[1]), ['1', '2', '3', '4'], `${docType}: 각주 번호 필드`);
    ok(section.includes('paraPrIDRef="10" styleIDRef="15"') && section.includes('<hp:run charPrIDRef="3"><hp:ctrl><hp:autoNum'), `${docType}: 골격의 각주 스타일(15)·문단(10)·글자(3) 사용`);
    ok(header.includes('<hh:style id="15" type="PARA"') && header.includes('<hh:paraPr id="10"') && header.includes('<hh:charPr id="3"'), `${docType}: 참조하는 스타일·모양이 header에 있음`);
    ok(section.includes('<hp:t> A &amp; B &lt;C&gt; &quot;인용&quot;</hp:t>') && !section.includes('<C>'), `${docType}: 각주 내용 특수문자 이스케이프`);
    ok(section.includes('<hp:t>첫 문장이다.</hp:t><hp:ctrl><hp:footNote number="1"') && section.includes('<hp:t> 끝.</hp:t>'), `${docType}: 문장 중간 각주 앞뒤 글자 분리`);
    ok(/<\/hp:footNote><\/hp:ctrl><hp:t\/><\/hp:run>/.test(section), `${docType}: 문단 끝 각주 뒤 빈 글자(한글 저장 형식)`);
    ok(!section.includes('[^1]') && !section.includes('[^2]') && !section.includes('세 번째</hp:t></hp:run></hp:p><hp:p'), `${docType}: 각주 표시와 정의 줄은 본문 문단으로 남지 않음`);
    ok(section.includes('정의 없는 표시[^9] 유지'), `${docType}: 정의 없는 표시는 글자 그대로`);
    eq((section.match(/<hp:footNote /g) ?? []).length, (section.match(/<\/hp:footNote>/g) ?? []).length, `${docType}: 각주 태그 짝이 맞음`);
  }
  ok(!thesisXml({ ...doc, docType: '학위논문' }).section.includes('    1. 배경[^1]'), '목차의 절 제목에서 각주 표시 제거');

  // 각주가 없는 원고는 기존과 같은 HWPX 바이트 (main 0780824 기준값)
  const when = new Date('2026-01-15T12:00:00Z');
  const sha = async (d: ThesisDoc) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buildThesisHwpx(d, when)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const base = sampleThesis as unknown as ThesisDoc;
  eq(await sha({ ...base, docType: '학위논문' }), '3e5a78eaa58c7203b21e7295d4faec98d2b68651897096032219eb83c9e2a505', '각주 없는 학위논문 HWPX는 기존 출력과 동일');
  eq(await sha({ ...base, docType: '학술지논문', journal: '시험용 학술지', affiliation: '시험용 소속' }), 'b39f54d5d395447bbc8f2562b34668bb97c3261ae6f7471f5091486bfd9582c7', '각주 없는 학술지논문 HWPX는 기존 출력과 동일');
}

function saveHistoryTests() {
  console.log('\n[9] 프로젝트별 저장 이력');
  const proj = (id: string) => ({ id, name: id, topic: '', keywords: [], overview: '', defaultView: '', status: '진행 중', createdAt: 'x', updatedAt: 'x', degree: '석사', department: '', advisor: '', student: '', studentEn: '', departmentEn: '' }) as unknown as AppState['projects'][number];
  const mat = (id: string, projectId: string, title = id) => ({ ...normalizeMaterial({ id, title, sourceType: 'PDF', createdAt: '2026-01-01T00:00:00.000Z' })!, projectId });
  const base: AppState = {
    materials: [mat('m1', 'P1'), mat('m2', 'P1'), mat('m3', 'P2')],
    settings: {} as AppState['settings'], writing: {} as AppState['writing'], selectedId: null,
    projects: [proj('P1'), proj('P2')], currentProjectId: 'P1', events: [], aiOutputs: [],
    theses: [{ projectId: 'P1', titleKo: 't', subtitle: '', titleEn: '', submitYear: '2026', submitMonth: '12', chapters: [], abstractKo: '', abstractEn: '', keywordsEn: '', materialIds: [], updatedAt: 'a' }],
  };
  const ids = (cs: SaveChange[]) => cs.map((c) => c.projectId);

  eq(changedProjects(base, base), [], '변경 없음 → 기록 없음');
  eq(changedProjects(base, { ...base, settings: { ...base.settings }, selectedId: 'm1', currentProjectId: 'P2' }), [], '프로젝트와 무관한 변경(설정·선택)만 → 기록 없음');
  eq(changedProjects(base, { ...base, events: [{ id: 'e', projectId: 'P1', at: '2026-01-01T00:00:00.000Z', kind: '저장', text: '저장 — 원고' }] }), [], '이력만 바뀐 저장 → 기록 없음 (반복 저장 차단)');
  eq(changedProjects(base, { ...base, materials: base.materials.map((m) => ({ ...m })) }), [], '객체만 새로 만들고 내용이 같으면(복원 등) 기록 없음');
  const added = changedProjects(base, { ...base, materials: [mat('m9', 'P1'), ...base.materials] });
  eq(added, [{ projectId: 'P1', counts: { added: 1, updated: 0, removed: 0, draft: false, outputs: 0, info: false } }], '자료 추가 → 그 프로젝트만');
  eq(changedProjects(base, { ...base, materials: base.materials.map((m) => (m.id === 'm2' ? { ...m, title: '수정' } : m)) })[0].counts.updated, 1, '자료 수정');
  eq(changedProjects(base, { ...base, materials: base.materials.filter((m) => m.id !== 'm1') })[0].counts.removed, 1, '자료 삭제');
  eq(ids(changedProjects(base, { ...base, materials: base.materials.map((m) => (m.id === 'm1' ? { ...m, projectId: 'P2' } : m)) })), ['P1', 'P2'], '자료를 다른 프로젝트로 옮기면 양쪽 모두');
  eq(changedProjects(base, { ...base, theses: [{ ...base.theses[0], abstractKo: '초록', updatedAt: 'b' }] })[0].counts.draft, true, '원고 변경');
  eq(changedProjects(base, { ...base, aiOutputs: [{ id: 'o1', projectId: 'P2', kind: '전체 분석', title: 'x', createdAt: 'x', model: 'm', content: 'c', materialIds: [] }] }), [{ projectId: 'P2', counts: { added: 0, updated: 0, removed: 0, draft: false, outputs: 1, info: false } }], 'AI 결과물 추가');
  eq(changedProjects(base, { ...base, projects: [{ ...base.projects[0], topic: '새 주제' }, base.projects[1]] })[0].counts.info, true, '프로젝트 정보 수정');
  eq(changedProjects(base, { ...base, projects: [base.projects[1]], materials: base.materials.filter((m) => m.projectId !== 'P1') }), [], '삭제된 프로젝트는 기록하지 않음');

  const c = { added: 2, updated: 1, removed: 0, draft: true, outputs: 0, info: false };
  eq(formatSave(c), '저장 — 자료 추가 2건, 자료 수정 1건, 원고', '요약 문구');
  eq(parseSave(formatSave(c)), c, '요약 문구 ↔ 숫자 왕복');
  eq(parseSave('자료를 추가했습니다.'), null, '다른 이력 문구는 묶지 않음');
  eq([eventLabel({ kind: '저장', text: formatSave(c) }), eventLabel({ kind: '자료', text: '저장 — 그대로' }), eventLabel({ kind: '저장', text: '직접 쓴 문구' })], ['자료 추가 2건, 자료 수정 1건, 원고', '저장 — 그대로', '직접 쓴 문구'], "화면 표시: '저장' 이력만 앞의 '저장 — '를 빼고 보여 줌 (저장 데이터는 그대로)");

  let n = 0;
  const id = () => `ev${++n}`;
  const t0 = '2026-01-01T09:00:00.000Z';
  const one = recordSaves([], [{ projectId: 'P1', counts: c }], t0, id);
  eq(one.map((e) => [e.id, e.kind, e.at, e.text]), [['ev1', '저장', t0, '저장 — 자료 추가 2건, 자료 수정 1건, 원고']], "새 '저장' 이력");
  const other = { id: 'x', projectId: 'P1', at: '2026-01-01T09:01:00.000Z', kind: '자료' as const, text: '자료를 추가했습니다.' };
  const t1 = '2026-01-01T09:05:00.000Z';
  const merged = recordSaves([other, ...one], [{ projectId: 'P1', counts: { ...c, added: 1, draft: false, info: true } }], t1, id);
  eq(merged.map((e) => [e.id, e.at, e.text]), [['ev1', t1, '저장 — 자료 추가 3건, 자료 수정 2건, 원고, 프로젝트 정보'], ['x', other.at, other.text]], '10분 안 같은 프로젝트 저장은 하나로 묶고 맨 앞으로 (같은 id)');
  const t2 = '2026-01-01T09:15:01.000Z';
  eq(recordSaves(merged, [{ projectId: 'P1', counts: c }], t2, id).filter((e) => e.kind === '저장').length, 2, '10분이 지나면 새 이력');
  eq(recordSaves(one, [{ projectId: 'P2', counts: c }], t1, id).map((e) => e.projectId), ['P2', 'P1'], '다른 프로젝트는 따로 기록');
  const full = Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: `old${i}`, projectId: 'P2', at: t0, kind: '자료' as const, text: 't' }));
  const capped = recordSaves(full, [{ projectId: 'P1', counts: c }], t1, id);
  eq([capped.length, capped[0].kind, capped[capped.length - 1].id], [MAX_EVENTS, '저장', `old${MAX_EVENTS - 2}`], '전체 500건 제한 유지');

  // 저장 성공 → 기록 → 기록만 바뀐 다음 저장은 다시 기록하지 않는 흐름
  const s1 = { ...base, materials: [mat('m9', 'P1'), ...base.materials] };
  const ch1 = changedProjects(base, s1);
  const s2 = { ...s1, events: recordSaves(s1.events, ch1, t0, id) };
  eq([ch1.length, changedProjects(s1, s2).length], [1, 0], '기록 후 다음 저장에서 반복 기록이 생기지 않음');
  eq(normalizeEvent({ id: 'e', projectId: 'P1', at: t0, kind: '저장', text: '저장 — 원고' })?.kind, '저장', "'저장' 이력 종류가 불러오기에서 유지됨");
}

async function saveLoopTests() {
  console.log('\n[10] 저장 → 이력 등록 → 이력 저장 통합 흐름 (가짜 저장 엔진, 서버 접속 없음)');
  const proj = (id: string) => ({ id, name: id, topic: '', keywords: [], overview: '', defaultView: '', status: '진행 중', createdAt: 'x', updatedAt: 'x', degree: '석사', department: '', advisor: '', student: '', studentEn: '', departmentEn: '' }) as unknown as AppState['projects'][number];
  const mat = (id: string, projectId: string) => ({ ...normalizeMaterial({ id, title: id, sourceType: 'PDF', createdAt: '2026-01-01T00:00:00.000Z' })!, projectId });
  const boot = (): AppState => ({
    materials: [mat('m1', 'P1'), mat('m2', 'P2')],
    settings: {} as AppState['settings'], writing: {} as AppState['writing'], selectedId: null,
    projects: [proj('P1'), proj('P2')], currentProjectId: 'P1', events: [], aiOutputs: [],
    theses: [{ projectId: 'P2', titleKo: 't', subtitle: '', titleEn: '', submitYear: '2026', submitMonth: '12', chapters: [], abstractKo: '', abstractEn: '', keywordsEn: '', materialIds: [], updatedAt: 'a' }],
  });
  const tick = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

  class FakeEngine {
    saves: AppState[] = [];
    failNext = 0;
    gate: Promise<void> | null = null;
    async save(s: AppState) {
      if (this.gate) await this.gate;
      if (this.failNext > 0) { this.failNext--; throw new Error('가짜 저장 실패'); }
      this.saves.push(s);
    }
  }
  /** CloudStore와 같은 순서: 변경 → 저장 대기열 → 성공 시 이력 기록(일반 변경처럼 다시 저장) */
  class Harness {
    state: AppState;
    edits = 0;
    saved = 0;
    error: string | null = null;
    clock = '2026-01-01T09:00:00.000Z';
    private n = 0;
    loop: SaveLoop;
    constructor(public engine: FakeEngine, b = boot()) {
      this.state = b;
      this.loop = new SaveLoop(engine, b, {
        isMounted: () => true,
        onSaved: (edits, changes) => {
          this.saved = Math.max(this.saved, edits);
          if (changes.length) this.change((s) => applySaveRecord(s, changes, this.clock, () => `ev${++this.n}`));
        },
        onError: (m) => { this.error = m; },
      });
    }
    change(fn: (s: AppState) => AppState) {
      this.state = fn(this.state);
      this.edits++;
      void this.loop.enqueue(this.state, this.edits);
    }
    retry() { this.loop.resume(); this.error = null; void this.loop.enqueue(this.state, this.edits); }
    saveEvents() { return this.state.events.filter((e) => e.kind === '저장'); }
  }
  const addMat = (id: string, p: string) => (s: AppState) => ({ ...s, materials: [mat(id, p), ...s.materials] });

  // 1. 정상: 저장 성공 → 이력 1건 → 이력 저장 1번 → 멈춤
  {
    const eng = new FakeEngine();
    const h = new Harness(eng);
    const before = h.state;
    h.change(addMat('n1', 'P1'));
    await tick();
    eq([eng.saves.length, h.saveEvents().length, h.saved === h.edits], [2, 1, true], '저장 성공 → 이력 1건 → 이력 저장 1번 후 대기 상태');
    ok(eng.saves[1].events.some((e) => e.kind === '저장' && e.projectId === 'P1'), '이력이 서버 저장 내용에 포함됨');
    await tick();
    eq(eng.saves.length, 2, '추가 저장이 더 생기지 않음 (무한 반복 없음)');
    const last = h.state;
    ok(last.materials.find((m) => m.id === 'm2') === before.materials.find((m) => m.id === 'm2') && last.theses === before.theses && last.projects === before.projects && last.settings === before.settings && last.aiOutputs === before.aiOutputs, '다른 프로젝트(P2) 자료·원고·프로젝트·설정은 그대로');
    eq(h.state.events.map((e) => e.projectId), ['P1'], '이력은 바뀐 프로젝트(P1)에만');
  }

  // 2. 저장 실패 → 기록 없음 → 재시도 성공 시 그동안의 변경을 한 번에 기록
  {
    const eng = new FakeEngine();
    eng.failNext = 1;
    const h = new Harness(eng);
    h.change(addMat('n1', 'P1'));
    await tick();
    eq([eng.saves.length, h.saveEvents().length, !!h.error], [0, 0, true], '저장 실패 → 이력 없음, 오류 표시');
    h.change(addMat('n2', 'P1'));
    await tick();
    eq(eng.saves.length, 0, '실패 후에는 다시 시도 전까지 저장하지 않음');
    h.retry();
    await tick();
    eq([eng.saves.length, h.saveEvents().length, h.saveEvents()[0]?.text], [2, 1, '저장 — 자료 추가 2건'], '재시도 성공 → 실패 동안의 변경을 이력 1건으로');
  }

  // 3. 이력 저장 실패 → 재시도 → 이력 중복·반복 없음
  {
    const eng2 = new FakeEngine();
    const h2 = new Harness(eng2);
    const origSave = eng2.save.bind(eng2);
    let calls = 0;
    eng2.save = async (s: AppState) => { calls++; if (calls === 2) throw new Error('이력 저장 실패'); return origSave(s); };
    h2.change(addMat('n1', 'P1'));
    await tick();
    eq([eng2.saves.length, h2.saveEvents().length, !!h2.error], [1, 1, true], '이력 저장 실패 → 화면 이력 1건, 오류 표시');
    h2.retry();
    await tick();
    eq([eng2.saves.length, h2.saveEvents().length], [2, 1], '재시도로 이력 저장 → 이력 중복 없음');
    ok(eng2.saves[1].events.filter((e) => e.kind === '저장').length === 1, '서버에 저장된 이력도 1건');
    await tick();
    eq(eng2.saves.length, 2, '재시도 뒤 반복 저장 없음');
  }

  // 4. 저장 중 추가 수정 → 각각 정확히 기록
  {
    const eng = new FakeEngine();
    let open!: () => void;
    eng.gate = new Promise((r) => { open = r; });
    const h = new Harness(eng);
    h.change(addMat('n1', 'P1'));
    await tick();
    h.change((s) => ({ ...s, theses: s.theses.map((t) => (t.projectId === 'P2' ? { ...t, abstractKo: '초록', updatedAt: 'b' } : t)) }));
    eng.gate = null;
    open();
    await tick();
    eq(h.saveEvents().map((e) => [e.projectId, e.text]).sort(), [['P1', '저장 — 자료 추가 1건'], ['P2', '저장 — 원고']], '저장 중 생긴 다른 프로젝트 수정도 따로 기록');
    const final = eng.saves[eng.saves.length - 1];
    ok(final.materials.some((m) => m.id === 'n1') && final.theses[0].abstractKo === '초록' && final.events.length === 2, '마지막 서버 저장에 모든 변경과 이력 포함');
    const n = eng.saves.length;
    await tick();
    eq(eng.saves.length, n, '추가 저장 없음');
  }

  // 5. 10분 안 저장은 하나로, 10분 뒤는 새 이력
  {
    const eng = new FakeEngine();
    const h = new Harness(eng);
    h.change(addMat('n1', 'P1'));
    await tick();
    h.clock = '2026-01-01T09:05:00.000Z';
    h.change(addMat('n2', 'P1'));
    await tick();
    eq(h.saveEvents().map((e) => [e.at, e.text]), [['2026-01-01T09:05:00.000Z', '저장 — 자료 추가 2건']], '10분 안 두 번 저장 → 이력 1건으로 묶임');
    h.clock = '2026-01-01T09:16:00.000Z';
    h.change(addMat('n3', 'P1'));
    await tick();
    eq(h.saveEvents().length, 2, '10분 뒤 저장 → 새 이력');
    ok(h.saved === h.edits && !h.error, '모든 변경 저장 완료');
  }
}

async function templateTests() {
  console.log('\n[11] 양식 HWPX 분석 (가상 파일: 정상·오류·악성 입력)');
  const enc = new TextEncoder();
  const deflate = async (data: Uint8Array) => {
    const s = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  };
  type Ent = { name: string; data: Uint8Array; deflate?: boolean; size?: number; flags?: number };
  /** 시험용 ZIP 작성기: 크기·플래그를 일부러 틀리게 넣을 수 있다 */
  const zip = async (ents: Ent[]) => {
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const e of ents) {
      const body = e.deflate ? await deflate(e.data) : e.data;
      const name = enc.encode(e.name);
      const size = e.size ?? e.data.length;
      const lh = new Uint8Array(30 + name.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(6, e.flags ?? 0, true); dv.setUint16(8, e.deflate ? 8 : 0, true);
      dv.setUint32(18, body.length, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(8, e.flags ?? 0, true); cv.setUint16(10, e.deflate ? 8 : 0, true);
      cv.setUint32(20, body.length, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
      locals.push(lh, body); centrals.push(ch);
      offset += lh.length + body.length;
    }
    const cdSize = centrals.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, ents.length, true); ev.setUint16(10, ents.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, end];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const rejects = async (name: string, bytes: Uint8Array, pattern: RegExp, msg: string) => {
    try { await analyzeTemplate(name, bytes); ok(false, msg, '오류가 나지 않음'); }
    catch (e) { ok(e instanceof TemplateError && pattern.test(e.message), msg, e instanceof Error ? e.message : String(e)); }
  };

  // 정상: 이 앱이 만든 학위논문 HWPX(한글에서 열리는 형식)를 양식으로 사용
  const thesis = buildThesisHwpx({ ...(sampleThesis as unknown as ThesisDoc), docType: '학위논문' }, new Date('2026-01-15T12:00:00Z'));
  const a = await analyzeTemplate('학위논문 양식.hwpx', thesis);
  eq(a.mapping.map((m) => [m.role, m.style?.engName ?? null]), [['chapter', 'Outline 1'], ['section', 'Outline 2'], ['subsection', 'Outline 3'], ['body', 'Body'], ['reference', null], ['footnote', 'Footnote']], '스타일 자동 연결 (참고문헌 스타일이 없으면 내장 서식 대체)');
  eq([a.page?.widthMm, a.page?.heightMm, a.page?.margins.left, a.page?.margins.right], [190, 260, 30, 20], '쪽 설정 읽기 (19×26cm, 좌 30·우 20mm)');
  eq(a.footnote, { numberType: 'DIGIT', suffix: ')' }, '각주 번호 설정 읽기');
  ok(a.counts.styles > 10 && a.counts.charPr > 0 && a.counts.paraPr > 0 && a.styles.every((s) => s.refsOk), '스타일·글자·문단 모양 수와 참조 확인');

  // 정상: 압축(deflate)된 HWPX도 같은 결과
  const files = new Map<string, Uint8Array>();
  const { header, section } = thesisXml({ ...(sampleThesis as unknown as ThesisDoc), docType: '학술지논문' });
  files.set('mimetype', enc.encode('application/hwp+zip'));
  const deflated = await zip([{ name: 'mimetype', data: files.get('mimetype')! }, { name: 'Contents/header.xml', data: enc.encode(header), deflate: true }, { name: 'Contents/section0.xml', data: enc.encode(section), deflate: true }]);
  const b = await analyzeTemplate('학술지 양식.hwpx', deflated);
  eq([b.page?.widthMm, b.page?.heightMm, b.mapping.filter((m) => m.style).length], [210, 297, 5], '압축된 양식도 읽기 (A4, 연결 5개)');

  // 이름이 한글뿐인 양식 + 참고문헌 스타일 있음 + 참조가 틀린 스타일
  const hdr = (styles: string) => `<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="x"><hh:fontfaces><hh:fontface lang="HANGUL"/></hh:fontfaces><hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000"/></hh:charProperties><hh:paraProperties itemCnt="2"><hh:paraPr id="0"/><hh:paraPr id="1"/></hh:paraProperties><hh:styles>${styles}</hh:styles></hh:head>`;
  const sec = '<hs:sec xmlns:hs="x"><hp:secPr><hp:pagePr landscape="WIDELY" width="59528" height="84186"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" suffixChar=")"/></hp:footNotePr></hp:secPr></hs:sec>';
  const ko = await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode(hdr('<hh:style id="0" type="PARA" name="바탕글" paraPrIDRef="0" charPrIDRef="0"/><hh:style id="1" type="PARA" name="참고문헌" paraPrIDRef="1" charPrIDRef="0"/><hh:style id="2" type="PARA" name="개요 1" paraPrIDRef="9" charPrIDRef="0"/><hh:style id="3" type="PARA" name="R&amp;D 주석" paraPrIDRef="0" charPrIDRef="0"/>')) }, { name: 'Contents/section0.xml', data: enc.encode(sec) }]);
  const c = await analyzeTemplate('ko.hwpx', ko);
  eq(c.mapping.map((m) => [m.role, m.style?.name ?? null]), [['chapter', null], ['section', null], ['subsection', null], ['body', '바탕글'], ['reference', '참고문헌'], ['footnote', null]], '한글 이름 연결, 참조가 틀린 스타일은 연결하지 않음');
  ok(c.warnings.some((w) => w.includes('개요 1')) && c.styles.some((s) => s.name === 'R&D 주석'), '참조 오류 경고, XML 엔티티는 글자로 해석');
  eq([c.page?.widthMm, c.page?.heightMm], [210, 297], '쪽 크기 HWPUNIT → mm 변환');

  // 오류·악성 입력
  await rejects('양식.docx', thesis, /\.hwpx 파일만/, '.hwpx가 아닌 확장자 거부');
  await rejects('큰.hwpx', new Uint8Array(TEMPLATE_LIMITS.fileBytes + 1), /5MB/, '5MB 초과 거부');
  await rejects('가짜.hwpx', enc.encode('이건 ZIP이 아닙니다'.repeat(10)), /ZIP/, 'ZIP이 아닌 파일 거부');
  await rejects('m.hwpx', await zip([{ name: 'Contents/header.xml', data: enc.encode(header) }]), /mimetype/, 'mimetype 없음 거부');
  await rejects('m2.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/zip') }]), /mimetype 불일치/, 'HWPX가 아닌 mimetype 거부');
  await rejects('h.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }]), /header\.xml/, 'header.xml 없음 거부');
  await rejects('t.hwpx', await zip([{ name: '../evil.xml', data: enc.encode('x') }]), /경로/, '상위 폴더 경로(../) 항목 거부');
  await rejects('e.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip'), flags: 1 }]), /암호화/, '암호화 항목 거부');
  await rejects('d.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><hh:head>&a;</hh:head>') }]), /DOCTYPE|ENTITY/, 'DOCTYPE·ENTITY(엔티티 폭탄·외부 엔티티) 거부');
  await rejects('r.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode('<hh:head/>'), size: 5_000_000 }]), /압축률|크기/, '선언 크기 대비 비정상 압축률 거부');
  await rejects('b.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: new Uint8Array(TEMPLATE_LIMITS.xmlBytes + 1024), deflate: true, size: 50_000 }]), /압축을 푼 크기|실제 크기/, '선언보다 크게 풀리는 압축 폭탄 거부');
  await rejects('s.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode('<hh:head/>'), size: 3 }]), /실제 크기/, '선언 크기와 실제 크기 불일치 거부');
  await rejects('n.hwpx', await zip(Array.from({ length: TEMPLATE_LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.txt`, data: enc.encode('x') }))), /항목이 너무 많/, '항목 수 초과 거부');
  await rejects('u.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: new Uint8Array([0x3c, 0xff, 0xfe, 0x3e]) }]), /UTF-8/, '잘못된 UTF-8 거부');
  await rejects('x.hwpx', await zip([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode('<html>hello</html>') }]), /HWPX 형식/, 'HWPX 머리말이 아닌 XML 거부');
}

async function templateOutputTests() {
  console.log('\n[12] 양식 스타일·쪽 설정을 HWPX 출력에 적용 (가상 양식)');
  const enc = new TextEncoder();
  const tplHeader = (opts: { footnote: boolean; borderFill?: boolean }) =>
    '<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1"><hh:refList>' +
    '<hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces>' +
    (opts.borderFill === false ? '' : '<hh:borderFills itemCnt="1"><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"/></hh:borderFills>') +
    '<hh:charProperties itemCnt="3"><hh:charPr id="0" height="1000" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr><hh:charPr id="5" height="1400" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr><hh:charPr id="9" height="900" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties>' +
    '<hh:paraProperties itemCnt="3"><hh:paraPr id="0" tabPrIDRef="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/></hh:paraPr><hh:paraPr id="7" tabPrIDRef="0"><hh:align horizontal="CENTER" vertical="BASELINE"/></hh:paraPr><hh:paraPr id="12" tabPrIDRef="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/></hh:paraPr></hh:paraProperties>' +
    '<hh:styles itemCnt="4"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>' +
    '<hh:style id="3" type="PARA" name="개요 1" engName="Outline 1" paraPrIDRef="7" charPrIDRef="5" nextStyleIDRef="0" langID="1042" lockForm="0"/>' +
    (opts.footnote ? '<hh:style id="8" type="PARA" name="각주" engName="Footnote" paraPrIDRef="12" charPrIDRef="9" nextStyleIDRef="8" langID="1042" lockForm="0"/>' : '') +
    '<hh:style id="9" type="PARA" name="참고문헌" engName="" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="9" langID="1042" lockForm="0"/></hh:styles></hh:refList></hh:head>';
  // 한국외대 서식 안내 파일과 같은 150×220mm, 좌우 20·위 20·아래 15mm
  const tplSection = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="x" xmlns:hp="y"><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr id="" outlineShapeIDRef="0" memoShapeIDRef="0" masterPageCnt="0"><hp:pagePr landscape="WIDELY" width="42520" height="62362" gutterType="LEFT_ONLY"><hp:margin header="0" footer="2835" gutter="0" left="5669" right="5669" top="5669" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" suffixChar=")"/></hp:footNotePr></hp:secPr></hp:run></hp:p></hs:sec>';
  const asFile = (header: string) => zipStore([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode(header) }, { name: 'Contents/section0.xml', data: enc.encode(tplSection) }]);
  const doc: ThesisDoc = {
    ...(sampleThesis as unknown as ThesisDoc),
    docType: '학위논문',
    chapters: [
      { title: 'Ⅰ. 서론', text: '첫 문장이다.[^1]\n## 1. 배경\n본문 둘째 문단.\n[^1]: 첫 각주' },
      { title: 'Ⅱ. 본론', text: '다음 장.[^1]\n[^1]: 둘째 각주' },
    ],
  };
  const ids = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, 'g'))].map((m) => m[1]);
  const refs = (xml: string, attr: string) => [...new Set([...xml.matchAll(new RegExp(`${attr}="(\\d+)"`, 'g'))].map((m) => m[1]))];
  const paraOf = (section: string, text: string) => section.match(new RegExp(`<hp:p id="\\d+" paraPrIDRef="(\\d+)" styleIDRef="(\\d+)"[^>]*><hp:run charPrIDRef="(\\d+)"><hp:t>${text}`))?.slice(1);

  // 1) 스타일만 적용, 쪽 설정은 기존 유지 (기본값)
  const a = await analyzeTemplate('양식.hwpx', asFile(tplHeader({ footnote: true })));
  ok(a.styleApply.ok, '(준비) 가상 양식은 스타일 적용 가능');
  const t1 = toHwpxTemplate(a, { styles: true, page: false })!;
  const x1 = thesisXml(doc, t1);
  const charIds = ids(x1.header, 'charPr');
  const paraIds = ids(x1.header, 'paraPr');
  eq([new Set(charIds).size === charIds.length, new Set(paraIds).size === paraIds.length], [true, true], '덧붙인 글자·문단 모양 id가 양식 id와 겹치지 않음');
  eq([Math.min(...charIds.slice(3).map(Number)), Math.min(...paraIds.slice(3).map(Number))], [10, 13], '새 id는 양식 id 최댓값 다음부터 (불연속 id 대응)');
  eq([x1.header.match(/<hh:charProperties itemCnt="(\d+)"/)?.[1], x1.header.match(/<hh:paraProperties itemCnt="(\d+)"/)?.[1]], [String(charIds.length), String(paraIds.length)], 'itemCnt가 실제 개수와 일치');
  ok(refs(x1.section, 'charPrIDRef').every((r) => charIds.includes(r)) && refs(x1.section, 'paraPrIDRef').every((r) => paraIds.includes(r)), '본문의 모든 글자·문단 모양 참조가 header에 있음');
  ok(refs(x1.section, 'styleIDRef').every((r) => r === '0' || ids(x1.header.replace(/<hh:style /g, '<hh:style- '), 'style-').includes(r) || ['3', '8', '9'].includes(r)), '본문의 스타일 참조가 양식에 있는 스타일');
  const chapterParas = [...x1.section.matchAll(/<hp:p id="\d+" paraPrIDRef="(\d+)" styleIDRef="(\d+)"[^>]*><hp:run charPrIDRef="(\d+)"><hp:t>Ⅰ\. 서론/g)].map((m) => m.slice(1));
  eq(chapterParas, [[paraOf(x1.section, 'Ⅰ. 서론')![0], '0', paraOf(x1.section, 'Ⅰ. 서론')![2]], ['7', '3', '5']], '목차의 장 제목은 내장 서식, 본문 장 제목 → 양식 "개요 1" 스타일');
  eq(paraOf(x1.section, '본문 둘째 문단'), ['0', '0', '0'], '본문 → 양식 "바탕글" 스타일');
  ok(x1.section.includes('paraPrIDRef="12" styleIDRef="8" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="9"><hp:ctrl><hp:autoNum num="1"'), '각주 → 양식 "각주" 스타일');
  const cover = paraOf(x1.section, '한국외국어대학교 대학원');
  ok(!!cover && cover[1] === '0' && paraIds.slice(3).includes(cover[0]) && charIds.slice(3).includes(cover[2]), '표지 문단은 내장 서식 유지');
  eq(paraOf(x1.section, '1. 배경')?.[1], '0', '연결되지 않은 역할(절 제목)은 내장 서식');
  ok(x1.section.includes('outlineShapeIDRef="0"'), '양식에 개요 번호가 없으면 구역 설정이 없는 id를 가리키지 않음');
  ok(x1.section.includes('width="53858" height="73701"'), '쪽 설정을 고르지 않으면 기존 19×26cm 유지');
  eq((x1.section.match(/<hp:footNote /g) ?? []).length, 2, '각주 2개 유지');
  eq([(x1.section.match(/<hp:p /g) ?? []).length, (x1.section.match(/<\/hp:p>/g) ?? []).length].reduce((p, c) => p - c), 0, '문단 태그 짝이 맞음');
  ok(x1.ps.map((p) => p.text).join('|') === thesisXml(doc).ps.map((p) => p.text).join('|'), '본문·표지·참고문헌 내용은 양식 유무와 무관하게 같음');

  // 2) 쪽 설정도 적용 (사용자가 고른 경우)
  const x2 = thesisXml(doc, toHwpxTemplate(a, { styles: true, page: true }));
  ok(x2.section.includes('<hp:pagePr landscape="WIDELY" width="42520" height="62362" gutterType="LEFT_ONLY"><hp:margin header="0" footer="2835" gutter="0" left="5669" right="5669" top="5669" bottom="4252"/>'), '쪽 설정을 고르면 양식 용지·여백(150×220mm) 적용');
  const x3 = thesisXml(doc, toHwpxTemplate(a, { styles: false, page: true }));
  ok(x3.section.includes('width="42520"') && x3.header === thesisXml(doc).header, '쪽 설정만 고르면 기존 서식(header) 그대로');

  // 3) 양식에 각주 스타일이 없으면 각주 모양을 덧붙여 사용
  const b = await analyzeTemplate('각주없음.hwpx', asFile(tplHeader({ footnote: false })));
  const x4 = thesisXml(doc, toHwpxTemplate(b, { styles: true, page: false }));
  const m4 = x4.section.match(/<hp:subList [^>]*><hp:p id="0" paraPrIDRef="(\d+)" styleIDRef="0" [^>]*><hp:run charPrIDRef="(\d+)">/);
  ok(!!m4 && ids(x4.header, 'paraPr').includes(m4[1]) && ids(x4.header, 'charPr').includes(m4[2]) && x4.header.includes(`<hh:charPr id="${m4![2]}" height="900"`), '각주 스타일이 없으면 덧붙인 9pt 각주 모양 사용');

  // 4) 적용할 수 없는 양식·아무것도 고르지 않음 → 기존 출력과 바이트 동일
  const c = await analyzeTemplate('불완전.hwpx', asFile(tplHeader({ footnote: true, borderFill: false })));
  eq([c.styleApply.ok, toHwpxTemplate(c, { styles: true, page: false })], [false, undefined], '필수 요소가 없는 양식은 스타일 적용 안 함');
  const when = new Date('2026-01-15T12:00:00Z');
  const same = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((v, i) => v === y[i]);
  ok(same(buildThesisHwpx(doc, when, toHwpxTemplate(a, { styles: false, page: false })), buildThesisHwpx(doc, when)), '양식을 골라도 적용 항목이 없으면 기존 출력과 바이트 동일');
}

async function coverFitTests() {
  console.log('\n[13] 양식 적용 시 겉표지·속표지 쪽 넘침 방지 (190×260mm 규격 기준 추정)');
  const enc = new TextEncoder();
  // 실제 공식 양식처럼 글꼴이 다른 양식 (각주·참고문헌 스타일 없음)
  const header = '<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="h" version="1.4" secCnt="1"><hh:refList>' +
    '<hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="한양신명조" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces>' +
    '<hh:borderFills itemCnt="1"><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"/></hh:borderFills>' +
    '<hh:charProperties itemCnt="1"><hh:charPr id="0" height="900" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties>' +
    '<hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0"><hh:align horizontal="CENTER" vertical="BASELINE"/></hh:paraPr></hh:paraProperties>' +
    '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles></hh:refList></hh:head>';
  const section = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="x" xmlns:hp="y"><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr id=""><hp:pagePr landscape="WIDELY" width="42520" height="62362" gutterType="LEFT_ONLY"><hp:margin header="0" footer="2835" gutter="0" left="5669" right="5669" top="5669" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" suffixChar=")"/></hp:footNotePr></hp:secPr></hp:run></hp:p></hs:sec>';
  const a = await analyzeTemplate('양식.hwpx', zipStore([{ name: 'mimetype', data: enc.encode('application/hwp+zip') }, { name: 'Contents/header.xml', data: enc.encode(header) }, { name: 'Contents/section0.xml', data: enc.encode(section) }]));
  const tpl = toHwpxTemplate(a, { styles: true, page: false });

  /** 쪽별 세로 길이 추정 (mm): 줄 간격 160%, 한글·한자 1em·그 밖 0.5em, 양식 글꼴은 10% 넓게, 본문 폭 140mm */
  const pages = (x: { header: string; section: string }, widthFactor: number) => {
    const size = new Map([...x.header.matchAll(/<hh:charPr id="(\d+)" height="(\d+)"/g)].map((m) => [m[1], Number(m[2]) / 100]));
    const ps = [...x.section.matchAll(/<hp:p id="\d+" paraPrIDRef="\d+" styleIDRef="\d+" pageBreak="(\d)"[^>]*><hp:run charPrIDRef="(\d+)">(?:<hp:t>([^<]*)<\/hp:t>|<hp:t\/>)/g)];
    const out: number[] = [];
    for (const [, pb, c, t] of ps) {
      if (pb === '1' || !out.length) out.push(0);
      const pt = size.get(c) ?? 10;
      const em = [...(t ?? '')].reduce((n, ch) => n + (/[가-힣㐀-鿿]/.test(ch) ? 1 : 0.5), 0);
      const lines = Math.max(1, Math.ceil((em * pt * 0.3528 * widthFactor) / 140));
      out[out.length - 1] += lines * pt * 1.6 * 0.3528;
    }
    return out;
  };
  const BODY = 260 - 35 - 30; // 190×260mm 규격: 위 30+머리말 5, 아래 15+꼬리말 15
  const base = { ...(sampleThesis as unknown as ThesisDoc), docType: '학위논문' as const };
  const long = { ...base, titleKo: '생성형 인공지능을 활용한 한중 문화콘텐츠 기반 모션그래픽 교육 프로그램의 설계와 효과에 관한 실증적 연구', subtitle: '중국 드라마 속 언어와 문화 요소를 중심으로 한 대학 중국어 교육 현장 적용과 학습자 인식 분석' };
  eq([long.titleKo.length >= 55, long.subtitle.length >= 45], [true, true], '(준비) 긴 제목·부제목');

  const plain = pages(thesisXml(base), 1);
  // 참고: 양식이 없을 때의 기존 출력은 바꾸지 않는다 (바이트 동일 유지). 추정치만 기록한다.
  console.log(`        참고: 기존 출력(양식 없음) 겉표지 추정 ${plain[0].toFixed(1)}mm / 규격 ${BODY}mm`);
  for (const [label, doc] of [['예시 제목', base], ['긴 제목·부제목', long]] as const) {
    const p = pages(thesisXml(doc, tpl), 1.1);
    ok(p[0] <= BODY - 8 && p[1] <= BODY - 8, `양식 적용 ${label}: 겉표지 ${p[0].toFixed(1)}mm·속표지 ${p[1].toFixed(1)}mm가 ${BODY}mm 안에 한 줄 이상 여유`);
  }

  const x = thesisXml(long, tpl);
  const gapId = x.header.match(/<hh:charPr id="(\d+)" height="800"/g)?.slice(-1)[0]?.match(/id="(\d+)"/)?.[1];
  const firstTwo = x.section.split('pageBreak="1"').slice(0, 2).join('');
  const gapParas = [...firstTwo.matchAll(new RegExp(`<hp:run charPrIDRef="${gapId}">(<hp:t\\/>|<hp:t>[^<]*</hp:t>)`, 'g'))];
  eq([gapParas.length, gapParas.every((m) => m[1] === '<hp:t/>')], [34, true], '겉표지·속표지의 빈 줄 34개만 8pt로 (글자가 있는 줄은 그대로)');
  ok(x.section.includes(`<hp:t>${long.titleKo}</hp:t>`) && x.section.includes(`<hp:t>-${long.subtitle}-</hp:t>`), '제목·부제목 그대로');
  eq((x.section.match(new RegExp(`charPrIDRef="${gapId}"`, 'g')) ?? []).length, 34, '심사청구서·인정서·본문·참고문헌의 줄에는 적용하지 않음');
  eq(thesisXml(long, tpl).ps.map((p) => p.text), thesisXml(long).ps.map((p) => p.text), '쪽 순서와 내용은 양식 유무와 같음');

  const j = thesisXml({ ...long, docType: '학술지논문' }, tpl);
  const count = (h: string) => (h.match(/<hh:charPr /g) ?? []).length;
  eq(count(j.header), count(x.header) - 1, '학술지 출력에는 표지 빈 줄용 글자 모양을 추가하지 않음');
  const when = new Date('2026-01-15T12:00:00Z');
  const same = (u: Uint8Array, v: Uint8Array) => u.length === v.length && u.every((b, i) => b === v[i]);
  ok(same(buildThesisHwpx(long, when), buildThesisHwpx(long, when, undefined)), '양식 미선택 출력은 변화 없음');
}

(async () => {
  await storageTests();
  await backupTests();
  await planTests();
  await markdownTests();
  citationTests();
  recoveryAckTests();
  citeCheckTests();
  await footnoteTests();
  saveHistoryTests();
  await saveLoopTests();
  await templateTests();
  await templateOutputTests();
  await coverFitTests();
  console.log(`\n${failed ? '실패' : '모두 통과'}: ${passed}건 통과, ${failed}건 실패`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
