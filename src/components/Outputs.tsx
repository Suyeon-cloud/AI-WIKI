import { useState } from 'react';
import type { AiOutput, AiOutputKind } from '../types';
import { useStore, useProject } from '../store';
import { downloadFile, formatDate, markdownToHtml, safeFileName } from '../lib/utils';
import { outputToMarkdown, saveOutputToDrive, saveOutputToObsidian } from '../lib/sync';
import { useConnections } from './Sidebar';
import { Card, Empty, Modal, StatusBadge } from './ui';

const time = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** AI 결과물 1건을 Drive·Obsidian 'AI 생성' 폴더에 저장하는 버튼 묶음 */
export function useSaveOutput() {
  const { dispatch, toast } = useStore();
  const { project } = useProject();
  const [busy, setBusy] = useState<string | null>(null);
  async function toDrive(o: AiOutput) {
    if (!project) return;
    setBusy(o.id);
    try {
      const r = await saveOutputToDrive(o, project);
      dispatch({ type: 'updateOutput', id: o.id, patch: { driveFileId: r.fileId, driveSyncedAt: new Date().toISOString() } });
      if (!project.driveFolderId) dispatch({ type: 'updateProject', id: project.id, patch: { driveFolderId: r.folderId, driveCreatedAt: new Date().toISOString() } });
      dispatch({ type: 'log', event: { projectId: project.id, kind: '내보내기', text: `AI 결과물 '${o.title}'을(를) Drive 'AI 생성' 폴더에 저장했습니다.` } });
      toast(`Google Drive 'AI WIKI/${project.name}/AI 생성' 폴더에 저장했습니다.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }
  async function toObsidian(o: AiOutput) {
    if (!project) return;
    setBusy(o.id);
    try {
      const path = await saveOutputToObsidian(o, project);
      dispatch({ type: 'updateOutput', id: o.id, patch: { obsidianPath: path } });
      toast(`Obsidian '${path}'에 저장했습니다.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }
  return { busy, toDrive, toObsidian };
}

export function OutputView({ o, onClose }: { o: AiOutput; onClose: () => void }) {
  return (
    <Modal title={o.title} onClose={onClose} wide>
      <div className="demo-banner ai-banner">AI가 생성한 결과물입니다 — 원본 자료가 아니며 인용 전 원문 확인이 필요합니다. ({o.model || 'Claude'} · {time(o.createdAt)})</div>
      <div className="md-view" dangerouslySetInnerHTML={{ __html: markdownToHtml(o.content) }} />
    </Modal>
  );
}

/** 프로젝트의 AI 결과물 목록 (라이브러리와 분리 보관) */
export function OutputList({ kinds, title = 'AI 결과물 보관함' }: { kinds?: AiOutputKind[]; title?: string }) {
  const { dispatch, toast } = useStore();
  const { project, outputs } = useProject();
  const conn = useConnections();
  const { busy, toDrive, toObsidian } = useSaveOutput();
  const [view, setView] = useState<AiOutput | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const list = outputs.filter((o) => !kinds || kinds.includes(o.kind));

  return (
    <Card title={title} extra={<StatusBadge s="ai">AI 생성 · 라이브러리와 분리</StatusBadge>}>
      {list.length === 0 ? (
        <Empty>아직 AI 결과물이 없습니다.</Empty>
      ) : (
        <ul className="output-list">
          {list.map((o) => (
            <li key={o.id}>
              <div className="output-main" onClick={() => setView(o)}>
                <span className="chip">{o.kind}</span>
                <b>{o.title}</b>
                <span className="muted small">
                  {time(o.createdAt)} · 근거 자료 {o.materialIds.length}건 {o.driveSyncedAt && '· Drive 저장됨'} {o.obsidianPath && '· Obsidian 저장됨'}
                </span>
              </div>
              <div className="btn-group">
                <button className="btn btn-sm" onClick={() => setView(o)}>보기</button>
                <button className="btn btn-sm" disabled={busy === o.id || !conn.drive} title={conn.drive ? '' : '연구 설정에서 Drive 연결'} onClick={() => toDrive(o)}>
                  ☁ Drive
                </button>
                <button className="btn btn-sm" disabled={busy === o.id || !conn.obsidian} title={conn.obsidian ? '' : '연구 설정에서 Obsidian 연결'} onClick={() => toObsidian(o)}>
                  📓 Obsidian
                </button>
                <button className="btn btn-sm" onClick={() => project && downloadFile(`${safeFileName(o.title)}.md`, outputToMarkdown(o, project), 'text/markdown')}>
                  .md
                </button>
                {del === o.id ? (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      dispatch({ type: 'removeOutput', id: o.id });
                      setDel(null);
                      toast('AI 결과물을 삭제했습니다. (Drive·Obsidian에 저장한 파일은 그대로입니다)');
                    }}
                  >
                    삭제 확인
                  </button>
                ) : (
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setDel(o.id)}>삭제</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view && <OutputView o={view} onClose={() => setView(null)} />}
    </Card>
  );
}
