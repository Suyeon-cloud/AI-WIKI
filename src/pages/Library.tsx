import { useEffect, useMemo, useState } from 'react';
import { hasMyView, type Material, type PageKey, type Para } from '../types';
import { useStore } from '../store';
import { PARAS, SOURCE_TYPES, formatDate, formatSize, ytThumb } from '../lib/utils';
import { Card, Empty, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';
import { ImportExport } from '../components/ImportExport';

/** 관점 작성 완료 / 작성 필요 표시 */
function ViewTag({ m }: { m: Material }) {
  return hasMyView(m) ? <span className="ok-tag">작성 완료</span> : <span className="warn-tag">작성 필요</span>;
}

function Detail({ m, go }: { m: Material; go: (p: PageKey) => void }) {
  const { dispatch, toast } = useStore();
  const [title, setTitle] = useState(m.title);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setTitle(m.title);
    setEditing(false);
    setConfirmDel(false);
  }, [m.id, m.title]);

  const saveTitle = () => {
    if (!title.trim()) return toast('제목은 비워둘 수 없습니다.', 'error');
    dispatch({ type: 'update', id: m.id, patch: { title: title.trim() } });
    setEditing(false);
    toast('제목을 수정했습니다.');
  };

  return (
    <Card title="자료 상세" className="detail">
      {editing ? (
        <div className="title-edit">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveTitle()} autoFocus />
          <button className="btn btn-sm btn-primary" onClick={saveTitle}>저장</button>
          <button className="btn btn-sm" onClick={() => { setTitle(m.title); setEditing(false); }}>취소</button>
        </div>
      ) : (
        <div className="detail-title">
          <h2>{m.title}</h2>
          <button className="btn btn-sm" onClick={() => setEditing(true)}>제목 수정</button>
        </div>
      )}

      {m.youtubeId && <img className="detail-thumb" src={ytThumb(m.youtubeId)} alt="YouTube 썸네일" />}

      <dl className="meta">
        <dt>소스 유형</dt>
        <dd><SourceTag type={m.sourceType} /> {m.sourceType === 'HWPX' && <StatusBadge s="planned">파싱 추후 지원</StatusBadge>}</dd>
        <dt>자료 구분</dt>
        <dd><span className={`origin ${m.origin === 'AI 생성 자료' ? 'origin-ai' : ''}`}>{m.origin}</span>{m.isSample && <span className="chip chip-muted">샘플</span>}</dd>
        <dt>주제</dt>
        <dd>{m.topic || <span className="muted">미지정</span>}</dd>
        <dt>핵심 키워드</dt>
        <dd className="chips">{m.keywords.length ? m.keywords.map((k) => <span key={k} className="chip">{k}</span>) : <span className="muted">없음</span>}</dd>
        <dt>논문 관련도</dt>
        <dd>
          <select
            className="inline-select"
            value={m.relevance}
            onChange={(e) => dispatch({ type: 'update', id: m.id, patch: { relevance: Number(e.target.value) } })}
          >
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}등급</option>)}
          </select>
        </dd>
        <dt>PARA 분류</dt>
        <dd>
          <select
            className="inline-select"
            value={m.para}
            onChange={(e) => {
              dispatch({ type: 'update', id: m.id, patch: { para: e.target.value as Para } });
              toast(`PARA 분류를 ${e.target.value}(으)로 변경했습니다.`);
            }}
          >
            {PARAS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </dd>
        <dt>등록일</dt>
        <dd>{formatDate(m.createdAt)}{m.updatedAt && m.updatedAt !== m.createdAt && <span className="muted small">(수정 {formatDate(m.updatedAt)})</span>}</dd>
        <dt>내 관점</dt>
        <dd>
          <ViewTag m={m} />
          <button className="link small" onClick={() => go('analysis')}>{hasMyView(m) ? '보기·수정' : '작성하기'}</button>
        </dd>
        {m.usage?.length ? (
          <>
            <dt>논문 활용 위치</dt>
            <dd className="chips">{m.usage.map((u) => <span key={u} className="chip">{u}</span>)}</dd>
          </>
        ) : null}
        {m.fileName && (
          <>
            <dt>파일 정보</dt>
            <dd>
              {m.fileName} · {formatSize(m.fileSize)}
              <div className="muted small">브라우저에서 읽은 파일 정보만 저장됨 (원본 파일은 저장·업로드되지 않음)</div>
            </dd>
          </>
        )}
        <dt>원문</dt>
        <dd>
          {m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer" className="btn btn-sm">원문 열기 ↗</a>
          ) : (
            <span className="muted">{m.fileName ? '로컬 파일 — 다시 선택하여 열람' : '연결된 URL 없음 (샘플)'}</span>
          )}
        </dd>
        <dt>클라우드 저장</dt>
        <dd>
          {m.external?.driveSyncedAt ? (
            <span className="small">Google Drive에 Markdown 저장됨 ({formatDate(m.external.driveSyncedAt)})</span>
          ) : (
            <span className="muted">Google Drive에 저장 안 됨 — 연구 설정에서 저장</span>
          )}
        </dd>
      </dl>

      {m.content && (
        <details className="content-preview">
          <summary>본문 미리보기</summary>
          <pre>{m.content.slice(0, 1500)}</pre>
        </details>
      )}

      <div className="actions">
        <button className="btn btn-primary" onClick={() => go('analysis')}>AI 분석 열기</button>
        {confirmDel ? (
          <>
            <span className="small err">정말 삭제할까요?</span>
            <button
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: 'remove', id: m.id });
                toast('자료를 삭제했습니다.');
              }}
            >
              삭제
            </button>
            <button className="btn" onClick={() => setConfirmDel(false)}>취소</button>
          </>
        ) : (
          <button className="btn btn-danger-ghost" onClick={() => setConfirmDel(true)}>삭제</button>
        )}
      </div>
    </Card>
  );
}

