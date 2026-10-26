/**
 * 한국외국어대학교 학위논문 서식 HWPX 생성 (브라우저·Node 공통, 외부 라이브러리 없음)
 *
 * 서식 근거: 한국외대 대학원 학위논문 작성 서식(thesis_korean_.hwp, 서식 1~12)
 *  - 지면(서식 5): 19 × 26 cm, 좌 3 cm · 우 2 cm(본문 폭 14 cm), 위 3.5 cm · 아래 3 cm, 쪽 번호 아래 가운데
 *  - 겉표지(1) · 속표지(2): ○○학위논문 / 논문 제목 / -부제목- / 한국외국어대학교 대학원 / ○○학과 / 성명
 *  - 심사청구서(3): 지도 ○○○ 교수 / 이 논문을 ○○학위청구논문으로 제출합니다.
 *  - 인정서(4): 이 논문을 ○○○의 ○○학위 논문으로 인정함. / 심사위원 (인) — 석사 3인, 박사 5인
 *  - 논문초록(7): ABSTRACT, 영문 제목, 성명·소속(Department of …, Graduate School, Hankuk University of Foreign Studies)
 *
 * 한글(한컴오피스)이 만든 빈 문서의 header.xml을 바탕으로 글자·문단 모양을 추가하고 본문(section0.xml)을 만든다.
 * 줄 배치 정보(linesegarray)는 넣지 않아 한글이 열 때 다시 계산한다.
 */
import { COL_PR, HEADER_XML, SECTION_OPEN, SEC_PR, SKELETON_FILES } from './hwpx-skeleton';

export interface ThesisDoc {
  degree: '석사' | '박사';
  titleKo: string;
  subtitle?: string;
  titleEn?: string;
  department: string; // 'OO학과'
  departmentEn?: string;
  student: string;
  studentEn?: string;
  advisor: string;
  year: string;
  month: string;
  abstractKo?: string;
  keywordsKo?: string[];
  abstractEn?: string;
  keywordsEn?: string;
  chapters: { title: string; text: string }[];
  references: string[];
}

/* ───────── 단위 ───────── */

const mm = (v: number) => Math.round((v * 7200) / 25.4); // HWPUNIT = 1/7200 inch
const pt = (v: number) => Math.round(v * 100); // 글자 크기

/* ───────── 글자·문단 모양 (header.xml에 덧붙임) ───────── */

type CharKey = 'body' | 'bold' | 'title' | 'sub' | 'chapter' | 'section' | 'info' | 'small';
const CHARS: Record<CharKey, { size: number; bold?: boolean }> = {
  body: { size: 11 },
  bold: { size: 11, bold: true },
  title: { size: 22, bold: true },
  sub: { size: 15 },
  chapter: { size: 16, bold: true },
  section: { size: 13, bold: true },
  info: { size: 14 },
  small: { size: 10 },
};

type ParaKey = 'body' | 'center' | 'chapter' | 'section' | 'left' | 'ref' | 'right';
interface ParaSpec {
  align: 'JUSTIFY' | 'CENTER' | 'LEFT' | 'RIGHT';
  intent?: number;
  left?: number;
  prev?: number;
  next?: number;
  line?: number;
  keepWithNext?: boolean;
}
const PARAS: Record<ParaKey, ParaSpec> = {
  body: { align: 'JUSTIFY', intent: pt(11) * 2, line: 180 }, // 첫 줄 두 글자 들여쓰기, 줄 간격 180%
  center: { align: 'CENTER', line: 160 },
  chapter: { align: 'CENTER', prev: 1200, next: 1600, line: 160, keepWithNext: true },
  section: { align: 'LEFT', prev: 1000, next: 500, line: 160, keepWithNext: true },
  left: { align: 'LEFT', line: 180 },
  ref: { align: 'JUSTIFY', intent: -pt(11) * 3, left: 0, next: 300, line: 160 }, // 내어쓰기
  right: { align: 'RIGHT', line: 160 },
};

