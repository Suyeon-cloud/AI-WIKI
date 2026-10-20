import { SCHEMA_VERSION, type Material, type Para, type SourceType } from '../types';
import { stringifyYaml } from './yaml';

export const SOURCE_TYPES: SourceType[] = ['PDF', 'Web', 'YouTube', 'HWPX', 'Markdown', 'TXT', 'JSON'];
export const PARAS: Para[] = ['Projects', 'Areas', 'Resources', 'Archives'];
export const PARA_LABEL: Record<Para, string> = {
  Projects: 'Projects · 진행 프로젝트',
  Areas: 'Areas · 지속 관심 영역',
  Resources: 'Resources · 참고 자원',
  Archives: 'Archives · 보관',
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function formatDate(iso: string) {
  const dt = new Date(iso);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}

export function formatSize(bytes?: number) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function isValidUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/ 형식에서 11자리 영상 ID 추출 */
export function extractYouTubeId(value: string): string | null {
  if (!isValidUrl(value)) return null;
  const u = new URL(value.trim());
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ai-wiki';
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/* ───────── 내보내기 ───────── */

/** Markdown 본문 섹션 제목 — 가져오기(importers.ts)는 같은 제목으로 섹션을 구분한다 */
export const MD_HEADINGS = {
  content: '## 본문',
  analysis: '## AI 분석 (Demo — 실제 AI 분석 아님)',
  transcript: '## 자막 요약 (Demo — 실제 자막 추출 아님)',
  view: '## 내 관점',
  link: '## 내 연구와의 연결',
  memo: '## 연구 메모',
};
/**
 * frontmatter 서지 키 → Bib 필드. 내보낼 때는 앞쪽 키를 쓰고, 가져올 때는 모두 인식한다
 * (author·journal은 Zotero/Obsidian 노트에서 흔한 키, author는 v1 내보내기 호환).
 */
export const MD_BIB_KEYS: Record<string, string> = {
  ref_type: 'type',
  authors: 'authors',
  author: 'author',
  year: 'year',
  bib_title: 'title',
  container: 'container',
  journal: 'container',
  publisher: 'publisher',
  volume: 'volume',
  issue: 'issue',
  pages: 'pages',
  edition: 'edition',
  editors: 'editors',
  place: 'place',
  degree: 'degree',
  doi: 'doi',
  bib_url: 'url',
  accessed: 'accessed',
};

export const MD_VIEW_PLACEHOLDER = '<!-- 미작성: 이 아래에 내 관점을 직접 작성하세요 -->';

function bibFrontmatter(m: Material): Record<string, string | string[] | undefined> {
  const b = m.bib;
  if (!b) return {};
  const v = (s?: string) => s?.trim() || undefined;
  const authors = b.authors?.length ? b.authors : b.author ? [b.author] : [];
  return {
    ref_type: b.type,
    authors: authors.length ? authors : undefined,
    year: v(b.year),
    bib_title: v(b.title),
    container: v(b.container),
    publisher: v(b.publisher),
    volume: v(b.volume),
    issue: v(b.issue),
    pages: v(b.pages),
    edition: v(b.edition),
    editors: b.editors?.length ? b.editors : undefined,
    place: v(b.place),
    degree: b.degree,
    doi: v(b.doi),
    bib_url: v(b.url),
    accessed: v(b.accessed),
  };
}

/** 자료 1건 → Obsidian 호환 Markdown. frontmatter에 ID·서지정보·상태를 담아 다시 가져올 때 같은 자료로 인식한다. */
export function materialToMarkdown(m: Material) {
  const fm = stringifyYaml({
    ai_wiki_id: m.id,
    schema_version: SCHEMA_VERSION,
    title: m.title,
    source_type: m.sourceType,
    origin: m.origin,
    para: m.para,
    relevance: m.relevance,
    topic: m.topic || undefined,
    tags: m.keywords,
    url: m.url,
    youtube_id: m.youtubeId,
    file_name: m.fileName,
    file_size: m.fileSize,
    mime_type: m.mimeType,
    created: m.createdAt,
    updated: m.updatedAt,
    usage: m.usage?.length ? m.usage : undefined,
    view_status: m.viewStatus ?? (m.myView?.trim() ? '작성 중' : '미작성'),
    bib_status: m.bibStatus,
    ...bibFrontmatter(m),
    citation_included: m.citationIncluded,
    is_sample: m.isSample || undefined,
    exported_from: 'AI WIKI',
  });
  const body: string[] = [`# ${m.title}`, '', `- 주제: ${m.topic || '-'}`, `- 서지정보 상태: ${m.bibStatus}`];
  if (m.bib)
    body.push(`- 서지정보: ${[m.bib.authors?.join('; ') || m.bib.author, m.bib.year, m.bib.container, m.bib.publisher].filter(Boolean).join(' · ')}`);
  if (m.fileName) body.push(`- 파일: ${m.fileName} (${formatSize(m.fileSize)}, 브라우저 로컬 정보)`);
  if (m.content) body.push('', MD_HEADINGS.content, '', m.content);
  if (m.analysis) {
    const a = m.analysis;
    body.push(
      '',
      MD_HEADINGS.analysis,
      '',
      `**요약**: ${a.summary}`,
      '',
      `- 논문 관련도: ${a.relevance}/5`,
      `- 판단 근거: ${a.rationale}`,
      `- 현재 논문과의 접점: ${a.connection}`,
      '',
      '**핵심 인사이트**',
      ...a.insights.map((i) => `- ${i}`),
    );
  }
  if (m.transcript) {
    body.push('', MD_HEADINGS.transcript, '', ...m.transcript.points.map((p) => `- ${p}`), '');
    body.push(...m.transcript.segments.map((s) => `- \`${s.time}\` ${s.text}`));
  }
  // 내 관점은 비어 있어도 섹션을 만들어 Obsidian에서 바로 작성할 수 있게 한다.
  body.push('', MD_HEADINGS.view, '', m.myView?.trim() ? m.myView : MD_VIEW_PLACEHOLDER);
  if (m.researchLink) body.push('', MD_HEADINGS.link, '', m.researchLink);
  if (m.researchMemo) body.push('', MD_HEADINGS.memo, '', m.researchMemo);
  return ['---', fm, '---', '', ...body, ''].join('\n');
}

export function materialToText(m: Material) {
  return materialToMarkdown(m)
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
}

/** 간단한 Markdown → HTML 변환 (제목/목록/굵게/문단만 지원) */
export function markdownToHtml(md: string) {
  const lines = md.replace(/^---[\s\S]*?---\n/, '').split('\n');
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (!li && inList) {
      out.push('</ul>');
      inList = false;
    }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export function wrapHtml(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.75;color:#222}h1{border-bottom:2px solid #333;padding-bottom:8px}h2{margin-top:2em;color:#2b4a7a}code{background:#f2f2f2;padding:1px 4px;border-radius:3px}.note{font-size:12px;color:#888;border-top:1px solid #ddd;margin-top:3em;padding-top:8px}</style>
</head><body>
${bodyHtml}
<p class="note">AI WIKI에서 내보낸 문서입니다. "Demo" 표시 내용은 실제 AI 분석 결과가 아닌 샘플입니다.</p>
</body></html>`;
}
