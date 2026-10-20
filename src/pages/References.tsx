import { useMemo, useState } from 'react';
import type { Bib, Material, RefType } from '../types';
import { useStore } from '../store';
import { SOURCE_TYPES, downloadFile, escapeHtml } from '../lib/utils';
import {
  CITATION_STYLES,
  REF_TYPES,
  REF_TYPE_LABEL,
  TYPE_FIELDS,
  bibAuthors,
  checkBib,
  fieldLabel,
  formatCitation,
  normalizeDoi,
  sameAuthorYear,
  segsToHtml,
  segsToText,
  sortForStyle,
  type BibField,
  type CitationStyle,
  type Seg,
} from '../lib/citation';
import { Card, Empty, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';

/** 자료 출처 유형으로 서지 유형 기본값 추정 (사용자가 바꿀 수 있음) */
const defaultType = (m: Material): RefType =>
  m.sourceType === 'YouTube' ? 'video' : m.sourceType === 'Web' ? 'web' : 'journal';

function Citation({ segs }: { segs: Seg[] }) {
  return <>{segs.map((s, i) => (typeof s === 'string' ? <span key={i}>{s}</span> : <i key={i}>{s.i}</i>))}</>;
}

type Form = Record<Exclude<BibField, 'authors' | 'editors'>, string> & { authors: string; editors: string; type: RefType };

function toForm(m: Material): Form {
  const b = m.bib;
  // v1 서지정보(유형 없음)의 '학술지/발행처' 값은 유형이 학술지일 때 학술지명 칸으로 옮겨 보여준다 (저장 전 확인)
  const legacy = b && !b.type;
  const type = b?.type ?? defaultType(m);
  return {
    type,
    authors: bibAuthors(b).join('\n'),
    year: b?.year ?? '',
    title: b?.title ?? m.title,
    container: b?.container ?? (legacy && type === 'journal' ? b.publisher : ''),
    publisher: legacy && type === 'journal' ? '' : b?.publisher ?? '',
    volume: b?.volume ?? '',
    issue: b?.issue ?? '',
    pages: b?.pages ?? '',
    edition: b?.edition ?? '',
    editors: (b?.editors ?? []).join('\n'),
    place: b?.place ?? '',
    degree: b?.degree ?? '',
    doi: b?.doi ?? '',
    url: b?.url ?? '',
    accessed: b?.accessed ?? '',
  };
}

function fromForm(f: Form, m: Material): Bib {
  const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const v = (s: string) => s.trim() || undefined;
  const fields = new Set(TYPE_FIELDS[f.type]);
  const pick = (k: BibField, val: string | undefined) => (fields.has(k) ? val : undefined);
  const authors = lines(f.authors);
  const title = f.title.trim();
  return {
    type: f.type,
    author: authors.join('; '),
    authors,
    year: f.year.trim(),
    publisher: pick('publisher', f.publisher.trim()) ?? '',
    title: title && title !== m.title ? title : undefined, // 자료 제목과 같으면 따로 저장하지 않음
    container: pick('container', v(f.container)),
    volume: pick('volume', v(f.volume)),
    issue: pick('issue', v(f.issue)),
    pages: pick('pages', v(f.pages)),
    edition: pick('edition', v(f.edition)),
    editors: fields.has('editors') ? lines(f.editors) : undefined,
    place: pick('place', v(f.place)),
    degree: pick('degree', f.degree === '석사' || f.degree === '박사' ? f.degree : undefined) as Bib['degree'],
    doi: pick('doi', normalizeDoi(f.doi) || undefined),
    url: pick('url', v(f.url)),
    accessed: pick('accessed', v(f.accessed)),
  };
}

function BibEditor({ m, style, onClose }: { m: Material; style: CitationStyle; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const [f, setF] = useState<Form>(() => toForm(m));
  const set = (k: keyof Form, val: string) => setF((p) => ({ ...p, [k]: val }));

  const draft: Material = { ...m, bib: fromForm(f, m) };
  const check = checkBib(draft);
  const preview = formatCitation(draft, style);

  const input = (k: BibField) => {
    const label = fieldLabel(f.type, k);
    if (k === 'authors' || k === 'editors')
      return (
        <label key={k} className="span-2">
          {label}
          <textarea rows={3} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={'홍길동\nSmith, John A.'} />
        </label>
      );
    if (k === 'degree')
      return (
        <label key={k}>
          {label}
          <select value={f.degree} onChange={(e) => set('degree', e.target.value)}>
            <option value="">선택</option>
            <option>석사</option>
            <option>박사</option>
          </select>
        </label>
      );
    return (
      <label key={k} className={k === 'title' || k === 'container' || k === 'url' ? 'span-2' : ''}>
        {label}
        <input
          type={k === 'accessed' ? 'date' : 'text'}
          value={f[k]}
          onChange={(e) => set(k, e.target.value)}
          placeholder={k === 'url' && m.url ? m.url : k === 'year' ? 'YYYY' : ''}
        />
      </label>
    );
  };

  return (
    <tr className="bib-edit">
      <td colSpan={7}>
        <div className="bib-head">
          <label>
            자료 유형
            <select value={f.type} onChange={(e) => set('type', e.target.value)}>
              {REF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <span className="muted small">
            원문에서 직접 확인한 정보만 입력하세요. 영문 개인 저자는 '성, 이름'(예: Smith, John A.), 한글 이름·기관명은 그대로 입력합니다.
            제목의 대소문자는 바꾸지 않습니다.
          </span>
        </div>
        {m.bib && !m.bib.type && (
          <p className="notice">이전 버전에서 입력한 서지정보입니다. 기존 '학술지/발행처' 값을 아래 칸에 옮겨 두었으니 유형과 함께 확인한 뒤 저장하세요.</p>
        )}
        <div className="form-grid bib-grid">{TYPE_FIELDS[f.type].map(input)}</div>
        <div className="bib-preview">
          <span className="field-label">{style} 미리보기</span>
          {preview ? (
            <p><Citation segs={preview} /></p>
          ) : (
            <p className="warn-text">완성되지 않음 — 필요: {check.missing.join(', ')}</p>
          )}
          {check.warnings.map((w) => <p key={w} className="muted small">· {w}</p>)}
        </div>
        <div className="actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              dispatch({ type: 'update', id: m.id, patch: { bib: draft.bib } });
              toast(check.complete ? '서지정보를 저장했습니다.' : `저장했습니다. 아직 확인 필요: ${check.missing.join(', ')}`, check.complete ? 'success' : 'info');
              onClose();
            }}
          >
            저장
          </button>
          <button className="btn btn-sm" onClick={onClose}>닫기</button>
        </div>
      </td>
    </tr>
  );
}

export function References() {
  const { state, dispatch, toast } = useStore();
  const [rel, setRel] = useState('3');
  const [src, setSrc] = useState('전체');
  const [bibFilter, setBibFilter] = useState('전체');
  const [style, setStyle] = useState<CitationStyle>(CITATION_STYLES[0]);
  const [editId, setEditId] = useState<string | null>(null);

  const list = useMemo(
    () =>
      state.materials
        .filter(
          (m) =>
            m.relevance >= Number(rel) &&
            (src === '전체' || m.sourceType === src) &&
            (bibFilter === '전체' || m.bibStatus === bibFilter),
        )
        .sort((a, b) => b.relevance - a.relevance),
    [state.materials, rel, src, bibFilter],
  );
  const chosen = state.materials.filter((m) => m.citationIncluded);
  const ready = sortForStyle(chosen.filter((m) => checkBib(m).complete), style);
  const pending = chosen.filter((m) => !checkBib(m).complete);
  const dupes = sameAuthorYear(ready);
  const formatted = ready.map((m) => ({ m, segs: formatCitation(m, style)! }));

  function exportList(kind: 'txt' | 'html') {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'txt') downloadFile(`references-${stamp}.txt`, formatted.map((x) => segsToText(x.segs)).join('\n'), 'text/plain');
    else
      downloadFile(
        `references-${stamp}.html`,
        `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>참고문헌</title><style>body{font-family:'Times New Roman','Batang',serif;max-width:760px;margin:40px auto;line-height:1.8}p{padding-left:2em;text-indent:-2em;margin:0 0 .6em}</style></head><body><h1>참고문헌 (${escapeHtml(style)})</h1>\n${formatted.map((x) => `<p>${segsToHtml(x.segs)}</p>`).join('\n')}\n</body></html>`,
        'text/html',
      );
    toast(`완성된 참고문헌 ${formatted.length}건을 ${kind.toUpperCase()}로 내보냈습니다.${pending.length ? ` 확인 필요 ${pending.length}건은 제외했습니다.` : ''}`);
  }

  return (
    <>
      <PageHeader
        title="참고문헌"
        desc="논문 관련도가 높은 자료를 참고문헌 후보로 선별하고, 자료 유형별 서지정보를 확인해 인용 서식을 만듭니다."
        badges={<><StatusBadge s="real">선택·서지 입력·서식</StatusBadge><StatusBadge s="demo">자동 서지 추출 Demo</StatusBadge></>}
      />

      <div className="notice">
        서지정보는 자동으로 생성하지 않습니다. 자료 유형별 필수 항목(예: 학술지 논문은 저자·연도·제목·학술지명·권·쪽)이 모두 입력되어야{' '}
        <span className="ok-tag">서지정보 입력됨</span>이 되고, 부족하면 <span className="warn-tag">서지정보 확인 필요</span>로 남아 완성 목록에서
        제외됩니다. 서식은 각 양식의 일반 규칙을 적용한 것이므로 제출 전 학과·학술지 규정으로 최종 확인하세요.
      </div>

      <div className="filters">
        <label>
          관련도
          <select value={rel} onChange={(e) => setRel(e.target.value)}>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r}등급 이상</option>)}
          </select>
        </label>
        <label>
          출처 유형
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option>전체</option>
            {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          서지 상태
          <select value={bibFilter} onChange={(e) => setBibFilter(e.target.value)}>
            <option>전체</option>
            <option>서지정보 확인 필요</option>
            <option>서지정보 입력됨</option>
          </select>
        </label>
        <label>
          인용 양식
          <select value={style} onChange={(e) => setStyle(e.target.value as CitationStyle)}>
            {CITATION_STYLES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <span className="muted small">후보 {list.length}건 · 선택 {chosen.length}건 (완성 {ready.length} · 확인 필요 {pending.length})</span>
      </div>

      <Card title="참고문헌 후보">
        {list.length === 0 ? (
          <Empty>조건에 맞는 후보가 없습니다.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>선택</th>
                <th>제목</th>
                <th>유형</th>
                <th>관련도</th>
                <th>서지정보 상태</th>
                <th>입력된 서지정보</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.flatMap((m) => {
                const check = checkBib(m);
                const rows = [
                  <tr key={m.id} className={m.citationIncluded ? '' : 'excluded'}>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={m.citationIncluded}
                          onChange={(e) => dispatch({ type: 'update', id: m.id, patch: { citationIncluded: e.target.checked } })}
                        />
                        <span>{m.citationIncluded ? '선택' : '제외'}</span>
                      </label>
                    </td>
                    <td className="cell-title">{m.title}</td>
                    <td><SourceTag type={m.sourceType} /></td>
                    <td><Relevance value={m.relevance} /></td>
                    <td>
                      {check.complete ? (
                        <span className="ok-tag">서지정보 입력됨</span>
                      ) : (
                        <span className="warn-tag" title={`필요: ${check.missing.join(', ')}`}>서지정보 확인 필요</span>
                      )}
                    </td>
                    <td className="muted small">
                      {m.bib?.type && <b>{REF_TYPE_LABEL[m.bib.type]}</b>}
                      {m.bib?.type && ' · '}
                      {bibAuthors(m.bib).length ? `${bibAuthors(m.bib).join('; ')} · ${m.bib?.year || '연도 없음'}` : '-'}
                      {!check.complete && m.bib && <div className="warn-text">필요: {check.missing.join(', ')}</div>}
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setEditId(editId === m.id ? null : m.id)}>
                        서지정보 입력
                      </button>
                    </td>
                  </tr>,
                ];
                if (editId === m.id) rows.push(<BibEditor key={`${m.id}-edit`} m={m} style={style} onClose={() => setEditId(null)} />);
                return rows;
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title={`참고문헌 목록 미리보기 — ${style}`}
        extra={
          <div className="btn-group">
            <button className="btn btn-sm" disabled={!ready.length} onClick={() => exportList('txt')}>TXT 내보내기</button>
            <button className="btn btn-sm" disabled={!ready.length} onClick={() => exportList('html')} title="기울임꼴을 유지합니다 (워드에 붙여넣기용)">
              HTML 내보내기
            </button>
          </div>
        }
      >
        {chosen.length === 0 ? (
          <Empty>선택된 참고문헌이 없습니다.</Empty>
        ) : (
          <>
            {ready.length === 0 ? (
              <p className="muted small">완성된 참고문헌이 없습니다. 아래 확인 필요 자료의 서지정보를 입력하세요.</p>
            ) : (
              <ol className="ref-list">
                {formatted.map(({ m, segs }) => (
                  <li key={m.id}><Citation segs={segs} /></li>
                ))}
              </ol>
            )}
            {dupes.length > 0 && (
              <p className="notice">같은 저자·같은 연도 자료가 있습니다: {dupes.join(', ')} — APA 등에서는 연도에 a, b를 붙여 구분하세요 (예: 2024a).</p>
            )}
            {pending.length > 0 && (
              <div className="ref-pending">
                <span className="field-label">확인 필요 — 목록·내보내기에서 제외됨 ({pending.length}건)</span>
                <ul>
                  {pending.map((m) => (
                    <li key={m.id}>
                      <span className="warn-tag">확인 필요</span> {m.title}
                      <span className="muted small"> — {checkBib(m).missing.join(', ')}</span>{' '}
                      <button className="link small" onClick={() => { setRel('1'); setSrc('전체'); setBibFilter('전체'); setEditId(m.id); }}>입력</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