function buildHeader(): { xml: string; char: Record<CharKey, number>; para: Record<ParaKey, number> } {
  let xml = HEADER_XML;
  const charBase = xml.match(/<hh:charPr id="0"[\s\S]*?<\/hh:charPr>/)![0];
  const paraBase = xml.match(/<hh:paraPr id="0"[\s\S]*?<\/hh:paraPr>/)![0];
  const charCnt = Number(xml.match(/<hh:charProperties itemCnt="(\d+)"/)![1]);
  const paraCnt = Number(xml.match(/<hh:paraProperties itemCnt="(\d+)"/)![1]);

  const char = {} as Record<CharKey, number>;
  const charXml = (Object.keys(CHARS) as CharKey[]).map((k, i) => {
    const id = charCnt + i;
    char[k] = id;
    let c = charBase.replace('id="0"', `id="${id}"`).replace(/height="\d+"/, `height="${pt(CHARS[k].size)}"`);
    if (CHARS[k].bold) c = c.replace(/(<hh:offset [^>]*\/>)/, '$1<hh:bold/>');
    return c;
  });

  const para = {} as Record<ParaKey, number>;
  const paraXml = (Object.keys(PARAS) as ParaKey[]).map((k, i) => {
    const id = paraCnt + i;
    para[k] = id;
    const s = PARAS[k];
    return paraBase
      .replace('id="0"', `id="${id}"`)
      .replace(/<hh:align horizontal="[A-Z]+"/, `<hh:align horizontal="${s.align}"`)
      .replace(/keepWithNext="\d"/, `keepWithNext="${s.keepWithNext ? 1 : 0}"`)
      .replace(/<hc:intent value="-?\d+"/g, `<hc:intent value="${s.intent ?? 0}"`)
      .replace(/<hc:left value="-?\d+"/g, `<hc:left value="${s.left ?? 0}"`)
      .replace(/<hc:prev value="-?\d+"/g, `<hc:prev value="${s.prev ?? 0}"`)
      .replace(/<hc:next value="-?\d+"/g, `<hc:next value="${s.next ?? 0}"`)
      .replace(/<hh:lineSpacing type="PERCENT" value="\d+"/g, `<hh:lineSpacing type="PERCENT" value="${s.line ?? 160}"`);
  });

  xml = xml
    .replace(/<hh:charProperties itemCnt="\d+">/, `<hh:charProperties itemCnt="${charCnt + charXml.length}">`)
    .replace('</hh:charProperties>', `${charXml.join('')}</hh:charProperties>`)
    .replace(/<hh:paraProperties itemCnt="\d+">/, `<hh:paraProperties itemCnt="${paraCnt + paraXml.length}">`)
    .replace('</hh:paraProperties>', `${paraXml.join('')}</hh:paraProperties>`);
  return { xml, char, para };
}

/* ───────── 본문 ───────── */

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface Para {
  text: string;
  char: CharKey;
  para: ParaKey;
  pageBreak?: boolean;
}

/** 표지용 글자 사이 띄우기: '홍길동' → '홍   길   동' */
const spaced = (s: string, gap = '   ') => (/^[가-힣]{2,4}$/.test(s.trim()) ? [...s.trim()].join(gap) : s);

function front(d: ThesisDoc): Para[] {
  const deg = `${d.degree}학위논문`;
  const blank = (n: number, ch: CharKey = 'info'): Para[] => Array.from({ length: n }, () => ({ text: '', char: ch, para: 'center' }));
  const dept = d.department || '○○학과';
  const name = d.student || '홍길동';
  const cover = (pageBreak: boolean): Para[] => [
    { text: '', char: 'info', para: 'center', pageBreak },
    ...blank(2),
    { text: deg, char: 'info', para: 'center' },
    ...blank(3),
    { text: d.titleKo, char: 'title', para: 'center' },
    ...(d.subtitle ? [{ text: `-${d.subtitle.replace(/^-+|-+$/g, '')}-`, char: 'sub' as CharKey, para: 'center' as ParaKey }] : []),
    ...blank(9),
    { text: '한국외국어대학교 대학원', char: 'info', para: 'center' },
    ...blank(1),
    { text: spaced(dept.replace(/학과$/, ''), '  ') + (dept.endsWith('학과') ? '  학  과' : ''), char: 'info', para: 'center' },
    ...blank(1),
    { text: spaced(name, '     '), char: 'info', para: 'center' },
  ];
  const date = `${d.year} 년   ${d.month} 월     일`;
  const out: Para[] = [
    ...cover(false), // 겉표지
    ...cover(true), // 속표지
    // 심사청구서 (서식 3)
    { text: '', char: 'info', para: 'center', pageBreak: true },
    ...blank(1),
    { text: deg, char: 'info', para: 'center' },
    ...blank(2),
    { text: d.titleKo, char: 'title', para: 'center' },
    ...(d.subtitle ? [{ text: `-${d.subtitle.replace(/^-+|-+$/g, '')}-`, char: 'sub' as CharKey, para: 'center' as ParaKey }] : []),
    ...(d.titleEn ? [...blank(1, 'sub'), { text: d.titleEn, char: 'sub' as CharKey, para: 'center' as ParaKey }] : []),
    ...blank(3),
    { text: `지도  ${spaced(d.advisor || '○○○', '  ')}  교수`, char: 'info', para: 'center' },
    ...blank(2),
    { text: `이 논문을 ${deg.replace('논문', '')}청구논문으로 제출합니다.`, char: 'info', para: 'center' },
    ...blank(2),
    { text: date, char: 'info', para: 'center' },
    ...blank(2),
    { text: '한국외국어대학교 대학원', char: 'info', para: 'center' },
    { text: dept, char: 'info', para: 'center' },
    { text: spaced(name, '     '), char: 'info', para: 'center' },
    // 인정서 (서식 4)
    { text: '', char: 'info', para: 'center', pageBreak: true },
    ...blank(3),
    { text: `이 논문을 ${name}의 ${deg.replace('논문', '')} 논문으로 인정함.`, char: 'info', para: 'center' },
    ...blank(3),
    { text: date, char: 'info', para: 'center' },
    ...blank(3),
    ...Array.from({ length: d.degree === '박사' ? 5 : 3 }, (): Para => ({ text: '심사위원  ________________________  (인)', char: 'info', para: 'center' })).flatMap((p) => [p, ...blank(1)]),
    ...blank(2),
    { text: '한국외국어대학교 대학원', char: 'info', para: 'center' },
  ];
  return out;
}

