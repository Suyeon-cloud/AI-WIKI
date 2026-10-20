/**
 * 파일 → 가져오기 후보 변환.
 * - JSON: 전체 백업(설정·집필 포함)과 자료 목록/단일 자료를 구분
 * - Markdown: frontmatter(YAML)와 섹션(본문·내 관점·연구 메모)을 분리해 ID·서지정보·관점을 복원
 * - TXT: 본문으로 저장
 */
import { USAGE_SECTIONS, type Material, type Origin, type Para, type SourceType, type UsageSection, type ViewStatus } from '../types';
import { clampRel, isFullBackup, normBib, normalizeMaterial, parseFullState, pickPresent, type StateParseResult } from './data';
import { MD_BIB_KEYS, MD_HEADINGS, PARAS, SOURCE_TYPES, isValidUrl } from './utils';
import { parseYaml, type YamlValue } from './yaml';

export interface ParsedCandidate {
  partial: Partial<Material>;
  source: string;
  fallbackTitle: string;
}

export type ParsedFile =
  | { kind: 'materials'; items: ParsedCandidate[]; errors: string[] }
  | { kind: 'backup'; backup: StateParseResult; source: string };

/* ───────── JSON ───────── */

function parseJson(name: string, base: string, text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 문법 오류 (${e instanceof Error ? e.message : '해석 실패'})`);
  }
  if (isFullBackup(data)) return { kind: 'backup', backup: parseFullState(data), source: name };

  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { materials?: unknown }).materials)
      ? (data as { materials: unknown[] }).materials
      : [data];
  const items: ParsedCandidate[] = [];
  const errors: string[] = [];
  arr.forEach((raw, i) => {
    const fallbackTitle = arr.length > 1 ? `${base} (${i + 1})` : base;
    const m = normalizeMaterial(raw, fallbackTitle);
    if (!m) {
      errors.push(`${i + 1}번째 항목이 자료 객체가 아님`);
      return;
    }
    // 원본에 없던 필드를 기본값으로 채워 기존 자료를 덮어쓰지 않도록, 실제 있던 키만 사용
    const partial = pickPresent(raw, m);
    if (!partial.title) partial.title = m.title;
    if (!partial.sourceType) partial.sourceType = m.sourceType;
    items.push({ partial, source: name, fallbackTitle });
  });
  if (!items.length) throw new Error(errors[0] ?? '가져올 자료가 없습니다.');
  return { kind: 'materials', items, errors };
}

/* ───────── Markdown ───────── */

function splitFrontmatter(text: string): { meta: Record<string, YamlValue>; body: string; hasFm: boolean } {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: text, hasFm: false };
  return { meta: parseYaml(m[1]), body: text.replace(/^﻿/, '').slice(m[0].length), hasFm: true };
}

const asStr = (v: YamlValue | undefined): string | undefined => {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => x != null).map(String).join(', ') || undefined;
  const s = String(v).trim();
  return s || undefined;
};

const asList = (v: YamlValue | undefined): string[] =>
  (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : typeof v === 'string' ? v.split(',') : [])
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);

/** '## 내 관점'은 정확히 일치, '## AI 분석 (…)'처럼 괄호 설명이 붙은 제목은 괄호 내용과 무관하게 일치 */
const headingRe = (h: string) => {
  const core = h.replace(/\s*\(.*\)\s*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${core}(\\s*\\(.*\\))?\\s*$`);
};

/** 코드 블록(``` 또는 ~~~) 안의 줄 표시 — 코드 속 '## 내 관점'이나 '# 주석'을 제목으로 보지 않기 위해 */
function fenceMask(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((l) => {
    const m = l.trim().match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return true;
    }
    if (m) {
      fence = m[1];
      return true;
    }
    return false;
  });
}

type SectionKey = 'memo' | 'link' | 'view' | 'transcript' | 'analysis';

