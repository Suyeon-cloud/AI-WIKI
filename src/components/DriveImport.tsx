import { useEffect, useState } from 'react';
import { useStore, useProject } from '../store';
import { formatDate, formatSize } from '../lib/utils';
import { DriveError, browseFolder, downloadAsFile, downloadBlob, ensureProjectFolders, searchDrive, type DriveEntry } from '../lib/drive';
import { PROJECT_SUBFOLDERS, folderName } from '../lib/projects';
import { aiState } from '../lib/ai';
import { Empty, Modal } from './ui';
import { KciReview, extractPdfs, type ReviewItem } from './KciImport';
import { ImportFlow } from './ImportExport';

const IMPORTABLE = /\.(pdf|md|markdown|txt|json)$/i;
const isPdf = (f: DriveEntry) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name);

/**
 * Google Drive 자료 목록 팝업 — 폴더를 오가며 가져올 파일을 직접 체크한다.
 * PDF는 서지·초록 추출 후 확인 창으로, Markdown·JSON은 가져오기 미리보기로 넘긴다.
 */
export function DriveImportModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, toast } = useStore();
  const { project } = useProject();
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  const [picked, setPicked] = useState<Map<string, DriveEntry>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [incoming, setIncoming] = useState<{ files: File[]; key: number } | null>(null);

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof DriveError ? e.message : `Google Drive 오류: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  const open = (stack: { id: string; name: string }[]) =>
    guard('목록 불러오는 중…', async () => {
      setEntries(await browseFolder(stack[stack.length - 1].id));
      setPath(stack);
    });

  // 처음에는 프로젝트의 '자료' 폴더를 연다 (없으면 만든다)
  useEffect(() => {
    void guard('프로젝트 폴더 확인 중…', async () => {
      if (project) {
        const f = await ensureProjectFolders(folderName(project), PROJECT_SUBFOLDERS, project.driveFolderId);
        if (!project.driveFolderId) dispatch({ type: 'updateProject', id: project.id, patch: { driveFolderId: f.project, driveCreatedAt: new Date().toISOString() } });
        const stack = [
          { id: 'root', name: '내 드라이브' },
          { id: f.project, name: `AI WIKI/${folderName(project)}` },
          { id: f.materials, name: PROJECT_SUBFOLDERS.materials },
        ];
        setEntries(await browseFolder(f.materials));
        setPath(stack);
      } else {
        setEntries(await browseFolder('root'));
        setPath([{ id: 'root', name: '내 드라이브' }]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = () =>
    guard('검색 중…', async () => {
      if (!q.trim()) return open(path.length ? path : [{ id: 'root', name: '내 드라이브' }]);
      setEntries(await searchDrive(q.trim()));
      setPath([...path.filter((p) => !p.id.startsWith('search:')), { id: `search:${q}`, name: `'${q}' 검색 결과` }]);
    });

  const toggle = (f: DriveEntry) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(f.id)) n.delete(f.id);
      else n.set(f.id, f);
      return n;
    });

  const files = (entries ?? []).filter((f) => !f.isFolder);
  const folders = (entries ?? []).filter((f) => f.isFolder);
  const importable = files.filter((f) => IMPORTABLE.test(f.name) || isPdf(f));

  const importPicked = () =>
    guard('Drive에서 받는 중…', async () => {
      const chosen = [...picked.values()];
      const pdfs = chosen.filter(isPdf);
      const notes = chosen.filter((f) => !isPdf(f));
      if (notes.length) setIncoming({ files: await Promise.all(notes.map(downloadAsFile)), key: Date.now() });
      if (pdfs.length) {
        const blobs: { file: Blob; name: string; size: number; from: 'Google Drive' }[] = [];
        for (const [i, f] of pdfs.entries()) {
          setBusy(`PDF 받는 중… (${i + 1}/${pdfs.length})`);
          const b = await downloadBlob(f.id);
          blobs.push({ file: b, name: f.name, size: b.size, from: 'Google Drive' });
        }
        const items = await extractPdfs(blobs, { useAi: aiState().configured, existing: state.materials }, (_it, i) => setBusy(`서지·초록 추출 중… (${i + 1}/${pdfs.length})`));
        setReview(items);
      }
      setPicked(new Map());
    });

  return (
    <Modal
      title="Google Drive에서 자료 가져오기"
      onClose={onClose}
      busy={!!busy}
      wide
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            {busy ?? `선택 ${picked.size}개 · PDF는 서지·초록을 추출한 뒤 한 번 더 확인합니다`}
          </span>
          <button className="btn" onClick={onClose} disabled={!!busy}>
            닫기
          </button>
          <button className="btn btn-primary" onClick={importPicked} disabled={!!busy || !picked.size}>
            선택한 {picked.size}개 가져오기
          </button>
        </>
      }
    >
      <div className="drive-bar">
        <div className="crumbs">
          {path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="muted"> / </span>}
              <button className="link" disabled={!!busy || i === path.length - 1 || p.id.startsWith('search:')} onClick={() => open(path.slice(0, i + 1))}>
                {p.name}
              </button>
            </span>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="파일 이름 검색" />
        <button className="btn btn-sm" onClick={search} disabled={!!busy}>
          검색
        </button>
      </div>
      {entries === null ? (
        <Empty>{busy ?? '불러오는 중…'}</Empty>
      ) : (
        <>
          <div className="actions" style={{ marginTop: 6 }}>
            <button className="link small" onClick={() => setPicked(new Map([...picked, ...importable.map((f) => [f.id, f] as const)]))} disabled={!importable.length}>
              이 폴더 파일 모두 선택
            </button>
            <button className="link small" onClick={() => setPicked(new Map())}>
              선택 해제
            </button>
          </div>
          <ul className="drive-browser">
            {folders.map((f) => (
              <li key={f.id} className="is-folder" onClick={() => !busy && open([...path.filter((p) => !p.id.startsWith('search:')), { id: f.id, name: f.name }])}>
                <span className="fi">📁</span>
                <span className="import-title">{f.name}</span>
                <span className="muted small">{formatDate(f.modifiedTime)}</span>
              </li>
            ))}
            {files.map((f) => {
              const ok = IMPORTABLE.test(f.name) || isPdf(f);
              return (
                <li key={f.id} className={ok ? '' : 'disabled'} onClick={() => ok && toggle(f)}>
                  <input type="checkbox" checked={picked.has(f.id)} disabled={!ok} readOnly />
                  <span className="fi">{isPdf(f) ? '📄' : /\.json$/i.test(f.name) ? '🗂' : '📝'}</span>
                  <span className="import-title">{f.name}</span>
                  <span className="muted small nowrap">
                    {f.size ? formatSize(Number(f.size)) : ''} · {formatDate(f.modifiedTime)}
                  </span>
                </li>
              );
            })}
            {!folders.length && !files.length && (
              <li className="disabled">
                <span className="muted">
                  비어 있습니다. Google Drive의 <b>AI WIKI/{project ? folderName(project) : '프로젝트'}/자료</b> 폴더에 PDF를 올린 뒤 다시 열어 보세요.
                </span>
              </li>
            )}
          </ul>
          <p className="muted small">가져올 수 있는 형식: PDF(논문) · Markdown · TXT · AI WIKI 백업 JSON. 앱은 체크한 파일만 읽으며 Drive의 파일을 바꾸지 않습니다.</p>
        </>
      )}
      {review && <KciReview items={review} onClose={() => setReview(null)} />}
      <ImportFlow label="" hideButton incoming={incoming} />
    </Modal>
  );
}
