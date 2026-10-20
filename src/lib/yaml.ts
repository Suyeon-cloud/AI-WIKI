/**
 * Markdown frontmatter용 YAML 하위집합 파서/직렬화.
 * 외부 의존성 없이 Obsidian 속성(properties)에서 쓰는 형식만 다룬다:
 * - key: 스칼라 (따옴표 문자열 "..." / '...', 숫자, true/false, null, 일반 문자열)
 * - key: [a, "b"]  (flow 목록)
 * - key:\n  - a\n  - b  (block 목록)
 * - key: |  /  key: >  (여러 줄 문자열)
 * 중첩 객체는 지원하지 않으며, 내보낼 때는 평평한 키를 사용한다.
 */

export type YamlValue = string | number | boolean | null | YamlValue[];

/* ───────── 파싱 ───────── */

function parseDoubleQuoted(s: string): string {
  // YAML 큰따옴표 문자열 이스케이프는 JSON과 거의 같다.
  try {
    return JSON.parse(s) as string;
  } catch {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/** 따옴표 밖의 ' #' 주석 제거 */
function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '') return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return parseDoubleQuoted(s);
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) return splitFlow(s.slice(1, -1)).map(parseScalar);
  if (s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** flow 목록 안의 쉼표 분리 (따옴표 안 쉼표는 유지) */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const indentOf = (line: string) => line.length - line.trimStart().length;

export function parseYaml(src: string): Record<string, YamlValue> {
  const lines = src.split(/\r?\n/);
  const out: Record<string, YamlValue> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#') || indentOf(line) > 0) {
      i++;
      continue;
    }
    const kv = line.match(/^([^:#\s][^:]*?):(?:\s+(.*))?$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1].trim().replace(/^["']|["']$/g, '');
    const rest = stripComment(kv[2] ?? '').trim();
    i++;
    if (rest === '|' || rest === '>' || /^[|>][+-]?$/.test(rest)) {
      // 여러 줄 문자열
      const block: string[] = [];
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) block.push(lines[i++]);
      while (block.length && !block[block.length - 1].trim()) block.pop();
      const ind = Math.min(...block.filter((b) => b.trim()).map(indentOf), Infinity);
      const body = block.map((b) => b.slice(Number.isFinite(ind) ? ind : 0));
      out[key] = rest.startsWith('|') ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim();
    } else if (rest === '') {
      // block 목록 또는 빈 값
      const items: YamlValue[] = [];
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0 || /^-\s/.test(lines[i]))) {
        const m = lines[i].match(/^\s*-\s*(.*)$/);
        if (m) items.push(parseScalar(stripComment(m[1])));
        i++;
      }
      out[key] = items.length ? items : null;
    } else out[key] = parseScalar(rest);
  }
  return out;
}

/* ───────── 직렬화 ───────── */

/** 항상 큰따옴표 문자열로 쓴다 — JSON 문자열은 유효한 YAML 큰따옴표 스칼라다. */
const q = (s: string) => JSON.stringify(s);

export function stringifyYaml(obj: Record<string, YamlValue | undefined>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) lines.push(`${k}: []`);
      else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${typeof item === 'string' ? q(item) : String(item)}`);
      }
    } else if (typeof v === 'string') lines.push(`${k}: ${q(v)}`);
    else lines.push(`${k}: ${v === null ? 'null' : String(v)}`);
  }
  return lines.join('\n');
}