/**
 * 본문에서 내 관점·연구 메모 등 섹션을 분리한다.
 * - AI WIKI가 내보낸 노트: 뒤에서부터 연구 메모 → 내 관점 → 자막 요약 → AI 분석 순으로 마지막 제목을 기준으로 자른다.
 *   본문 안에 같은 제목이 있어도 마지막 섹션만 사용하므로 본문이 잘리지 않고, 관점 안의 소제목(###)도 유지된다.
 * - 일반 Obsidian 노트: '## 내 관점' / '## 연구 메모' 섹션을 다음 #·## 제목 전까지만 가져온다 (뒤의 다른 섹션은 본문에 남음).
 * 어느 경우든 코드 블록 안의 제목은 무시한다.
 */
function splitSections(body: string, fromApp: boolean) {
  const lines = body.split(/\r?\n/);
  const fenced = fenceMask(lines);
  const isHeading = (i: number, re: RegExp) => !fenced[i] && re.test(lines[i].trim());
  const found: Partial<Record<SectionKey, string>> = {};

  if (fromApp) {
    let limit = lines.length;
    for (const key of ['memo', 'link', 'view', 'transcript', 'analysis'] as const) {
      const re = headingRe(MD_HEADINGS[key]);
      for (let i = limit - 1; i >= 0; i--) {
        if (isHeading(i, re)) {
          found[key] = lines.slice(i + 1, limit).join('\n');
          limit = i;
          break;
        }
      }
    }
    return { head: lines.slice(0, limit), fenced: fenced.slice(0, limit), found };
  }

  const removed = new Set<number>();
  for (const key of ['view', 'link', 'memo'] as const) {
    const re = headingRe(MD_HEADINGS[key]);
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!removed.has(i) && isHeading(i, re)) {
        start = i;
        break;
      }
    }
    if (start < 0) continue;
    let end = start + 1;
    while (end < lines.length && (fenced[end] || !/^#{1,2}\s/.test(lines[end].trim()))) end++;
    found[key] = lines.slice(start + 1, end).join('\n');
    for (let i = start; i < end; i++) removed.add(i);
  }
  const keep = lines.map((_, i) => i).filter((i) => !removed.has(i));
  return { head: keep.map((i) => lines[i]), fenced: keep.map((i) => fenced[i]), found };
}

const cleanSection = (s?: string) => s?.replace(/<!--[\s\S]*?-->/g, '').trim() || undefined;

