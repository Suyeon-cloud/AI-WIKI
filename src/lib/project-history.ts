/**
 * 프로젝트별 저장 이력: 서버 저장이 성공한 뒤, 직전에 저장된 상태와 비교해 내용이 바뀐 프로젝트에만 '저장' 이력을 남긴다.
 * - events(이력 자체)는 비교하지 않는다 → 이력 기록 때문에 생긴 다음 저장은 다시 기록하지 않아 반복이 생기지 않는다.
 * - 같은 프로젝트의 '저장' 이력이 10분 안에 있으면 새로 쌓지 않고 그 이력의 시각·요약을 갱신한다.
 */
import type { AppState, ProjectEvent } from '../types';

export const SAVE_MERGE_MS = 10 * 60 * 1000;
export const MAX_EVENTS = 500;

export interface SaveCounts { added: number; updated: number; removed: number; draft: boolean; outputs: number; info: boolean }
export interface SaveChange { projectId: string; counts: SaveCounts }

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const byProject = <T extends { id: string }>(list: T[], pid: (x: T) => string | undefined) => {
  const m = new Map<string, Map<string, T>>();
  for (const x of list) {
    const p = pid(x);
    if (!p) continue;
    if (!m.has(p)) m.set(p, new Map());
    m.get(p)!.set(x.id, x);
  }
  return m;
};

/** 직전 저장 상태(prev)와 이번에 저장된 상태(next)에서 내용이 바뀐 프로젝트 (이번에 남아 있는 프로젝트만) */
export function changedProjects(prev: AppState, next: AppState): SaveChange[] {
  const pm = byProject(prev.materials, (m) => m.projectId);
  const nm = byProject(next.materials, (m) => m.projectId);
  const po = byProject(prev.aiOutputs, (o) => o.projectId);
  const no = byProject(next.aiOutputs, (o) => o.projectId);
  const out: SaveChange[] = [];
  for (const p of next.projects) {
    const before = pm.get(p.id) ?? new Map();
    const after = nm.get(p.id) ?? new Map();
    let added = 0, updated = 0, removed = 0;
    for (const [id, m] of after) {
      const old = before.get(id);
      if (!old) added++;
      else if (!same(old, m)) updated++;
    }
    for (const id of before.keys()) if (!after.has(id)) removed++;
    const oBefore = po.get(p.id) ?? new Map();
    const oAfter = no.get(p.id) ?? new Map();
    let outputs = 0;
    for (const [id, o] of oAfter) if (!same(oBefore.get(id), o)) outputs++;
    for (const id of oBefore.keys()) if (!oAfter.has(id)) outputs++;
    const draft = !same(prev.theses.find((t) => t.projectId === p.id), next.theses.find((t) => t.projectId === p.id));
    const info = !same(prev.projects.find((x) => x.id === p.id), p);
    const counts = { added, updated, removed, draft, outputs, info };
    if (added || updated || removed || draft || outputs || info) out.push({ projectId: p.id, counts });
  }
  return out;
}

const PREFIX = '저장 — ';
const PARTS: [keyof SaveCounts, string][] = [['added', '자료 추가'], ['updated', '자료 수정'], ['removed', '자료 삭제'], ['outputs', 'AI 결과물'], ['draft', '원고'], ['info', '프로젝트 정보']];

export function formatSave(c: SaveCounts): string {
  const parts = PARTS.filter(([k]) => c[k]).map(([k, label]) => (typeof c[k] === 'number' ? `${label} ${c[k]}건` : label));
  return PREFIX + (parts.join(', ') || '변경 사항');
}
/** 화면 표시용: '저장' 배지와 겹치지 않도록 저장 이력 문구 앞의 '저장 — '만 뺀다 (저장 데이터는 그대로) */
export const eventLabel = (e: Pick<ProjectEvent, 'kind' | 'text'>) => (e.kind === '저장' && e.text.startsWith(PREFIX) ? e.text.slice(PREFIX.length) : e.text);

/** 이 모듈이 만든 요약 문구를 다시 숫자로 (묶을 때 더하기 위해). 형식이 다르면 null */
export function parseSave(text: string): SaveCounts | null {
  if (!text.startsWith(PREFIX)) return null;
  const c: SaveCounts = { added: 0, updated: 0, removed: 0, draft: false, outputs: 0, info: false };
  for (const part of text.slice(PREFIX.length).split(', ')) {
    const hit = PARTS.find(([, label]) => part === label || part.startsWith(`${label} `));
    if (!hit) continue;
    const [k] = hit;
    if (typeof c[k] === 'number') (c[k] as number) = Number(/(\d+)건$/.exec(part)?.[1] ?? 0);
    else (c[k] as boolean) = true;
  }
  return c;
}
const mergeCounts = (a: SaveCounts, b: SaveCounts): SaveCounts => ({
  added: a.added + b.added, updated: a.updated + b.updated, removed: a.removed + b.removed,
  outputs: a.outputs + b.outputs, draft: a.draft || b.draft, info: a.info || b.info,
});

/** store의 'recordSaves' 동작: 지금 남아 있는 프로젝트의 변경만 이력으로 남긴다 (이력 외 상태는 그대로) */
export function applySaveRecord(state: AppState, changes: SaveChange[], at: string, newId: () => string): AppState {
  const live = changes.filter((c) => state.projects.some((p) => p.id === c.projectId));
  return live.length ? { ...state, events: recordSaves(state.events, live, at, newId) } : state;
}

/** 저장 이력 추가: 같은 프로젝트의 10분 안 '저장' 이력은 갱신해 맨 앞으로, 아니면 새로 추가. 전체 500건 유지 */
export function recordSaves(events: ProjectEvent[], changes: SaveChange[], at: string, newId: () => string): ProjectEvent[] {
  let list = events;
  const now = Date.parse(at);
  for (const ch of changes) {
    const recent = list.find((e) => e.projectId === ch.projectId && e.kind === '저장');
    const prevCounts = recent ? parseSave(recent.text) : null;
    if (recent && prevCounts && now - Date.parse(recent.at) >= 0 && now - Date.parse(recent.at) < SAVE_MERGE_MS) {
      const merged = { ...recent, at, text: formatSave(mergeCounts(prevCounts, ch.counts)) };
      list = [merged, ...list.filter((e) => e !== recent)];
    } else {
      list = [{ id: newId(), projectId: ch.projectId, at, kind: '저장', text: formatSave(ch.counts) }, ...list];
    }
  }
  return list.slice(0, MAX_EVENTS);
}
