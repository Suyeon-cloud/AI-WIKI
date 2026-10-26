import { useState } from 'react';
import { PROJECT_STATUSES, hasMyView, type Project } from '../types';
import { useStore, useProject } from '../store';
import { SOURCE_TYPES, formatDate } from '../lib/utils';
import { createProjectFolders, driveReady, obsidianReady } from '../lib/sync';
import { Card, Empty, NeedProject, PageHeader, Relevance, SourceTag, StatusBadge } from '../components/ui';
import { useNav } from '../components/ProjectDialog';

const time = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function FolderState({ p }: { p: Project }) {
  return (
    <span className="folder-state">
      <span className={p.obsidianCreatedAt ? 'on' : ''} title={p.obsidianPath ? `Obsidian: ${p.obsidianPath}` : 'Obsidian 폴더 없음'}>
        O
      </span>
      <span className={p.driveCreatedAt ? 'on' : ''} title={p.driveFolderId ? 'Google Drive 폴더 있음' : 'Drive 폴더 없음'}>
        D
      </span>
    </span>
  );
}

export function Dashboard() {
  const { state, dispatch, toast } = useStore();
  const { project, materials: ms, outputs } = useProject();
  const nav = useNav();
  const [busy, setBusy] = useState(false);

  const projectRows = state.projects.map((p) => {
    const pm = state.materials.filter((m) => m.projectId === p.id);
    const po = state.aiOutputs.filter((o) => o.projectId === p.id);
    const last = [p.updatedAt, ...pm.map((m) => m.updatedAt ?? m.createdAt), ...po.map((o) => o.createdAt)].sort().pop() ?? p.createdAt;
    return { p, materials: pm.length, outputs: po.length, last };
  });

  async function makeFolders(p: Project) {
    if (!driveReady() && !obsidianReady()) return toast('먼저 연구 설정에서 Obsidian 폴더 또는 Google Drive를 연결하세요.', 'info');
    setBusy(true);
    try {
      const r = await createProjectFolders(p);
      if (Object.keys(r.patch).length) dispatch({ type: 'updateProject', id: p.id, patch: r.patch });
      if (r.done.length) {
        dispatch({ type: 'log', event: { projectId: p.id, kind: '연동', text: `폴더 생성 — ${r.done.join(' / ')}` } });
        toast(`폴더를 만들었습니다: ${r.done.join(', ')}`);
      }
      r.errors.forEach((e) => toast(e, 'error'));
      if (r.skipped.length && !r.done.length) toast(`연결되지 않아 건너뜀: ${r.skipped.join(', ')}`, 'info');
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <>
        <PageHeader title="대시보드" desc="프로젝트 단위로 연구 진행 상황과 이력을 확인합니다." />
        <NeedProject onCreate={nav.newProject} />
      </>
    );
  }

  const bySource = SOURCE_TYPES.map((t) => ({ t, n: ms.filter((m) => m.sourceType === t).length })).filter((x) => x.n > 0);
  const maxSource = Math.max(1, ...bySource.map((x) => x.n));
  const byRel = [5, 4, 3, 2, 1].map((r) => ({ r, n: ms.filter((m) => m.relevance === r).length }));
  const maxRel = Math.max(1, ...byRel.map((x) => x.n));
  const recent = [...ms].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const viewDone = ms.filter(hasMyView).length;
  const bibDone = ms.filter((m) => m.bibStatus === '서지정보 입력됨').length;
  const events = state.events.filter((e) => e.projectId === project.id).slice(0, 12);
  const freq = new Map<string, number>();
  ms.forEach((m) => m.keywords.forEach((k) => freq.set(k, (freq.get(k) ?? 0) + 1)));
  const topKw = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  return (
    <>
      <PageHeader
        title="대시보드"
        desc="프로젝트(논문 주제)별 생성 이력과 진행 상황을 확인하고, 새 프로젝트를 추가합니다."
        badges={
          <button className="btn btn-primary" onClick={nav.newProject}>
            ＋ 새 프로젝트
          </button>
        }
      />

      <Card title="프로젝트 이력" extra={<span className="muted small">행을 누르면 그 프로젝트로 전환합니다 · O = Obsidian 폴더, D = Drive 폴더</span>}>
        <table className="table">
          <thead>
            <tr>
              <th>프로젝트</th>
              <th>상태</th>
              <th>자료</th>
              <th>AI 결과물</th>
              <th>폴더</th>
              <th>생성일</th>
              <th>최근 활동</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projectRows.map(({ p, materials, outputs, last }) => (
              <tr key={p.id} className={`clickable ${p.id === project.id ? 'selected' : ''}`} onClick={() => dispatch({ type: 'selectProject', id: p.id })}>
                <td className="cell-title">
                  {p.name}
                  <div className="muted small">{p.topic !== p.name ? p.topic : p.keywords.slice(0, 4).join(', ')}</div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="inline-select"
                    value={p.status}
                    onChange={(e) => {
                      dispatch({ type: 'updateProject', id: p.id, patch: { status: e.target.value as Project['status'] } });
                      dispatch({ type: 'log', event: { projectId: p.id, kind: '수정', text: `상태를 '${e.target.value}'(으)로 변경했습니다.` } });
                    }}
                  >
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>{materials}</td>
                <td>{outputs}</td>
                <td>
                  <FolderState p={p} />
                </td>
                <td className="muted nowrap">{formatDate(p.createdAt)}</td>
                <td className="muted nowrap">{formatDate(last)}</td>
                <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                  <button className="link small" onClick={() => nav.editProject(p)}>
                    정보 수정
                  </button>
                  <button
                    className="btn btn-sm btn-danger-ghost"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      const ok = window.confirm(
                        `'${p.name}' 프로젝트를 삭제하시겠습니까?\nAI WIKI에 저장된 해당 프로젝트의 자료, AI 결과물 및 프로젝트 기록이 삭제됩니다.\nObsidian 및 Google Drive의 원본 파일과 폴더는 삭제되지 않습니다.`,
                      );
                      if (!ok) return;
                      dispatch({ type: 'removeProject', id: p.id });
                      toast(`'${p.name}' 프로젝트를 삭제했습니다. Obsidian·Google Drive의 파일은 그대로입니다.`);
                    }}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="topic-card">
        <div className="topic-row">
          <div>
            <div className="topic-label">현재 프로젝트 · {project.degree}학위논문{project.advisor && ` · 지도교수 ${project.advisor}`}</div>
            <div className="topic-title">{project.topic}</div>
            {project.overview && <p className="topic-overview">{project.overview}</p>}
            <div className="chips">
              {project.keywords.map((k) => (
                <span key={k} className="chip chip-strong">
                  {k}
                </span>
              ))}
              {!project.keywords.length && <span className="muted small">키워드 없음 — 정보 수정에서 추가하세요 (AI 분석에 사용)</span>}
            </div>
          </div>
          <div className="topic-actions">
            <FolderState p={project} />
            <button className="btn btn-sm" onClick={() => makeFolders(project)} disabled={busy}>
              {busy ? '폴더 만드는 중…' : project.obsidianCreatedAt && project.driveCreatedAt ? '폴더 다시 확인' : 'Obsidian·Drive 폴더 만들기'}
            </button>
          </div>
        </div>
      </Card>

      <div className="stats">
        <div className="stat">
          <span>연구자료</span>
          <b>{ms.length}</b>
          <small>KCI PDF {ms.filter((m) => m.importedFrom === 'KCI PDF').length}건</small>
        </div>
        <div className="stat">
          <span>관련도 4~5등급</span>
          <b>{ms.filter((m) => m.relevance >= 4).length}</b>
          <small>논문 핵심 자료 후보</small>
        </div>
        <div className="stat">
          <span>나의 관점 작성</span>
          <b>
            {viewDone} / {ms.length}
          </b>
          <small className={ms.length - viewDone ? 'view-missing' : ''}>작성 필요 {ms.length - viewDone}</small>
        </div>
        <div className="stat">
          <span>서지사항 완성</span>
          <b>
            {bibDone} / {ms.length}
          </b>
          <small>참고문헌 선택 {ms.filter((m) => m.citationIncluded).length}건</small>
        </div>
        <div className="stat">
          <span>AI 결과물</span>
          <b>{outputs.length}</b>
          <small>
            분석 {outputs.filter((o) => o.kind.includes('분석')).length} · 집필 {outputs.filter((o) => !o.kind.includes('분석')).length}
          </small>
        </div>
      </div>

      <div className="grid-2-1">
        <Card title="프로젝트 활동 이력" extra={<StatusBadge s="local">자동 기록</StatusBadge>}>
          {events.length === 0 ? (
            <Empty>아직 기록이 없습니다.</Empty>
          ) : (
            <ul className="timeline-list">
              {events.map((e) => (
                <li key={e.id}>
                  <span className={`ev ev-${e.kind}`}>{e.kind}</span>
                  <span className="ev-text">{e.text}</span>
                  <span className="muted small nowrap">{time(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="핵심 키워드" extra={<span className="muted small">자료 키워드 빈도</span>}>
          {topKw.length ? (
            <div className="kw-cloud">
              {topKw.map(([k, n]) => (
                <span key={k} className="chip" style={{ fontSize: `${12 + Math.min(n, 4) * 1.5}px` }}>
                  {k} <small>{n}</small>
                </span>
              ))}
            </div>
          ) : (
            <Empty>자료를 모으면 키워드가 나타납니다.</Empty>
          )}
        </Card>
      </div>

      <div className="grid-2-1">
        <Card title="최근 추가 자료" extra={<button className="btn btn-sm" onClick={() => nav.go('library')}>라이브러리 열기</button>}>
          {recent.length === 0 ? (
            <Empty>
              자료가 없습니다. <button className="link" onClick={() => nav.go('collect')}>자료 수집</button>에서 KCI 논문 PDF를 추가하세요.
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>유형</th>
                  <th>관련도</th>
                  <th>등록일</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr
                    key={m.id}
                    className="clickable"
                    onClick={() => {
                      dispatch({ type: 'select', id: m.id });
                      nav.go('library');
                    }}
                  >
                    <td className="cell-title">{m.title}</td>
                    <td>
                      <SourceTag type={m.sourceType} />
                    </td>
                    <td>
                      <Relevance value={m.relevance} />
                    </td>
                    <td className="muted">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="자료 분포">
          {ms.length === 0 ? (
            <Empty>자료가 없습니다.</Empty>
          ) : (
            <>
              <div className="hbars">
                {bySource.map(({ t, n }) => (
                  <div key={t} className="hbar">
                    <span className="hbar-label">
                      <SourceTag type={t} />
                    </span>
                    <span className="hbar-track">
                      <span className="hbar-fill" style={{ width: `${(n / maxSource) * 100}%` }} />
                    </span>
                    <span className="hbar-num">{n}</span>
                  </div>
                ))}
              </div>
              <div className="vbars" style={{ marginTop: 16 }}>
                {byRel.map(({ r, n }) => (
                  <div key={r} className="vbar">
                    <span className="vbar-num">{n}</span>
                    <span className="vbar-col">
                      <span className={`vbar-fill rel-${r}`} style={{ height: `${(n / maxRel) * 100}%` }} />
                    </span>
                    <span className="vbar-label">관련도 {r}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
