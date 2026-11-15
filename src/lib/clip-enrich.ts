/**
 * Obsidian 웹 클리퍼 노트(RISS·KCI·DBpia 논문 상세 페이지)에서 논문 정보를 읽고,
 * 이미 가져온 자료의 빈 필드(url·bib.type·bib.year·abstract)만 채울 계획을 만든다.
 * - 유형은 URL 근거와 본문 서지 항목이 함께 맞을 때만 정한다. 처음 보는 값은 분류하지 않는다.
 * - 자료와 노트는 파일명과 바이트 크기가 모두 같을 때만 1:1로 짝짓는다.
 * - 이미 값이 있는 필드는 바꾸지 않는다 (다르면 '충돌'로만 알린다). content·메모·연결 정보는 건드리지 않는다.
 */
import type { Bib, Material, RefType } from '../types';

export type ClipSite = 'riss' | 'kci' | 'dbpia';
export const CLIP_SITE_LABEL: Record<ClipSite, string> = { riss: 'RISS', kci: 'KCI', dbpia: 'DBpia' };

/** RISS 자료 유형 코드: 노트 400건에서 코드와 서지 항목이 모두 일치한 값만 둔다 (그 외 코드는 미분류) */
export const RISS_MAT_TYPES: Record<string, { type: RefType; label: string }> = {
  be54d9b8bc7cdb09: { type: 'thesis', label: '학위논문사항' },
  '1a0202e37d52c72d': { type: 'journal', label: '학술지명' },
};

