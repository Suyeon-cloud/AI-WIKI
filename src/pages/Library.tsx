import { useEffect, useMemo, useState } from 'react';
import { hasMyView, type Material, type Para } from '../types';
import { useStore, useProject } from '../store';
import { PARAS, SOURCE_TYPES, formatDate, formatSize, ytThumb } from '../lib/utils';
import { formatCitation, segsToText } from '../lib/citation';
import { DriveError } from '../lib/drive';
import { sendToDrive, sendToObsidian } from '../lib/sync';
import { Card, Empty, Modal, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';
import { ImportExport } from '../components/ImportExport';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';
import { RelevancePick, RelevanceStatus, useAiRelevance } from '../components/RelevancePick';

type Folder = { kind: 'project'; id: string } | { kind: 'all' } | { kind: 'none' };

/** 관점 작성 완료 / 작성 필요 표시 */
function ViewTag({ m }: { m: Material }) {
  return hasMyView(m) ? <span className="ok-tag">작성 완료</span> : <span className="warn-tag">작성 필요</span>;
}

function Detail({ m }: { m: Material }) {
  const { state, dispatch, toast } = useStore();
  const nav = useNav();
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
  const cite = formatCitation(m, 'APA 7');

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

      {cite && (
        <div className="cite-box">
          <span className="muted small">서지사항 (APA 7)</span>
          <p>{segsToText(cite)}</p>
        </div>
      )}

      <dl className="meta">
        <dt>폴더</dt>
        <dd>
          <select
            className="inline-select"
            value={m.projectId ?? ''}
            onChange={(e) => {
              dispatch({ type: 'moveMaterials', ids: [m.id], projectId: e.target.value || undefined });
              toast('자료를 다른 폴더로 옮겼습니다.');
            }}
          >
            <option value="">미분류</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </dd>
        <dt>유형 · 출처</dt>
        <dd>
          <SourceTag type={m.sourceType} /> {m.importedFrom && <span className="chip chip-muted">{m.importedFrom}</span>}
        </dd>
        <dt>핵심 키워드</dt>
        <dd className="chips">{m.keywords.length ? m.keywords.map((k) => <span key={k} className="chip">{k}</span>) : <span className="muted">없음</span>}</dd>
        <dt>논문 관련도</dt>
        <dd>
          <select className="inline-select" value={m.relevance} onChange={(e) => dispatch({ type: 'update', id: m.id, patch: { relevance: Number(e.target.value) } })}>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}등급</option>)}
          </select>
        </dd>
        <dt>PARA 분류</dt>
        <dd>
          <select className="inline-select" value={m.para} onChange={(e) => dispatch({ type: 'update', id: m.id, patch: { para: e.target.value as Para } })}>
            {PARAS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </dd>
        <dt>서지사항</dt>
        <dd>
          {m.bibStatus === '서지정보 입력됨' ? <span className="ok-tag">완성</span> : <span className="warn-tag">확인 필요</span>}
          <button className="link small" onClick={() => nav.go('references')}>참고문헌에서 편집</button>
        </dd>
        <dt>내 관점</dt>
        <dd>
          <ViewTag m={m} />
          <button className="link small" onClick={() => nav.go('analysis')}>{hasMyView(m) ? '보기·수정' : '작성하기'}</button>
        </dd>
        {m.fileName && (
          <>
            <dt>파일</dt>
            <dd>
              {m.fileName} · {formatSize(m.fileSize)}
              {m.content && <div className="muted small">본문 텍스트 {m.content.length.toLocaleString()}자 저장됨 (AI 분석 근거)</div>}
            </dd>
          </>
        )}
        <dt>원문</dt>
        <dd>{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="btn btn-sm">원문 열기 ↗</a> : <span className="muted">링크 없음</span>}</dd>
        <dt>외부 저장</dt>
        <dd className="small">
          {m.external?.obsidianPath ? <div>Obsidian: {m.external.obsidianPath}</div> : <div className="muted">Obsidian에 없음</div>}
          {m.external?.driveSyncedAt ? <div>Drive: {formatDate(m.external.driveSyncedAt)} 저장</div> : <div className="muted">Drive에 없음</div>}
        </dd>
        <dt>등록일</dt>
        <dd>{formatDate(m.createdAt)}</dd>
      </dl>

      {m.abstract && (
        <details className="content-preview" open>
          <summary>초록</summary>
          <p className="abstract">{m.abstract}</p>
        </details>
      )}
      {m.content && !m.abstract && (
        <details className="content-preview">
          <summary>본문 미리보기</summary>
          <pre>{m.content.slice(0, 1500)}</pre>
        </details>
      )}

      <div className="actions">
        <button className="btn btn-primary" onClick={() => nav.go('analysis')}>AI 분석 열기</button>
        {confirmDel ? (
          <>
            <span className="small err">정말 삭제할까요?</span>
            <button className="btn btn-danger" onClick={() => { dispatch({ type: 'remove', id: m.id }); toast('자료를 삭제했습니다.'); }}>삭제</button>
            <button className="btn" onClick={() => setConfirmDel(false)}>취소</button>
          </>
        ) : (
          <button className="btn btn-danger-ghost" onClick={() => setConfirmDel(true)}>삭제</button>
        )}
      </div>
    </Card>
  );
}

