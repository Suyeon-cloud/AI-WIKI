/**
 * HWPX 양식 분석 (1단계: 읽기·분석만, 출력에는 아직 적용하지 않음)
 * - 업로드한 .hwpx를 브라우저 메모리에서만 읽는다. 서버·DB·브라우저 저장소에 보관하지 않는다.
 * - ZIP은 필요한 항목(mimetype, Contents/header.xml, Contents/section0.xml)만 직접 해석한다.
 *   암호화·ZIP64·이상한 경로·과도한 압축률·크기 초과는 거부한다.
 * - XML은 DOCTYPE/ENTITY를 거부하고(외부 엔티티·엔티티 폭탄 차단), 정규식으로 필요한 속성만 읽는다.
 */

export const TEMPLATE_LIMITS = {
  fileBytes: 5 * 1024 * 1024, // 업로드 파일 최대 5MB
  entries: 200, // ZIP 항목 수
  xmlBytes: 8 * 1024 * 1024, // 읽는 XML 하나의 압축 해제 후 최대 크기
  ratio: 100, // 압축률 상한 (압축 폭탄 차단)
};

export class TemplateError extends Error {}

interface ZipEntry { name: string; method: number; flags: number; compSize: number; size: number; offset: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** 중앙 디렉터리 읽기 (구조 검증 포함) */
export function listZip(b: Uint8Array): ZipEntry[] {
  if (b.length < 22) throw new TemplateError('HWPX(ZIP) 파일이 아닙니다.');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new TemplateError('HWPX(ZIP) 파일이 아닙니다.');
  const total = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new TemplateError('지원하지 않는 ZIP 형식(ZIP64)입니다.');
  if (total > TEMPLATE_LIMITS.entries) throw new TemplateError(`파일 안 항목이 너무 많습니다 (${total}개).`);
  if (cdOffset + cdSize > eocd) throw new TemplateError('ZIP 구조가 손상되었습니다.');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || u32(b, p) !== 0x02014b50) throw new TemplateError('ZIP 구조가 손상되었습니다.');
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    if (p + 46 + nameLen > eocd) throw new TemplateError('ZIP 구조가 손상되었습니다.');
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /[\u0000-\u001f]/.test(name))
      throw new TemplateError('허용하지 않는 파일 경로가 들어 있습니다.');
    if (flags & 1) throw new TemplateError('암호화된 파일은 읽을 수 없습니다.');
    if (method !== 0 && method !== 8) throw new TemplateError('지원하지 않는 압축 방식입니다.');
    if (offset >= cdOffset) throw new TemplateError('ZIP 구조가 손상되었습니다.');
    out.push({ name, method, flags, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new TemplateError('압축을 푼 크기가 제한을 넘습니다.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return out;
}

/** 항목 하나 읽기 (선언 크기·압축률·실제 크기 검증) */
export async function readZipEntry(b: Uint8Array, e: ZipEntry, limit = TEMPLATE_LIMITS.xmlBytes): Promise<Uint8Array> {
  if (e.size > limit) throw new TemplateError(`${e.name} 크기가 제한을 넘습니다.`);
  if (e.compSize > 0 && e.size / e.compSize > TEMPLATE_LIMITS.ratio) throw new TemplateError(`${e.name}의 압축률이 비정상적입니다.`);
  if (e.offset + 30 > b.length || u32(b, e.offset) !== 0x04034b50) throw new TemplateError('ZIP 구조가 손상되었습니다.');
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  if (start + e.compSize > b.length) throw new TemplateError('ZIP 구조가 손상되었습니다.');
  const raw = b.subarray(start, start + e.compSize);
  const data = e.method === 0 ? raw : await inflateRaw(raw, limit);
  if (data.length !== e.size) throw new TemplateError(`${e.name}의 실제 크기가 선언과 다릅니다.`);
  return data;
}

function safeXml(bytes: Uint8Array, name: string): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new TemplateError(`${name}이 올바른 UTF-8이 아닙니다.`); }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TemplateError(`${name}에 허용하지 않는 선언(DOCTYPE/ENTITY)이 있습니다.`);
  return text;
}

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decodeXml(m[2])]));
const decodeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&' : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const mm = (v: string | undefined) => (v && /^\d+$/.test(v) ? Math.round((Number(v) * 25.4 * 10) / 7200) / 10 : null); // HWPUNIT → mm

export interface TemplateStyle { id: string; type: string; name: string; engName: string; paraPrIDRef: string; charPrIDRef: string; refsOk: boolean }
export type TemplateRole = 'chapter' | 'section' | 'subsection' | 'body' | 'reference' | 'footnote';
export const ROLE_LABEL: Record<TemplateRole, string> = { chapter: '장 제목', section: '절 제목', subsection: '항 제목', body: '본문', reference: '참고문헌', footnote: '각주' };
/** 역할별로 찾는 스타일 이름 (한글 이름 또는 영문 이름, 앞쪽이 우선) */
const ROLE_NAMES: Record<TemplateRole, string[]> = {
  chapter: ['개요 1', 'Outline 1', '제목', 'Heading 1', 'Title'],
  section: ['개요 2', 'Outline 2', 'Heading 2'],
  subsection: ['개요 3', 'Outline 3', 'Heading 3'],
  body: ['본문', 'Body', '바탕글', 'Normal'],
  reference: ['참고문헌', 'References', 'Bibliography'],
  footnote: ['각주', 'Footnote'],
};
export interface RoleMapping { role: TemplateRole; label: string; style: TemplateStyle | null }
export interface TemplateAnalysis {
  fileName: string;
  fileBytes: number;
  counts: { styles: number; charPr: number; paraPr: number; fontfaces: number; entries: number };
  styles: TemplateStyle[];
  mapping: RoleMapping[];
  page: { widthMm: number | null; heightMm: number | null; landscape: string | null; margins: Record<string, number | null> } | null;
  footnote: { numberType: string | null; suffix: string | null } | null;
  warnings: string[];
}