export interface ClipInfo {
  site: ClipSite;
  url?: string;
  year?: string;
  type?: RefType;
  /** 유형을 정한 근거 또는 정하지 않은 이유 */
  typeNote: string;
  abstract?: string;
  /** 초록을 못 찾았거나 확인이 필요한 이유 (있으면 자동 반영하지 않는다) */
  abstractWarn?: string;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function clipSiteOf(url: string | undefined): ClipSite | undefined {
  const h = url ? host(url) : '';
  if (h === 'riss.kr') return 'riss';
  if (h === 'kci.go.kr') return 'kci';
  if (h === 'dbpia.co.kr') return 'dbpia';
  return undefined;
}

/** 출처 URL 정리: 자료를 가리키는 값만 남긴다 (RISS 검색어 keyword 등 제거) */
export function cleanClipUrl(site: ClipSite, url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  const keep: Record<ClipSite, string[]> = {
    riss: ['p_mat_type', 'control_no'],
    kci: ['sereArticleSearchBean.artiId'],
    dbpia: ['nodeId'],
  };
  const params = keep[site].filter((k) => u.searchParams.get(k));
  if (!params.length) return u.toString();
  const q = new URLSearchParams();
  for (const k of params) q.set(k, u.searchParams.get(k)!);
  return `${u.origin}${u.pathname}?${q.toString()}`;
}

/** published: '2024', '2024-05-01', '2024-5-01T..' → '2024' */
export function clipYear(published: string | undefined): string | undefined {
  const m = published?.trim().match(/^(\d{4})(?:$|[-./T\s])/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? m[1] : undefined;
}

const labelLine = (body: string, label: string) => new RegExp(`(^|\\|)\\s*(\\*\\*|-\\s*)?${label}`, 'm').test(body);
const exactLine = (text: string, label: string) => new RegExp(`^\\s*${label}\\s*$`, 'm').test(text);

export function clipType(site: ClipSite, url: string, body: string): { type?: RefType; note: string } {
  if (site === 'riss') {
    let code: string | null = null;
    try {
      code = new URL(url).searchParams.get('p_mat_type');
    } catch {
      /* 아래에서 처리 */
    }
    if (!code) return { note: 'RISS 유형 코드 없음' };
    const rule = RISS_MAT_TYPES[code];
    if (!rule) return { note: `확인되지 않은 RISS 유형 코드(${code})` };
    if (!labelLine(body, rule.label)) return { note: `RISS 유형 코드와 본문 서지 항목('${rule.label}')이 맞지 않음` };
    return { type: rule.type, note: `RISS 유형 코드 + '${rule.label}' 항목` };
  }
  if (site === 'kci') {
    const ok = /ciSereArtiView/.test(url) && /^\s*HOME\s*>\s*논문\s*>\s*논문 상세\s*$/m.test(body);
    return ok ? { type: 'journal', note: 'KCI 논문 상세 페이지' } : { note: 'KCI 논문 상세 페이지 표시 없음' };
  }
  // DBpia: 같은 사이트에 학술저널·학술대회·학위논문이 섞여 있어 초록 앞 서지 영역의 자료 유형 줄로만 판단
  const head = body.split(/^##\s*초록/m)[0];
  const found = (['학술저널', '학위논문', '학술대회'] as const).filter((l) => exactLine(head, l));
  if (found.length !== 1) return { note: found.length ? `자료 유형 표시가 여러 개(${found.join('·')})` : 'DBpia 자료 유형 표시 없음' };
  if (found[0] === '학술저널') return { type: 'journal', note: "DBpia '학술저널' 표시" };
  if (found[0] === '학위논문') return { type: 'thesis', note: "DBpia '학위논문' 표시" };
  return { note: 'DBpia 학술대회 자료 — 대응하는 참고문헌 유형 없음' };
}

/* ───────── 초록 추출 ───────── */

const LANGS = '한국어|영어|일본어|중국어|네덜란드어|독일어|러시아어|말레이시아어|벵골어|베트남어|스페인어|아랍어|이탈리아어|인도네시아어|태국어|터키어|포르투갈어|프랑스어|힌디어';
/** 사이트 화면 문구 (초록 구간 안에서 반복되는 줄) */
const NOISE: RegExp[] = [
  new RegExp(`^-\\s*(${LANGS})$`),
  /^\[[^\]]*\]\(#[^)]*\)$/, // [한국어](#) · [더보기](#)
  /^(번역하기|더보기)$/,
  /^이 키워드로 연구동향 분석$/,
  /^[,·]$/,
  /열기\/닫기 버튼$/,
  /^!\[[^\]]*\]\([^)]*\)$/,
  /^\[!\[/,
  /^(\[#[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\)\s*)+$/, // DBpia 키워드 태그 링크 줄 [#키워드](…) — 주소 속 괄호 한 단계 허용
  /^로그인하면 /,
];
const isNoise = (l: string) => NOISE.some((r) => r.test(l));
const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1');

/** 줄 목록 → 문단 (빈 줄 기준). 같은 문단·잘린 미리보기(다른 문단의 앞부분) 중복은 하나만 남긴다 */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join('\n'));
    cur = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) flush();
    else if (!isNoise(l)) cur.push(unescapeMd(l));
  }
  flush();
  return dedupe(out);
}

function dedupe(out: string[]): string[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/(\.\.\.|…)$/, '').trim();
  return out.filter((p, i) => {
    const n = norm(p);
    if (!n) return false;
    return !out.some((q, j) => j !== i && (norm(q) === n ? j < i : norm(q).length > n.length && norm(q).startsWith(n)));
  });
}