function parseMarkdown(name: string, base: string, text: string, size: number): ParsedFile {
  const { meta, body, hasFm } = splitFrontmatter(text);
  if (text.startsWith('---') && !hasFm) throw new Error('frontmatter(---) 구간이 닫히지 않았습니다.');
  const fromApp = asStr(meta.exported_from) === 'AI WIKI' || meta.ai_wiki_id != null;
  const { head, fenced, found } = splitSections(body, fromApp);

  let content: string | undefined;
  if (fromApp) {
    // AI WIKI가 만든 노트: '## 본문' 섹션만 본문으로 사용 (제목·요약 줄과 Demo 분석은 제외)
    const ci = head.findIndex((l, i) => !fenced[i] && headingRe(MD_HEADINGS.content).test(l.trim()));
    content = ci >= 0 ? head.slice(ci + 1).join('\n').trim() || undefined : undefined;
  } else content = head.join('\n').trim() || undefined;

  const h1 = head.find((l, i) => !fenced[i] && /^#\s+\S/.test(l))?.replace(/^#\s+/, '').trim();
  const prose = head.filter((_, i) => !fenced[i]).join('\n'); // 태그 추출용 (코드 블록 제외)
  const tags = asList(meta.tags);
  const inlineTags = fromApp ? [] : Array.from(prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)).map((m) => m[1]);

  const p: Partial<Material> = {
    title: asStr(meta.title) ?? h1 ?? base,
    sourceType: SOURCE_TYPES.includes(meta.source_type as SourceType) ? (meta.source_type as SourceType) : 'Markdown',
    keywords: Array.from(new Set([...tags, ...inlineTags])).slice(0, fromApp ? undefined : 8),
  };
  const set = <K extends keyof Material>(k: K, v: Material[K] | undefined) => {
    if (v !== undefined) p[k] = v;
  };
  set('id', asStr(meta.ai_wiki_id));
  set('origin', meta.origin === '원본 자료' || meta.origin === 'AI 생성 자료' ? (meta.origin as Origin) : undefined);
  set('para', PARAS.includes(meta.para as Para) ? (meta.para as Para) : fromApp ? undefined : 'Resources');
  set('relevance', meta.relevance != null ? clampRel(meta.relevance) : undefined);
  set('topic', asStr(meta.topic));
  const url = asStr(meta.url);
  set('url', url && isValidUrl(url) ? url : undefined);
  set('youtubeId', asStr(meta.youtube_id));
  set('mimeType', asStr(meta.mime_type));
  set('createdAt', asStr(meta.created));
  set('updatedAt', asStr(meta.updated));
  set('content', content);
  set('myView', cleanSection(found.view));
  set('researchMemo', cleanSection(found.memo));
  set('researchLink', cleanSection(found.link));
  const usage = asList(meta.usage).filter((u): u is UsageSection => (USAGE_SECTIONS as readonly string[]).includes(u));
  if (usage.length) p.usage = usage;
  set('viewStatus', asStr(meta.view_status) as ViewStatus | undefined);
  set('isSample', meta.is_sample === true ? true : undefined);
  if (typeof meta.citation_included === 'boolean') p.citationIncluded = meta.citation_included;

  // 서지정보: materialToMarkdown이 쓰는 평평한 키. Zotero·Obsidian에서 흔한 author/journal 키도 받는다.
  const bibRaw: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(MD_BIB_KEYS)) {
    const v = meta[key];
    if (v != null && bibRaw[field] == null) bibRaw[field] = Array.isArray(v) ? v.filter((x) => x != null).map(String) : String(v);
  }
  // 유형 키가 없는 일반 노트라도 journal 속성이 있으면 학술지 논문으로 본다 (그 외 유형은 추정하지 않음)
  if (bibRaw.type == null && meta.journal != null) bibRaw.type = 'journal';
  const bib = normBib(bibRaw);
  if (bib) p.bib = bib;

  // 원 자료의 파일 정보가 있으면 유지, 없으면 가져온 .md 파일 자체를 기록 (재가져오기 중복 확인에 사용)
  const fileName = asStr(meta.file_name);
  if (fileName) {
    p.fileName = fileName;
    const fs = Number(meta.file_size);
    if (meta.file_size != null && Number.isFinite(fs)) p.fileSize = fs;
  } else if (!fromApp) {
    p.fileName = name;
    p.fileSize = size;
  }
  return { kind: 'materials', items: [{ partial: p, source: name, fallbackTitle: base }], errors: [] };
}

/* ───────── 진입점 ───────── */

export const IMPORT_ACCEPT = '.md,.markdown,.txt,.json';

export async function parseImportFile(f: File): Promise<ParsedFile> {
  const ext = f.name.split('.').pop()?.toLowerCase();
  const base = f.name.replace(/\.[^.]+$/, '');
  if (!ext || !['json', 'md', 'markdown', 'txt'].includes(ext)) throw new Error('지원하지 않는 형식 (.md / .txt / .json만 가능)');
  if (f.size > 20 * 1024 * 1024) throw new Error('파일이 너무 큽니다 (20MB 초과)');
  const text = await f.text();
  if (!text.trim()) throw new Error('빈 파일입니다.');
  if (ext === 'json') return parseJson(f.name, base, text);
  if (ext === 'md' || ext === 'markdown') return parseMarkdown(f.name, base, text, f.size);
  return {
    kind: 'materials',
    items: [{ partial: { title: base, sourceType: 'TXT', content: text.trim(), fileName: f.name, fileSize: f.size }, source: f.name, fallbackTitle: base }],
    errors: [],
  };
}