/** 본문 텍스트 → 문단: '## ' 절 제목, '### ' 항 제목, 빈 줄은 무시 */
function bodyParas(text: string): Para[] {
  const out: Para[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) out.push({ text: line.slice(4).trim(), char: 'bold', para: 'left' });
    else if (line.startsWith('## ')) out.push({ text: line.slice(3).trim(), char: 'section', para: 'section' });
    else if (line.startsWith('# ')) out.push({ text: line.slice(2).trim(), char: 'chapter', para: 'chapter' });
    else out.push({ text: line.replace(/\*\*(.+?)\*\*/g, '$1'), char: 'body', para: 'body' });
  }
  return out;
}

/** 목차·본문 장 제목 등에서 쓸 '## 1. 제목' 형식 절 제목 목록 */
export const sectionsOf = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((l) => /^##\s+/.test(l.trim()) && !/^###/.test(l.trim()))
    .map((l) => l.trim().replace(/^##\s+/, ''));

export function thesisParagraphs(d: ThesisDoc): Para[] {
  const ps: Para[] = front(d);
  if (d.abstractKo?.trim()) {
    ps.push({ text: '국 문 초 록', char: 'chapter', para: 'chapter', pageBreak: true });
    ps.push({ text: d.titleKo, char: 'section', para: 'center' }, { text: '', char: 'body', para: 'center' });
    ps.push(...bodyParas(d.abstractKo));
    if (d.keywordsKo?.length) ps.push({ text: '', char: 'body', para: 'left' }, { text: `주제어: ${d.keywordsKo.join(', ')}`, char: 'bold', para: 'left' });
  }
  // 목차
  ps.push({ text: '목    차', char: 'chapter', para: 'chapter', pageBreak: true });
  for (const c of d.chapters) {
    ps.push({ text: c.title, char: 'bold', para: 'left' });
    for (const s of sectionsOf(c.text)) ps.push({ text: `    ${s}`, char: 'body', para: 'left' });
  }
  ps.push({ text: '참고문헌', char: 'bold', para: 'left' });
  if (d.abstractEn?.trim()) ps.push({ text: 'ABSTRACT', char: 'bold', para: 'left' });
  // 본문
  for (const c of d.chapters) {
    ps.push({ text: c.title, char: 'chapter', para: 'chapter', pageBreak: true });
    ps.push(...bodyParas(c.text));
  }
  // 참고문헌
  ps.push({ text: '참 고 문 헌', char: 'chapter', para: 'chapter', pageBreak: true });
  for (const r of d.references) ps.push({ text: r, char: 'body', para: 'ref' });
  // ABSTRACT (서식 7)
  if (d.abstractEn?.trim()) {
    ps.push({ text: 'ABSTRACT', char: 'chapter', para: 'chapter', pageBreak: true });
    ps.push({ text: d.titleEn || d.titleKo, char: 'section', para: 'center' }, { text: '', char: 'body', para: 'center' });
    ps.push({ text: d.studentEn || d.student, char: 'body', para: 'right' });
    ps.push({ text: `Department of ${d.departmentEn || d.department}`, char: 'body', para: 'right' });
    ps.push({ text: 'Graduate School', char: 'body', para: 'right' });
    ps.push({ text: 'Hankuk University of Foreign Studies', char: 'body', para: 'right' });
    ps.push({ text: '', char: 'body', para: 'left' });
    ps.push(...bodyParas(d.abstractEn));
    if (d.keywordsEn?.trim()) ps.push({ text: '', char: 'body', para: 'left' }, { text: `Keywords: ${d.keywordsEn}`, char: 'bold', para: 'left' });
  }
  return ps;
}

function buildSection(ps: Para[], char: Record<CharKey, number>, para: Record<ParaKey, number>): string {
  // 지면: 19 × 26 cm, 좌 30 · 우 20 mm, 위 30 + 머리말 5 mm, 아래 15 + 꼬리말 15 mm
  const secPr = SEC_PR.replace(
    /<hp:pagePr [^>]*>\s*<hp:margin [^>]*\/>/,
    `<hp:pagePr landscape="WIDELY" width="${mm(190)}" height="${mm(260)}" gutterType="LEFT_ONLY"><hp:margin header="${mm(5)}" footer="${mm(15)}" gutter="0" left="${mm(30)}" right="${mm(20)}" top="${mm(30)}" bottom="${mm(15)}"/>`,
  );
  const pageNum = '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>';
  const first = `<hp:p id="0" paraPrIDRef="${para.center}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${char.info}">${secPr}${COL_PR}${pageNum}</hp:run><hp:run charPrIDRef="${char.info}"><hp:t/></hp:run></hp:p>`;
  const body = ps
    .map(
      (p, i) =>
        `<hp:p id="${i + 1}" paraPrIDRef="${para[p.para]}" styleIDRef="0" pageBreak="${p.pageBreak ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="${char[p.char]}">${p.text ? `<hp:t>${esc(p.text)}</hp:t>` : '<hp:t/>'}</hp:run></hp:p>`,
    )
    .join('');
  return `${SECTION_OPEN}${first}${body}</hs:sec>`;
}

/* ───────── ZIP (무압축 STORE, 한글은 mimetype이 첫 항목·무압축이어야 함) ───────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 파일 이름
    lh.setUint16(8, 0, true); // STORE
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/** 학위논문 HWPX 파일 바이트 */
export function buildThesisHwpx(d: ThesisDoc, now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { xml: header, char, para } = buildHeader();
  const ps = thesisParagraphs(d);
  const section = buildSection(ps, char, para);
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const hpf = SKELETON_FILES['Contents/content.hpf']
    .replace(/<opf:title\/>/, `<opf:title>${esc(d.titleKo)}</opf:title>`)
    .replace(/(name="creator" content="text">)[^<]*/, `$1${esc(d.student || 'AI WIKI')}`)
    .replace(/(name="lastsaveby" content="text">)[^<]*/, `$1${esc(d.student || 'AI WIKI')}`)
    .replace(/(name="CreatedDate" content="text">)[^<]*/, `$1${iso}`)
    .replace(/(name="ModifiedDate" content="text">)[^<]*/, `$1${iso}`)
    .replace(/(name="date" content="text">)[^<]*/, `$1${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`);
  const preview = ps
    .map((p) => p.text)
    .filter(Boolean)
    .join('\r\n')
    .slice(0, 1000);
  const files: { name: string; data: Uint8Array }[] = [
    { name: 'mimetype', data: enc.encode(SKELETON_FILES['mimetype']) },
    { name: 'version.xml', data: enc.encode(SKELETON_FILES['version.xml']) },
    { name: 'Contents/header.xml', data: enc.encode(header) },
    { name: 'Contents/section0.xml', data: enc.encode(section) },
    { name: 'Preview/PrvText.txt', data: enc.encode(preview) },
    { name: 'settings.xml', data: enc.encode(SKELETON_FILES['settings.xml']) },
    { name: 'META-INF/container.rdf', data: enc.encode(SKELETON_FILES['META-INF/container.rdf']) },
    { name: 'Contents/content.hpf', data: enc.encode(hpf) },
    { name: 'META-INF/container.xml', data: enc.encode(SKELETON_FILES['META-INF/container.xml']) },
    { name: 'META-INF/manifest.xml', data: enc.encode(SKELETON_FILES['META-INF/manifest.xml']) },
  ];
  return zipStore(files, now);
}
