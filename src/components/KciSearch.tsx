import { useRef, useState } from 'react';
import { useStore } from '../store';
import { normalizeDoi } from '../lib/citation';
import { KCI_FIELDS, recordToMeta, searchKci, type KciField, type KciRecord, type KciResult } from '../lib/kci-search';
import { Empty } from './ui';
import { KciReview, type ReviewItem } from './KciImport';

const keyOf = (r: KciRecord) => r.id || r.doi || r.url || r.title;

/** KCI Open API로 논문을 검색하고, 체크한 논문만 확인 창을 거쳐 가져온다 */
export function KciSearch() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [field, setField] = useState<KciField>('title');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<KciResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, KciRecord>>(new Map());
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  // 페이지를 넘겨도 처음 검색한 조건을 유지한다
  const asked = useRef({ q: '', field: 'title' as KciField, from: '', to: '' });

  const duplicateOf = (r: KciRecord) => {
    const doi = normalizeDoi(r.doi);
    const title = r.title.replace(/\s+/g, '').toLowerCase();
    return state.materials.find((m) => (doi && normalizeDoi(m.bib?.doi) === doi) || (m.bib?.title ?? m.title).replace(/\s+/g, '').toLowerCase() === title)?.title;
  };

  async function run(page: number) {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setError(null);
    try {
      const data = await searchKci({ ...asked.current, page }, c.signal);
      setResult(data);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ctrl.current === c) setBusy(false);
    }
  }

  function submit() {
    if (!q.trim()) return setError('검색어를 입력하세요.');
    asked.current = { q: q.trim(), field, from: from.trim(), to: to.trim() };
    void run(1);
  }

  const toggle = (r: KciRecord) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(keyOf(r))) n.delete(keyOf(r));
      else n.set(keyOf(r), r);
      return n;
    });

  function openReview() {
    setReview(
      [...picked.values()].map((r) => ({
        key: keyOf(r),
        src: { file: new Blob(), name: r.title, size: 0, from: 'KCI API', url: r.url },
        meta: recordToMeta(r),
        duplicateOf: duplicateOf(r),
      })),
    );
  }

  const pages = result ? Math.ceil(result.total / result.pageSize) : 0;

  return (
    <>
      <div className="kci-search-bar">
        <select value={field} onChange={(e) => setField(e.target.value as KciField)} aria-label="검색 대상">
          {KCI_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <input className="kci-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="예: 모션그래픽, 중국 드라마, 한중 문화콘텐츠" />
        <input className="kci-year" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="시작 연도" aria-label="시작 연도" />
        <input className="kci-year" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="끝 연도" aria-label="끝 연도" />
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '검색 중…' : '검색'}</button>
      </div>
      {error && <p className="notice err" role="alert">{error}</p>}

      {result && (
        <>
          <div className="actions kci-result-head">
            <span className="small muted">
              총 {result.total.toLocaleString()}건{pages > 1 && ` · ${result.page} / ${pages.toLocaleString()}쪽`}
            </span>
            <button className="btn btn-primary btn-sm" onClick={openReview} disabled={!picked.size}>선택한 {picked.size}건 가져오기</button>
            {picked.size > 0 && <button className="link small" onClick={() => setPicked(new Map())}>선택 해제</button>}
          </div>
          {result.items.length === 0 ? (
            <Empty>검색 결과가 없습니다. 다른 검색어나 검색 대상을 시도해 보세요.</Empty>
          ) : (
            <ul className="review-list">
              {result.items.map((r) => {
                const dup = duplicateOf(r);
                const abstract = r.abstractKo || r.abstractEn;
                return (
                  <li key={keyOf(r)}>
                    <div className="review-row" onClick={() => toggle(r)}>
                      <input type="checkbox" checked={picked.has(keyOf(r))} readOnly aria-label={`${r.title} 선택`} />
                      <div className="review-main">
                        <b>{r.title}</b>
                        <span className="muted small">
                          {[r.authors.join(', ') || '저자 미확인', r.journal, r.year, r.volume && `${r.volume}${r.issue ? `(${r.issue})` : ''}`, r.pages && `pp. ${r.pages}`].filter(Boolean).join(' · ')}
                        </span>
                        {abstract && (
                          <details className="kci-abstract" onClick={(e) => e.stopPropagation()}>
                            <summary>초록 보기</summary>
                            <p>{abstract}</p>
                          </details>
                        )}
                        <span className="review-tags">
                          {r.doi && <span className="chip">DOI</span>}
                          {!abstract && <span className="warn-tag">초록 없음</span>}
                          {r.citations > 0 && <span className="chip chip-muted">KCI 피인용 {r.citations}</span>}
                          {dup && <span className="warn-tag">이미 있음</span>}
                          {r.url && <a className="link small" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>KCI에서 보기 ↗</a>}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <div className="actions kci-pager">
              <button className="btn btn-sm" disabled={busy || result.page <= 1} onClick={() => run(result.page - 1)}>이전</button>
              <button className="btn btn-sm" disabled={busy || result.page >= pages} onClick={() => run(result.page + 1)}>다음</button>
            </div>
          )}
        </>
      )}
      {review && <KciReview items={review} onClose={() => setReview(null)} onDone={() => setPicked(new Map())} />}
    </>
  );
}