export function analyzeXml(header: string, section: string | null): Omit<TemplateAnalysis, 'fileName' | 'fileBytes' | 'counts'> & { counts: Omit<TemplateAnalysis['counts'], 'entries'> } {
  if (!/<hh:head\b/.test(header)) throw new TemplateError('header.xml이 HWPX 형식이 아닙니다.');
  const charIds = new Set([...header.matchAll(/<hh:charPr\s[^>]*?\bid="(\d+)"/g)].map((m) => m[1]));
  const paraIds = new Set([...header.matchAll(/<hh:paraPr\s[^>]*?\bid="(\d+)"/g)].map((m) => m[1]));
  const styles: TemplateStyle[] = [...header.matchAll(/<hh:style\s[^>]*?\/?>/g)].map((m) => {
    const a = attrs(m[0]);
    return { id: a.id ?? '', type: a.type ?? '', name: a.name ?? '', engName: a.engName ?? '', paraPrIDRef: a.paraPrIDRef ?? '', charPrIDRef: a.charPrIDRef ?? '', refsOk: paraIds.has(a.paraPrIDRef ?? '') && charIds.has(a.charPrIDRef ?? '') };
  });
  const warnings: string[] = [];
  if (!styles.length) warnings.push('스타일 정의가 없습니다. 모든 항목을 내장 서식으로 대체합니다.');
  const broken = styles.filter((s) => !s.refsOk);
  if (broken.length) warnings.push(`글자·문단 모양 참조가 맞지 않는 스타일 ${broken.length}개는 연결에서 제외합니다: ${broken.map((s) => s.name || s.engName).join(', ')}`);
  const norm = (s: string) => s.trim().toLowerCase();
  const usable = styles.filter((s) => s.type === 'PARA' && s.refsOk);
  const mapping: RoleMapping[] = (Object.keys(ROLE_NAMES) as TemplateRole[]).map((role) => {
    const style = ROLE_NAMES[role].map((n) => usable.find((s) => norm(s.name) === norm(n) || norm(s.engName) === norm(n))).find(Boolean) ?? null;
    return { role, label: ROLE_LABEL[role], style };
  });

  let page: TemplateAnalysis['page'] = null;
  let footnote: TemplateAnalysis['footnote'] = null;
  if (section) {
    if (!/<hs:sec\b/.test(section)) throw new TemplateError('section0.xml이 HWPX 형식이 아닙니다.');
    const pagePr = section.match(/<hp:pagePr\s[^>]*>/)?.[0];
    const margin = section.match(/<hp:margin\s[^>]*\/>/)?.[0];
    if (pagePr) {
      const a = attrs(pagePr);
      const m = margin ? attrs(margin) : {};
      page = { widthMm: mm(a.width), heightMm: mm(a.height), landscape: a.landscape ?? null, margins: Object.fromEntries(['left', 'right', 'top', 'bottom', 'header', 'footer'].map((k) => [k, mm(m[k])])) };
    } else warnings.push('쪽 설정(용지·여백)을 찾지 못했습니다. 내장 쪽 설정을 사용합니다.');
    const fn = section.match(/<hp:footNotePr>[\s\S]*?<\/hp:footNotePr>/)?.[0];
    const fmt = fn?.match(/<hp:autoNumFormat\s[^>]*\/>/)?.[0];
    if (fmt) { const a = attrs(fmt); footnote = { numberType: a.type ?? null, suffix: a.suffixChar ?? null }; }
    else warnings.push('각주 번호 설정을 찾지 못했습니다. 내장 각주 설정을 사용합니다.');
  } else warnings.push('Contents/section0.xml이 없어 쪽 설정을 읽지 못했습니다.');

  return { styles, mapping, page, footnote, warnings, counts: { styles: styles.length, charPr: charIds.size, paraPr: paraIds.size, fontfaces: (header.match(/<hh:fontface\s/g) ?? []).length } };
}

/** 업로드한 .hwpx 분석 (메모리에서만) */
export async function analyzeTemplate(fileName: string, bytes: Uint8Array): Promise<TemplateAnalysis> {
  if (!/\.hwpx$/i.test(fileName)) throw new TemplateError('.hwpx 파일만 사용할 수 있습니다. (.hwp는 한글에서 HWPX로 다시 저장해 주세요)');
  if (bytes.length > TEMPLATE_LIMITS.fileBytes) throw new TemplateError('파일이 5MB를 넘습니다.');
  const entries = listZip(bytes);
  const find = (n: string) => entries.find((e) => e.name === n);
  const mt = find('mimetype');
  if (!mt) throw new TemplateError('HWPX 필수 항목(mimetype)이 없습니다.');
  const mime = new TextDecoder().decode(await readZipEntry(bytes, mt, 1024)).trim();
  if (mime !== 'application/hwp+zip') throw new TemplateError('HWPX 문서가 아닙니다 (mimetype 불일치).');
  const headerEntry = find('Contents/header.xml');
  if (!headerEntry) throw new TemplateError('HWPX 필수 항목(Contents/header.xml)이 없습니다.');
  const header = safeXml(await readZipEntry(bytes, headerEntry), 'header.xml');
  const sectionEntry = find('Contents/section0.xml');
  const section = sectionEntry ? safeXml(await readZipEntry(bytes, sectionEntry), 'section0.xml') : null;
  const r = analyzeXml(header, section);
  return { ...r, fileName, fileBytes: bytes.length, counts: { ...r.counts, entries: entries.length } };
}