export function Library({ go }: { go: (p: PageKey) => void }) {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('전체');
  const [rel, setRel] = useState('전체');
  const [para, setPara] = useState('전체');
  const [view, setView] = useState('전체');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return state.materials.filter(
      (m) =>
        (!s || [m.title, m.topic, ...m.keywords, m.content ?? ''].join(' ').toLowerCase().includes(s)) &&
        (src === '전체' || m.sourceType === src) &&
        (rel === '전체' || m.relevance === Number(rel)) &&
        (para === '전체' || m.para === para) &&
        (view === '전체' || (view === '작성 완료') === hasMyView(m)),
    );
  }, [state.materials, q, src, rel, para, view]);

  const selected = state.materials.find((m) => m.id === state.selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="자료 라이브러리"
        desc="샘플 자료와 직접 추가한 자료를 검색·필터링하고 PARA 체계로 정리합니다."
        badges={<><StatusBadge s="real" /><StatusBadge s="local" /></>}
      />

      <div className="filters">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목, 주제, 키워드, 본문 검색" />
        <label>
          소스 유형
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option>전체</option>
            {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          관련도
          <select value={rel} onChange={(e) => setRel(e.target.value)}>
            <option>전체</option>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}등급</option>)}
          </select>
        </label>
        <label>
          PARA
          <select value={para} onChange={(e) => setPara(e.target.value)}>
            <option>전체</option>
            {PARAS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          내 관점
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option>전체</option>
            <option>작성 완료</option>
            <option>작성 필요</option>
          </select>
        </label>
        <span className="muted small">{list.length} / {state.materials.length}건 · 관점 작성 필요 {state.materials.filter((m) => !hasMyView(m)).length}건</span>
      </div>

      <div className="lib-layout">
        <Card className="lib-table">
          {list.length === 0 ? (
            <Empty>조건에 맞는 자료가 없습니다.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>유형</th>
                  <th>구분</th>
                  <th>키워드</th>
                  <th>관련도</th>
                  <th>PARA</th>
                  <th>내 관점</th>
                  <th>등록일</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={m.id}
                    className={`clickable ${m.id === state.selectedId ? 'selected' : ''}`}
                    onClick={() => dispatch({ type: 'select', id: m.id })}
                  >
                    <td className="cell-title">
                      {m.title}
                      <div className="muted small">{m.topic}</div>
                    </td>
                    <td><SourceTag type={m.sourceType} /></td>
                    <td><span className={`origin ${m.origin === 'AI 생성 자료' ? 'origin-ai' : ''}`}>{m.origin === 'AI 생성 자료' ? 'AI 생성' : '원본'}</span></td>
                    <td className="cell-kw">{m.keywords.slice(0, 3).join(', ')}</td>
                    <td><Relevance value={m.relevance} /></td>
                    <td><span className={`para para-${m.para.toLowerCase()}`}>{m.para}</span></td>
                    <td><ViewTag m={m} /></td>
                    <td className="muted nowrap">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="lib-side">
          {selected ? <Detail m={selected} go={go} /> : <Card title="자료 상세"><Empty>목록에서 자료를 선택하세요.</Empty></Card>}
          <ImportExport selected={selected} />
        </div>
      </div>
    </>
  );
}
