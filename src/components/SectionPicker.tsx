import { useState } from 'react';
import { ROLE_LABEL, roleOf, sectionsInPages, type FullTextDoc, type Section } from '../lib/fulltext';

const pages = (s: Section) => `p.${s.pageFrom}${s.pageTo !== s.pageFrom ? `-${s.pageTo}` : ''}`;

/**
 * 분석 실행 전 원문 조각 확인·직접 선택. 장·절 제목 인식이 틀린 PDF도 쪽 범위로 고를 수 있다.
 * sent: 실제로 AI에 보내는 원문 블록 (요청 본문에 들어가는 문자열 그대로)
 */
export function SectionPicker({ doc, ids, autoIds, budget, sent, onChange }: { doc: FullTextDoc; ids: string[]; autoIds: string[]; budget: number; sent: string; onChange: (ids: string[]) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const set = new Set(ids);
  const used = doc.sections.filter((s) => set.has(s.id)).reduce((n, s) => n + s.text.length, 0);
  const isAuto = ids.length === autoIds.length && autoIds.every((id) => set.has(id));
  const order = (next: Set<string>) => doc.sections.filter((s) => next.has(s.id)).map((s) => s.id);
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(order(next));
  };
  const lastPage = doc.sections.reduce((n, s) => Math.max(n, s.pageTo), 1);
  const f = Number(from);
  const t = Number(to || from);
  const rangeOk = Number.isInteger(f) && Number.isInteger(t) && f >= 1 && t >= 1;
  const pageIds = (add: boolean) => {
    const hit = sectionsInPages(doc.sections, f, t);
    const next = new Set(set);
    for (const id of hit) (add ? next.add(id) : next.delete(id));
    onChange(order(next));
  };

  return (
    <div className="section-picker">
      <div className="picker-head">
        <strong>AI에 보낼 원문 조각</strong>{' '}
        <span className={used > budget ? 'warn-tag' : 'muted small'}>
          {ids.length}개 · {used.toLocaleString()} / {budget.toLocaleString()}자
        </span>{' '}
        <span className="muted small">{isAuto ? '자동 선택' : '직접 선택'}</span>
      </div>
      <div className="picker-tools small">
        <button type="button" className="btn btn-sm" onClick={() => onChange(autoIds)} disabled={isAuto}>자동 선택으로</button>
        <button type="button" className="btn btn-sm" onClick={() => onChange([])} disabled={!ids.length}>모두 해제</button>
        <span className="picker-range">
          쪽 범위
          <input type="number" min={1} max={lastPage} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="시작" aria-label="시작 쪽" />
          –
          <input type="number" min={1} max={lastPage} value={to} onChange={(e) => setTo(e.target.value)} placeholder="끝" aria-label="끝 쪽" />
          <button type="button" className="btn btn-sm" disabled={!rangeOk} onClick={() => pageIds(true)}>추가</button>
          <button type="button" className="btn btn-sm" disabled={!rangeOk} onClick={() => pageIds(false)}>빼기</button>
          <span className="muted">(전체 {lastPage}쪽, 장·절 제목과 상관없이 쪽 기준)</span>
        </span>
      </div>
      <ul className="picker-list">
        {doc.sections.map((s) => (
          <li key={s.id} className={set.has(s.id) ? 'on' : ''}>
            <label>
              <input type="checkbox" checked={set.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="muted small">{pages(s)}</span> <span className="muted small">[{s.kind === 'references' ? '참고문헌' : ROLE_LABEL[roleOf(s)]}]</span> {s.title}{' '}
              <span className="muted small">{s.text.length.toLocaleString()}자</span>
            </label>
            <button type="button" className="btn-link small" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? '닫기' : '미리보기'}</button>
            {open === s.id && <pre className="picker-text">{s.text}</pre>}
          </li>
        ))}
      </ul>
      <details className="picker-sent">
        <summary className="small">실제로 보내는 원문 보기 ({sent.length.toLocaleString()}자, 장·절·쪽 표시 포함)</summary>
        <pre className="picker-text">{sent || '(선택한 조각 없음)'}</pre>
      </details>
    </div>
  );
}