/** 선택한 자료를 Obsidian·Drive 프로젝트 '자료' 폴더로 보내기 */
function SendDialog({ ms, target, onClose }: { ms: Material[]; target: 'obsidian' | 'drive'; onClose: () => void }) {
  const { state, dispatch, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  // 자료마다 소속 프로젝트 폴더로 보낸다 (미분류는 현재 프로젝트로)
  const groups = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of ms) {
      const pid = m.projectId ?? state.currentProjectId ?? '';
      map.set(pid, [...(map.get(pid) ?? []), m]);
    }
    return [...map.entries()].map(([pid, items]) => ({ project: state.projects.find((p) => p.id === pid), items })).filter((g) => g.project);
  }, [ms, state.projects, state.currentProjectId]);

  async function send() {
    setBusy('보내는 중…');
    let total = 0;
    try {
      for (const g of groups) {
        const p = g.project!;
        if (target === 'obsidian') {
          const r = await sendToObsidian(p, g.items, overwrite);
          const now = new Date().toISOString();
          if (r.saved.length) dispatch({ type: 'setExternal', updates: r.saved.map((s) => ({ id: s.id, external: { obsidianPath: s.path, obsidianSyncedAt: now } })) });
          total += r.saved.length;
          if (r.skippedModified.length) toast(`Obsidian에서 수정된 노트 ${r.skippedModified.length}건은 덮어쓰지 않았습니다.`, 'info');
          if (r.failed.length) toast(`실패 ${r.failed.length}건: ${r.failed[0].title} — ${r.failed[0].message}`, 'error');
          if (!p.obsidianCreatedAt) dispatch({ type: 'updateProject', id: p.id, patch: { obsidianPath: r.base, obsidianCreatedAt: now } });
        } else {
          const r = await sendToDrive(p, g.items, (i) => setBusy(`보내는 중… (${i + 1}/${g.items.length})`));
          if (r.updates.length) dispatch({ type: 'setExternal', updates: r.updates });
          if (!p.driveFolderId) dispatch({ type: 'updateProject', id: p.id, patch: { driveFolderId: r.folderId, driveCreatedAt: new Date().toISOString() } });
          total += r.updates.length;
          if (r.failed.length) toast(`실패 ${r.failed.length}건: ${r.failed.slice(0, 2).join(', ')}`, 'error');
        }
        dispatch({ type: 'log', event: { projectId: p.id, kind: '연동', text: `자료 ${g.items.length}건을 ${target === 'obsidian' ? 'Obsidian' : 'Google Drive'} '자료' 폴더로 보냈습니다.` } });
      }
      toast(`${target === 'obsidian' ? 'Obsidian' : 'Google Drive'}로 ${total}건을 보냈습니다.`);
      onClose();
    } catch (e) {
      toast(e instanceof DriveError || e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={`${target === 'obsidian' ? 'Obsidian' : 'Google Drive'}로 자료 보내기`}
      onClose={onClose}
      busy={!!busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={!!busy}>취소</button>
          <button className="btn btn-primary" onClick={send} disabled={!!busy || !groups.length}>{busy ?? `${ms.length}건 보내기`}</button>
        </>
      }
    >
      <p className="muted small">각 자료를 Markdown 노트(서지사항·초록·나의 관점·연구 메모 포함)로 만들어 프로젝트의 <b>자료</b> 폴더에 저장합니다. 이미 보낸 자료는 같은 파일을 갱신합니다.</p>
      <ul className="send-list">
        {groups.map((g) => (
          <li key={g.project!.id}>
            <b>{target === 'obsidian' ? '📓' : '☁'} {g.project!.name}/자료</b>
            <span className="muted small">{g.items.length}건 — {g.items.slice(0, 3).map((m) => m.title).join(', ')}{g.items.length > 3 ? ' 외' : ''}</span>
          </li>
        ))}
      </ul>
      {target === 'obsidian' && (
        <label className="radio small">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Obsidian에서 수정된 노트도 덮어쓰기
        </label>
      )}
    </Modal>
  );
}

/** 이미 있는 자료의 관련도를 AI가 현재 프로젝트 기준으로 다시 제안 → 연구자가 확인·수정 후 적용 (관련도 외 내용은 그대로) */
function RejudgePanel({ ms, onClose }: { ms: Material[]; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const { project } = useProject();
  const targets = useMemo(() => ms.map((m) => ({ key: m.id, title: m.title, keywords: m.keywords, text: m.abstract ?? m.content })), [ms]);
  const ai = useAiRelevance(targets);
  const changes = ms.filter((m) => ai.rel[m.id] && ai.rel[m.id].relevance !== m.relevance);

  function apply() {
    changes.forEach((m) => dispatch({ type: 'update', id: m.id, patch: { relevance: ai.rel[m.id].relevance } }));
    if (project && changes.length) dispatch({ type: 'log', event: { projectId: project.id, kind: '분석', text: `자료 ${changes.length}건의 관련도를 AI 제안을 확인해 바꿨습니다.` } });
    toast(changes.length ? `관련도 ${changes.length}건을 바꿨습니다.` : '바뀐 관련도가 없습니다.', changes.length ? 'success' : 'info');
    onClose();
  }

  return (
    <Card
      title={`AI 관련도 다시 판단 (${ms.length}건)`}
      extra={<StatusBadge s="ai">'{project?.name}' 주제 기준</StatusBadge>}
      className="rejudge-card"
    >
      <p className="small">
        <RelevanceStatus status={ai.status} onCancel={ai.cancel} />
      </p>
      <p className="muted small">AI 제안을 확인하고 필요하면 바꾼 뒤 적용하세요. 관련도만 바뀌고 나의 관점·메모·서지정보는 그대로입니다.</p>
      <table className="table compact">
        <thead>
          <tr>
            <th>자료</th>
            <th>현재</th>
            <th>바꿀 관련도</th>
            <th>AI 판단 이유</th>
          </tr>
        </thead>
        <tbody>
          {ms.map((m) => {
            const c = ai.rel[m.id];
            return (
              <tr key={m.id} className={c && c.relevance !== m.relevance ? 'chosen' : ''}>
                <td className="cell-title">{m.title}</td>
                <td><Relevance value={m.relevance} /></td>
                <td><RelevancePick value={m.relevance} choice={c} onChange={(v) => ai.choose(m.id, v)} /></td>
                <td className="small muted">{c?.reason ?? '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="actions">
        <button className="btn btn-primary" onClick={apply} disabled={ai.running}>
          {ai.running ? 'AI 관련도 판단 중…' : `적용 (변경 ${changes.length}건)`}
        </button>
        <button className="btn" onClick={() => { ai.cancel(); onClose(); }}>취소</button>
      </div>
    </Card>
  );
}

export function Library() {
  const { state, dispatch, toast } = useStore();
  const { project } = useProject();
  const nav = useNav();
  const conn = useConnections();
  const [folder, setFolder] = useState<Folder>(project ? { kind: 'project', id: project.id } : { kind: 'all' });
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('전체');
  const [view, setView] = useState('전체');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [send, setSend] = useState<'obsidian' | 'drive' | null>(null);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [rejudge, setRejudge] = useState<Material[] | null>(null);

  // 사이드바에서 프로젝트를 바꾸면 그 폴더를 보여 준다
  useEffect(() => {
    if (project) setFolder({ kind: 'project', id: project.id });
  }, [project?.id]);
  useEffect(() => setChecked(new Set()), [folder]);

  const inFolder = (m: Material) => (folder.kind === 'all' ? true : folder.kind === 'none' ? !m.projectId || !state.projects.some((p) => p.id === m.projectId) : m.projectId === folder.id);
  const folderItems = state.materials.filter(inFolder);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return folderItems.filter(
      (m) =>
        (!s || [m.title, m.topic, ...m.keywords, m.abstract ?? '', m.bib?.author ?? ''].join(' ').toLowerCase().includes(s)) &&
        (src === '전체' || m.sourceType === src) &&
        (view === '전체' || (view === '작성 완료') === hasMyView(m)),
    );
  }, [folderItems, q, src, view]);

  const selected = state.materials.find((m) => m.id === state.selectedId && inFolder(m)) ?? null;
  const checkedItems = state.materials.filter((m) => checked.has(m.id));
  const unfiled = state.materials.filter((m) => !m.projectId || !state.projects.some((p) => p.id === m.projectId)).length;
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const folderName = folder.kind === 'all' ? '전체 자료' : folder.kind === 'none' ? '미분류' : (state.projects.find((p) => p.id === folder.id)?.name ?? '');

  return (
    <>
      <PageHeader
        title="자료 라이브러리"
        desc="논문 주제(프로젝트)별 폴더로 원본 연구자료를 관리합니다. AI가 만든 결과물은 이곳에 섞지 않습니다."
        badges={<button className="btn btn-primary" onClick={() => nav.go('collect')}>＋ 자료 추가</button>}
      />

      <div className="lib-shell">
        <aside className="folder-pane">
          <div className="folder-head">폴더</div>
          <button className={`folder ${folder.kind === 'all' ? 'active' : ''}`} onClick={() => setFolder({ kind: 'all' })}>
            <span>🗂 전체</span>
            <b>{state.materials.length}</b>
          </button>
          {state.projects.map((p) => (
            <button
              key={p.id}
              className={`folder ${folder.kind === 'project' && folder.id === p.id ? 'active' : ''}`}
              onClick={() => {
                setFolder({ kind: 'project', id: p.id });
                dispatch({ type: 'selectProject', id: p.id });
              }}
              title={p.topic}
            >
              <span>📁 {p.name}</span>
              <b>{state.materials.filter((m) => m.projectId === p.id).length}</b>
            </button>
          ))}
          {unfiled > 0 && (
            <button className={`folder ${folder.kind === 'none' ? 'active' : ''}`} onClick={() => setFolder({ kind: 'none' })}>
              <span>📂 미분류</span>
              <b>{unfiled}</b>
            </button>
          )}
          <button className="folder folder-new" onClick={nav.newProject}>＋ 새 폴더</button>
        </aside>

        <div className="lib-main">
          <div className="filters">
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`'${folderName}'에서 제목·저자·키워드·초록 검색`} />
            <label>
              유형
              <select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option>전체</option>
                {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
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
            <span className="muted small">{list.length} / {folderItems.length}건</span>
          </div>

          {checked.size > 0 && (
            <div className="bulk-bar">
              <b>{checked.size}건 선택</b>
              <label>
                폴더 이동
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const pid = e.target.value === '__none' ? undefined : e.target.value;
                    dispatch({ type: 'moveMaterials', ids: [...checked], projectId: pid });
                    toast(`${checked.size}건을 옮겼습니다.`);
                    setChecked(new Set());
                  }}
                >
                  <option value="">선택…</option>
                  {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__none">미분류</option>
                </select>
              </label>
              <button className="btn btn-sm" onClick={() => (conn.obsidian ? setSend('obsidian') : toast('연구 설정에서 Obsidian 폴더를 먼저 연결하세요.', 'info'))}>📓 Obsidian으로 보내기</button>
              <button className="btn btn-sm" onClick={() => (conn.drive ? setSend('drive') : toast('연구 설정에서 Google Drive를 먼저 연결하세요.', 'info'))}>☁ Drive로 보내기</button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (!conn.ai) return toast('AI 관련도 판단에는 Claude API 키가 필요합니다. 연구 설정 → AI 설정에서 입력하세요.', 'info');
                  if (folder.kind !== 'project') return toast('프로젝트 폴더를 선택한 상태에서 사용하세요. 관련도는 프로젝트 주제를 기준으로 판단합니다.', 'info');
                  setRejudge(checkedItems);
                }}
              >
                ◎ AI 관련도 다시 판단
              </button>
              {confirmBulkDel ? (
                <>
                  <button className="btn btn-sm btn-danger" onClick={() => { dispatch({ type: 'removeMany', ids: [...checked] }); toast(`${checked.size}건을 삭제했습니다.`); setChecked(new Set()); setConfirmBulkDel(false); }}>삭제 확인</button>
                  <button className="btn btn-sm" onClick={() => setConfirmBulkDel(false)}>취소</button>
                </>
              ) : (
                <button className="btn btn-sm btn-danger-ghost" onClick={() => setConfirmBulkDel(true)}>삭제</button>
              )}
              <button className="link small" onClick={() => setChecked(new Set())}>선택 해제</button>
            </div>
          )}

          {rejudge && <RejudgePanel ms={rejudge} onClose={() => { setRejudge(null); setChecked(new Set()); }} />}

          <div className="lib-layout">
            <Card className="lib-table">
              {list.length === 0 ? (
                <Empty>
                  {folderItems.length ? '조건에 맞는 자료가 없습니다.' : <>이 폴더에 자료가 없습니다. <button className="link" onClick={() => nav.go('collect')}>자료 수집</button>에서 추가하세요.</>}
                </Empty>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th className="cb">
                        <input
                          type="checkbox"
                          checked={list.length > 0 && list.every((m) => checked.has(m.id))}
                          onChange={(e) => setChecked(e.target.checked ? new Set(list.map((m) => m.id)) : new Set())}
                          aria-label="모두 선택"
                        />
                      </th>
                      <th>제목</th>
                      <th>유형</th>
                      <th>저자 · 연도</th>
                      <th>관련도</th>
                      <th>서지</th>
                      <th>내 관점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m) => (
                      <tr key={m.id} className={`clickable ${m.id === state.selectedId ? 'selected' : ''}`} onClick={() => dispatch({ type: 'select', id: m.id })}>
                        <td className="cb" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={checked.has(m.id)} onChange={() => toggle(m.id)} />
                        </td>
                        <td className="cell-title">
                          {m.title}
                          <div className="muted small">{m.bib?.container ?? m.topic}{folder.kind === 'all' && ` · ${state.projects.find((p) => p.id === m.projectId)?.name ?? '미분류'}`}</div>
                        </td>
                        <td><SourceTag type={m.sourceType} /></td>
                        <td className="small">{[m.bib?.authors?.slice(0, 2).join(', '), m.bib?.year].filter(Boolean).join(' · ') || <span className="muted">-</span>}</td>
                        <td><Relevance value={m.relevance} /></td>
                        <td>{m.bibStatus === '서지정보 입력됨' ? <span className="ok-tag">완성</span> : <span className="warn-tag">확인</span>}</td>
                        <td><ViewTag m={m} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div className="lib-side">
              {selected ? <Detail m={selected} /> : <Card title="자료 상세"><Empty>목록에서 자료를 선택하세요.</Empty></Card>}
              <ImportExport selected={selected} />
              <p className="muted small"><StatusBadge s="local" /> 체크박스로 여러 자료를 골라 폴더 이동·Obsidian/Drive 보내기를 할 수 있습니다.</p>
            </div>
          </div>
        </div>
      </div>

      {send && <SendDialog ms={checkedItems} target={send} onClose={() => { setSend(null); setChecked(new Set()); }} />}
    </>
  );
}
