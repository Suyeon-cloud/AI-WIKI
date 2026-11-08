/**
 * 본문 각주 표기 (원고 데이터 구조는 그대로, 본문 글자 안에 쓴다)
 * - 본문: `…이다.[^1]`   정의: 장 안 아무 줄에 `[^1]: 각주 내용`
 * - 정의 줄은 본문에서 빠지고, 표시는 HWPX에서 한글 각주가 된다. 번호는 문서 전체에서 1부터 이어진다.
 * - 정의가 없거나 내용이 빈 표시는 각주로 바꾸지 않고 글자 그대로 둔다 (집필 화면에서 경고).
 * - 표시 이름(1, a, note 등)은 장마다 따로 정한다.
 */
const DEF = /^\s*\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const MARK = /\[\^([^\]\s]+)\](?!:)/g;

export const hasFootnoteSyntax = (text: string) => text.includes('[^');

export interface ChapterNotes {
  body: string; // 정의 줄을 뺀 본문
  defs: Map<string, string>;
  duplicates: string[]; // 두 번 이상 정의된 표시 이름 (처음 정의를 사용)
}
export function splitNotes(text: string): ChapterNotes {
  const defs = new Map<string, string>();
  const duplicates: string[] = [];
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = DEF.exec(line);
    if (!m) { lines.push(line); continue; }
    if (defs.has(m[1])) duplicates.push(m[1]);
    else defs.set(m[1], m[2].trim());
  }
  return { body: lines.join('\n'), defs, duplicates };
}

export type NoteSeg = { text: string } | { note: string };
/** 한 문단 → 글자/각주 조각. 각주로 바뀌는 표시가 없으면 글자 조각 하나 */
export function segmentLine(line: string, defs: Map<string, string>): NoteSeg[] {
  const out: NoteSeg[] = [];
  let last = 0;
  for (const m of line.matchAll(MARK)) {
    const def = defs.get(m[1]);
    if (!def) continue;
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    out.push({ note: def });
    last = m.index! + m[0].length;
  }
  if (last < line.length || !out.length) out.push({ text: line.slice(last) });
  return out;
}
/** 목차 등 글자만 필요한 곳: 각주 표시를 지운다 */
export const stripMarks = (s: string) => s.replace(MARK, '');

export type NoteIssueKind = '정의 없음' | '중복 정의' | '사용되지 않음' | '내용 없음' | '여러 번 참조';
export interface NoteIssue { chapter: string; label: string; kind: NoteIssueKind }
/** 각주 점검: HWPX에 들어갈 각주 수와 경고 */
export function checkFootnotes(chapters: { title: string; text: string }[]): { count: number; issues: NoteIssue[] } {
  let count = 0;
  const issues: NoteIssue[] = [];
  for (const ch of chapters) {
    if (!hasFootnoteSyntax(ch.text)) continue;
    const { body, defs, duplicates } = splitNotes(ch.text);
    const used = new Map<string, number>();
    for (const m of body.matchAll(MARK)) used.set(m[1], (used.get(m[1]) ?? 0) + 1);
    for (const [label, n] of used) {
      if (!defs.has(label)) issues.push({ chapter: ch.title, label, kind: '정의 없음' });
      else if (!defs.get(label)) issues.push({ chapter: ch.title, label, kind: '내용 없음' });
      else {
        count += n;
        if (n > 1) issues.push({ chapter: ch.title, label, kind: '여러 번 참조' });
      }
    }
    for (const label of new Set(duplicates)) issues.push({ chapter: ch.title, label, kind: '중복 정의' });
    for (const label of defs.keys()) if (!used.has(label)) issues.push({ chapter: ch.title, label, kind: '사용되지 않음' });
  }
  return { count, issues };
}