/** RISS: '국문 초록'·'다국어 초록' 표지 뒤 언어 메뉴를 건너뛰고 '번역하기' 전까지가 초록 (번역하기 뒤는 잘린 미리보기·반복) */
function rissAbstract(lines: string[]): string[] {
  const parts: string[] = [];
  lines.forEach((l, i) => {
    if (!/^\s*(#+\s*)?(국문|다국어)\s*초록/.test(l)) return;
    const seg: string[] = [];
    for (let j = i + 1; j < lines.length && j < i + 200; j++) {
      const t = lines[j].trim();
      if (t === '번역하기' || t === '[더보기](#)' || /^(#+\s|목차 \(|참고문헌 \(|(국문|다국어)\s*초록)/.test(t)) break;
      seg.push(lines[j]);
    }
    parts.push(...paragraphs(seg));
  });
  return parts;
}

/** KCI·DBpia: '## 초록…' 제목부터 다음 제목(##~####) 전까지 */
function headingAbstract(lines: string[]): string[] {
  const s = lines.findIndex((l) => /^##\s*초록/.test(l));
  if (s < 0) return [];
  let e = s + 1;
  while (e < lines.length && !/^#{1,4}\s/.test(lines[e])) e++;
  return paragraphs(lines.slice(s + 1, e));
}

export const ABSTRACT_MIN = 30;
export const ABSTRACT_MAX = 12000;

export function clipAbstract(site: ClipSite, body: string): { abstract?: string; warn?: string } {
  const lines = body.split(/\r?\n/);
  const paras = site === 'riss' ? rissAbstract(lines) : headingAbstract(lines);
  // 문단 사이 중복 제거 후 합친다 (국문 + 다국어)
  const text = dedupe(paras).join('\n\n').trim();
  if (text.length < ABSTRACT_MIN) return { warn: text ? '초록이 너무 짧음' : '초록 구간 없음' };
  if (text.length > ABSTRACT_MAX) return { abstract: text, warn: `초록이 ${text.length.toLocaleString()}자로 김 — 확인 필요` };
  if (/\]\(#|번역하기|열기\/닫기/.test(text)) return { abstract: text, warn: '화면 문구가 남아 있을 수 있음 — 확인 필요' };
  return { abstract: text };
}

/** frontmatter의 source·published와 본문으로 논문 정보를 읽는다. RISS·KCI·DBpia가 아니면 undefined */
export function readClip(source: string | undefined, published: string | undefined, body: string): ClipInfo | undefined {
  const site = clipSiteOf(source);
  if (!site || !source) return undefined;
  const t = clipType(site, source, body);
  const a = clipAbstract(site, body);
  return { site, url: cleanClipUrl(site, source), year: clipYear(published), type: t.type, typeNote: t.note, abstract: a.abstract, abstractWarn: a.warn };
}

/* ───────── 기존 자료와 짝짓기 · 보완 계획 ───────── */

export interface ClipFile {
  name: string;
  size: number;
  text: string;
}
export type EnrichField = 'url' | 'type' | 'year' | 'abstract';
export const ENRICH_FIELD_LABEL: Record<EnrichField, string> = { url: '출처 URL', type: '논문 유형', year: '발행연도', abstract: '초록' };

export interface FieldChange {
  field: EnrichField;
  before?: string;
  after: string;
}
export interface EnrichRow {
  file: ClipFile;
  material: Material;
  clip: ClipInfo;
  changes: FieldChange[];
  conflicts: FieldChange[];
}
export type SkipReason = 'not-md' | 'dup-file' | 'no-material' | 'size-mismatch' | 'dup-material' | 'not-clip' | 'nothing';
export const SKIP_LABEL: Record<SkipReason, string> = {
  'not-md': 'Markdown 파일 아님',
  'dup-file': '선택한 파일 중 같은 파일명이 여러 개',
  'no-material': '같은 파일명의 기존 자료 없음',
  'size-mismatch': '파일명은 같지만 크기가 다름',
  'dup-material': '같은 파일명·크기의 자료가 여러 개',
  'not-clip': 'RISS·KCI·DBpia 웹 클리퍼 노트 아님',
  nothing: '채울 빈 필드 없음 (기존 값 유지)',
};
export interface SkipItem {
  name: string;
  reason: SkipReason;
  title?: string;
}
export interface EnrichPlan {
  rows: EnrichRow[];
  skipped: SkipItem[];
}

const blank = (s: string | undefined) => !s || !s.trim();

/** 한 자료에 대해 채울 필드와 충돌(기존 값 유지)을 계산한다 */
export function diffClip(m: Material, c: ClipInfo): { changes: FieldChange[]; conflicts: FieldChange[] } {
  const changes: FieldChange[] = [];
  const conflicts: FieldChange[] = [];
  const check = (field: EnrichField, before: string | undefined, after: string | undefined, same: (a: string, b: string) => boolean = (a, b) => a === b) => {
    if (!after) return;
    if (blank(before)) changes.push({ field, after });
    else if (!same(before!.trim(), after)) conflicts.push({ field, before, after });
  };
  check('url', m.url, c.url, (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, ''));
  check('type', m.bib?.type, c.type);
  check('year', m.bib?.year, c.year, (a, b) => a.slice(0, 4) === b);
  if (c.abstract) check('abstract', m.abstract, c.abstract, (a, b) => a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' '));
  return { changes, conflicts };
}

/** 선택한 필드만 반영한 patch. bib는 기존 값을 모두 유지하고 type·year만 채운다 */
export function enrichPatch(m: Material, changes: FieldChange[]): Partial<Material> {
  const patch: Partial<Material> = {};
  const bib: Bib = { ...(m.bib ?? { author: '', year: '', publisher: '' }) };
  let bibChanged = false;
  for (const c of changes) {
    if (c.field === 'url' && blank(m.url)) patch.url = c.after;
    if (c.field === 'abstract' && blank(m.abstract)) patch.abstract = c.after;
    if (c.field === 'type' && !m.bib?.type) {
      bib.type = c.after as RefType;
      bibChanged = true;
    }
    if (c.field === 'year' && blank(m.bib?.year)) {
      bib.year = c.after;
      bibChanged = true;
    }
  }
  if (bibChanged) patch.bib = bib;
  return patch;
}

/* ───────── 안전 후보 · 수동 검토 구분 ───────── */

/** 이 길이 이상인 초록은 앱 경고(ABSTRACT_MAX)가 없어도 사람이 확인한다 */
export const REVIEW_ABSTRACT_LEN = 8000;

export type ReviewReason = 'type-unclassified' | 'abstract-missing' | 'abstract-short' | 'abstract-long' | 'abstract-ui-text' | 'abstract-8000' | 'year-conflict' | 'type-conflict';
export const REVIEW_LABEL: Record<ReviewReason, string> = {
  'type-unclassified': '논문 유형 미분류',
  'abstract-missing': '초록 없음',
  'abstract-short': '초록 너무 짧음',
  'abstract-long': '초록 과도하게 김',
  'abstract-ui-text': '초록에 화면 문구 의심',
  'abstract-8000': `초록 ${REVIEW_ABSTRACT_LEN.toLocaleString()}자 이상`,
  'year-conflict': '기존 연도와 다름',
  'type-conflict': '기존 유형과 다름',
};

/**
 * 수동 검토 사유 (없으면 안전 후보). 이미 값이 있는 필드는 보완 대상이 아니므로
 * 유형·초록 사유는 자료의 해당 필드가 비어 있을 때만 따진다.
 */
export function reviewReasons(r: Pick<EnrichRow, 'material' | 'clip' | 'changes' | 'conflicts'>): ReviewReason[] {
  const out: ReviewReason[] = [];
  if (!r.clip.type && !r.material.bib?.type) out.push('type-unclassified');
  if (blank(r.material.abstract)) {
    const w = r.clip.abstractWarn ?? '';
    if (w) out.push(/너무 짧/.test(w) ? 'abstract-short' : /김/.test(w) ? 'abstract-long' : /화면 문구/.test(w) ? 'abstract-ui-text' : 'abstract-missing');
    const abs = r.changes.find((c) => c.field === 'abstract');
    if (abs && abs.after.length >= REVIEW_ABSTRACT_LEN && !/김/.test(w)) out.push('abstract-8000');
  }
  if (r.conflicts.some((c) => c.field === 'year')) out.push('year-conflict');
  if (r.conflicts.some((c) => c.field === 'type')) out.push('type-conflict');
  return out;
}

/** 행별 기본 반영 필드: 경고가 있거나 검토 길이를 넘는 초록은 기본 제외 */
export function defaultEnrichFields(r: EnrichRow): Set<EnrichField> {
  const risky = reviewReasons(r).some((x) => x.startsWith('abstract-'));
  return new Set(r.changes.filter((c) => !(c.field === 'abstract' && (risky || r.clip.abstractWarn))).map((c) => c.field));
}

/** 저장 전 확인용: 선택한 자료 수와 필드별 변경 수 (빈 필드만 계산) */
export function summarizeSelection(rows: EnrichRow[], approved: Set<string>, fields: Record<string, Set<EnrichField>>) {
  const byField: Record<EnrichField, number> = { url: 0, type: 0, year: 0, abstract: 0 };
  let count = 0;
  let review = 0;
  for (const r of rows) {
    if (!approved.has(r.material.id)) continue;
    const picked = enrichPatchFields(r.material, r.changes.filter((c) => fields[r.material.id]?.has(c.field)));
    if (!picked.length) continue;
    count++;
    if (reviewReasons(r).length) review++;
    for (const f of picked) byField[f]++;
  }
  return { count, review, byField };
}

/** enrichPatch가 실제로 채우는 필드 목록 */
export function enrichPatchFields(m: Material, changes: FieldChange[]): EnrichField[] {
  const p = enrichPatch(m, changes);
  const out: EnrichField[] = [];
  if (p.url !== undefined) out.push('url');
  if (p.bib && p.bib.type !== m.bib?.type) out.push('type');
  if (p.bib && p.bib.year !== m.bib?.year) out.push('year');
  if (p.abstract !== undefined) out.push('abstract');
  return out;
}

/**
 * 볼트 파일과 기존 Markdown 자료를 파일명+크기로 1:1 짝짓고 보완 계획을 만든다.
 * 애매한 경우(파일·자료 중복, 크기 불일치)는 모두 제외한다.
 */
export function planEnrichment(materials: Material[], files: ClipFile[], read: (text: string) => ClipInfo | undefined): EnrichPlan {
  const rows: EnrichRow[] = [];
  const skipped: SkipItem[] = [];
  const nameCount = new Map<string, number>();
  for (const f of files) nameCount.set(f.name, (nameCount.get(f.name) ?? 0) + 1);
  const byName = new Map<string, Material[]>();
  for (const m of materials) {
    if (m.sourceType !== 'Markdown' || !m.fileName) continue;
    byName.set(m.fileName, [...(byName.get(m.fileName) ?? []), m]);
  }
  for (const f of files) {
    if (!/\.(md|markdown)$/i.test(f.name)) {
      skipped.push({ name: f.name, reason: 'not-md' });
      continue;
    }
    if ((nameCount.get(f.name) ?? 0) > 1) {
      skipped.push({ name: f.name, reason: 'dup-file' });
      continue;
    }
    const sameName = byName.get(f.name) ?? [];
    const same = sameName.filter((m) => m.fileSize === f.size);
    if (!sameName.length) {
      skipped.push({ name: f.name, reason: 'no-material' });
      continue;
    }
    if (!same.length) {
      skipped.push({ name: f.name, reason: 'size-mismatch', title: sameName[0].title });
      continue;
    }
    if (same.length > 1) {
      skipped.push({ name: f.name, reason: 'dup-material', title: same[0].title });
      continue;
    }
    const material = same[0];
    const clip = read(f.text);
    if (!clip) {
      skipped.push({ name: f.name, reason: 'not-clip', title: material.title });
      continue;
    }
    const { changes, conflicts } = diffClip(material, clip);
    if (!changes.length) {
      skipped.push({ name: f.name, reason: 'nothing', title: material.title });
      continue;
    }
    rows.push({ file: f, material, clip, changes, conflicts });
  }
  return { rows, skipped };
}
