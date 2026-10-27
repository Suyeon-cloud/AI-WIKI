import { useEffect, useRef, useState } from 'react';
import { useProject } from '../store';
import { aiState, AiError } from '../lib/ai';
import { judgeRelevance, type RelevanceInput } from '../lib/relevance';

export interface RelChoice {
  relevance: number;
  reason?: string;
  by: 'AI' | '연구자';
}

/**
 * 가져오기 확인 화면용: 대상 자료의 관련도를 AI가 판단해 초기값으로 채운다 (연구자가 바꾸면 '연구자'로 표시)
 * targets가 바뀌면(새 가져오기) 다시 판단한다. AI 키가 없거나 프로젝트가 없으면 판단하지 않는다.
 */
export function useAiRelevance(targets: RelevanceInput[] | null) {
  const { project } = useProject();
  const [rel, setRel] = useState<Record<string, RelChoice>>({});
  const [status, setStatus] = useState<{ kind: 'idle' | 'running' | 'done' | 'off' | 'error'; done?: number; total?: number; message?: string }>({ kind: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  const sig = targets?.map((t) => t.key).join('|') ?? '';

  useEffect(() => {
    setRel({});
    if (!targets?.length) return setStatus({ kind: 'idle' });
    if (!aiState().configured || !project) return setStatus({ kind: 'off' });
    const c = new AbortController();
    ctrl.current = c;
    setStatus({ kind: 'running', done: 0, total: targets.length });
    judgeRelevance(
      project,
      targets,
      (map, done) => {
        if (c.signal.aborted) return;
        setRel((prev) => {
          const next = { ...prev };
          // 연구자가 이미 고친 값은 덮어쓰지 않는다
          map.forEach((v, k) => {
            if (next[k]?.by !== '연구자') next[k] = { ...v, by: 'AI' };
          });
          return next;
        });
        setStatus({ kind: 'running', done, total: targets.length });
      },
      c.signal,
    )
      .then(() => !c.signal.aborted && setStatus({ kind: 'done', total: targets.length }))
      .catch((e) => !c.signal.aborted && setStatus({ kind: 'error', message: e instanceof AiError ? e.message : String(e) }));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, project?.id]);

  const choose = (key: string, relevance: number) => setRel((p) => ({ ...p, [key]: { relevance, by: '연구자', reason: p[key]?.reason } }));
  const cancel = () => {
    ctrl.current?.abort();
    setStatus({ kind: 'idle' });
  };
  return { rel, choose, status, cancel, running: status.kind === 'running' };
}

/** 한 줄 안내: AI 판단 진행 상황 */
export function RelevanceStatus({ status, onCancel }: { status: ReturnType<typeof useAiRelevance>['status']; onCancel: () => void }) {
  if (status.kind === 'running')
    return (
      <span className="rel-status">
        AI가 관련도를 판단하는 중… {status.done ?? 0} / {status.total}{' '}
        <button className="link small" onClick={onCancel}>
          건너뛰기
        </button>
      </span>
    );
  if (status.kind === 'done') return <span className="rel-status">AI가 관련도를 제안했습니다 — 확인 후 필요하면 바꾸세요</span>;
  if (status.kind === 'off') return <span className="rel-status muted">관련도는 기본 3 — Claude API 키를 넣으면 AI가 제안합니다</span>;
  if (status.kind === 'error') return <span className="rel-status warn-text">AI 관련도 판단 실패: {status.message} (기본 3, 직접 지정 가능)</span>;
  return null;
}

/** 관련도 선택 (AI 제안이면 'AI' 표시, 마우스를 올리면 이유) */
export function RelevancePick({ value, choice, onChange }: { value: number; choice?: RelChoice; onChange: (v: number) => void }) {
  const v = choice?.relevance ?? value;
  return (
    <span className="rel-pick" title={choice?.reason ? `AI 판단: ${choice.reason}` : undefined} onClick={(e) => e.stopPropagation()}>
      <select value={v} onChange={(e) => onChange(Number(e.target.value))} aria-label="논문 관련도">
        {[5, 4, 3, 2, 1].map((r) => (
          <option key={r} value={r}>
            관련도 {r}
          </option>
        ))}
      </select>
      {choice && <span className={choice.by === 'AI' ? 'rel-by ai' : 'rel-by'}>{choice.by}</span>}
    </span>
  );
}
