import { useEffect, useReducer, useState } from 'react';
import { useStore } from '../store';
import { buildBackup } from '../lib/data';
import { formatDate, materialToMarkdown, safeFileName } from '../lib/utils';
import {
  DRIVE_NOTES_NAME,
  DRIVE_ROOT_NAME,
  DriveError,
  connectDrive,
  createFile,
  disconnectDrive,
  downloadAsFile,
  driveState,
  ensureFolders,
  listFolder,
  pickDriveFiles,
  pickerConfigured,
  subscribeDrive,
  updateFile,
  type DriveFile,
} from '../lib/drive';
import { Card, Empty, StatusBadge } from './ui';
import { ImportFlow } from './ImportExport';

const IMPORTABLE = /\.(md|markdown|txt|json)$/i;
const time = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Row = DriveFile & { where: string };

/**
 * Google Drive 저장·불러오기 (수동 전송)
 * - 전체 백업 JSON → 내 Drive/AI WIKI/
 * - 자료별 Markdown → 내 Drive/AI WIKI/notes/ (같은 자료는 같은 Drive 파일을 갱신)
 * - Drive 파일 → 기존 가져오기 미리보기(추가·갱신·충돌·중복 확인, 백업이면 전체 복원/병합 선택)
 */
export function DriveSync() {
  const { state, dispatch, toast } = useStore();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeDrive(rerender), []);
  const { status, expiresAt } = driveState();

  const [busy, setBusy] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [files, setFiles] = useState<Row[] | null>(null);
  const [incoming, setIncoming] = useState<{ files: File[]; key: number } | null>(null);

  const changed = state.materials.filter((m) => !m.external?.driveSyncedAt || (m.updatedAt ?? m.createdAt) > m.external.driveSyncedAt);
  const targets = onlyChanged ? changed : state.materials;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof DriveError ? e.message : `Google Drive 오류: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run('연결 중…', async () => {
      await connectDrive();
      toast('Google Drive에 연결했습니다.');
    });

  const saveBackup = () =>
    run('백업 저장 중…', async () => {
      const { root } = await ensureFolders();
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      const f = await createFile(`ai-wiki-backup-${stamp}.json`, JSON.stringify(buildBackup(state), null, 2), 'application/json', root);
      toast(`Drive의 '${DRIVE_ROOT_NAME}' 폴더에 ${f.name}을(를) 저장했습니다.`);
      if (files) setFiles(null);
    });

  const saveMarkdown = () =>
    run('Markdown 저장 중…', async () => {
      if (!targets.length) {
        toast('Drive에 저장할 변경 자료가 없습니다.', 'info');
        return;
      }
      const { notes } = await ensureFolders();
      const updates: { id: string; external: { driveFileId: string; driveModifiedAt: string; driveSyncedAt: string } }[] = [];
      const failed: string[] = [];
      for (const [i, m] of targets.entries()) {
        setBusy(`Markdown 저장 중… (${i + 1}/${targets.length})`);
        const name = `${safeFileName(m.title)}.md`;
        const md = materialToMarkdown(m);
        try {
          let f: DriveFile;
          try {
            f = m.external?.driveFileId ? await updateFile(m.external.driveFileId, name, md, 'text/markdown') : await createFile(name, md, 'text/markdown', notes);
          } catch (e) {
            // Drive에서 지워진 파일이면 새로 만든다
            if (e instanceof DriveError && e.kind === 'notfound') f = await createFile(name, md, 'text/markdown', notes);
            else throw e;
          }
          updates.push({ id: m.id, external: { driveFileId: f.id, driveModifiedAt: f.modifiedTime, driveSyncedAt: new Date().toISOString() } });
        } catch (e) {
          if (e instanceof DriveError && (e.kind === 'auth' || e.kind === 'network')) {
            if (updates.length) dispatch({ type: 'setExternal', updates });
            throw e;
          }
          failed.push(m.title);
        }
      }
      if (updates.length) dispatch({ type: 'setExternal', updates });
      toast(`Drive '${DRIVE_ROOT_NAME}/${DRIVE_NOTES_NAME}' 폴더에 Markdown ${updates.length}건을 저장했습니다.`);
      if (failed.length) toast(`저장 실패 ${failed.length}건: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' 외' : ''}`, 'error');
      if (files) setFiles(null);
    });

  const refresh = () =>
    run('목록 불러오는 중…', async () => {
      const { root, notes } = await ensureFolders();
      const [a, b] = await Promise.all([listFolder(root), listFolder(notes)]);
      setFiles([...a.map((f) => ({ ...f, where: DRIVE_ROOT_NAME })), ...b.map((f) => ({ ...f, where: `${DRIVE_ROOT_NAME}/${DRIVE_NOTES_NAME}` }))].filter((f) => IMPORTABLE.test(f.name)));
    });

  const importFiles = (docs: { id: string; name: string }[]) =>
    run('Drive에서 받는 중…', async () => {
      const ok = docs.filter((d) => IMPORTABLE.test(d.name));
      if (docs.length && !ok.length) {
        toast('.md / .txt / .json 파일만 가져올 수 있습니다.', 'error');
        return;
      }
      if (!ok.length) return;
      const got = await Promise.all(ok.map(downloadAsFile));
      setIncoming({ files: got, key: Date.now() });
    });

  const pick = () =>
    run('Drive 파일 선택 중…', async () => {
      const docs = await pickDriveFiles();
      if (docs.length) await importFiles(docs);
    });

  const badge =
    status === 'connected' ? (
      <StatusBadge s="real">연결됨</StatusBadge>
    ) : status === 'unconfigured' ? (
      <StatusBadge s="planned">설정 필요</StatusBadge>
    ) : status === 'expired' ? (
      <span className="warn-tag">인증 만료</span>
    ) : (
      <StatusBadge s="local">연결 안 됨</StatusBadge>
    );

  return (
    <Card title="Google Drive 저장 · 불러오기" extra={badge}>
      {status === 'unconfigured' ? (
        <p className="notice">
          Google Drive 연결이 설정되지 않았습니다. 프로젝트 폴더의 <code>.env</code>에 <code>VITE_GOOGLE_CLIENT_ID</code>를 입력하고 개발 서버를 다시
          시작하세요 (<code>.env.example</code> 참고). 설정 전에도 로컬 백업·복원은 그대로 사용할 수 있습니다.
        </p>
      ) : (
        <>
          <p className="muted small">
            내 Google Drive의 <b>{DRIVE_ROOT_NAME}</b> 폴더에 전체 백업(JSON)을, <b>{DRIVE_ROOT_NAME}/{DRIVE_NOTES_NAME}</b> 폴더에 자료별 Markdown을
            저장합니다. 권한은 <b>이 앱이 만든 파일과 직접 고른 파일</b>로 제한되며(drive.file), 버튼을 누를 때만 전송합니다. 로그인 정보는 이 브라우저
            탭의 메모리에만 있고 저장되지 않습니다.
          </p>
          <div className="actions">
            {status === 'connected' ? (
              <>
                <span className="small">
                  연결됨{expiresAt && <span className="muted"> · 인증 만료 예정 {time(new Date(expiresAt).toISOString())}</span>}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    disconnectDrive();
                    setFiles(null);
                    toast('Google Drive 연결을 해제했습니다.', 'info');
                  }}
                  disabled={!!busy}
                >
                  연결 해제
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={connect} disabled={!!busy || status === 'connecting'}>
                {status === 'expired' ? 'Google 계정 다시 연결' : 'Google 계정 연결'}
              </button>
            )}
            {busy && <span className="muted small">{busy}</span>}
          </div>

          {status === 'connected' && (
            <>
              <div className="io-row">
                <span className="io-label">저장</span>
                <div className="btn-group">
                  <button className="btn" onClick={saveBackup} disabled={!!busy}>전체 백업을 Drive에 저장</button>
                  <button className="btn" onClick={saveMarkdown} disabled={!!busy}>
                    Markdown 저장 ({targets.length}건)
                  </button>
                </div>
              </div>
              <label className="radio small" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                마지막 Drive 저장 이후 바뀐 자료만 (전체 {state.materials.length}건 중 {changed.length}건)
              </label>

              <div className="io-row">
                <span className="io-label">불러오기</span>
                <div className="btn-group">
                  <button className="btn" onClick={refresh} disabled={!!busy}>AI WIKI 폴더 파일 보기</button>
                  {pickerConfigured() && (
                    <button className="btn btn-ghost" onClick={pick} disabled={!!busy} title="Obsidian 노트 등 이 앱이 만들지 않은 Drive 파일 선택">
                      내 Drive에서 파일 선택
                    </button>
                  )}
                </div>
              </div>

              {files &&
                (files.length === 0 ? (
                  <Empty>AI WIKI 폴더에 가져올 수 있는 파일이 없습니다.</Empty>
                ) : (
                  <ul className="import-list drive-list">
                    {files.map((f) => (
                      <li key={f.id}>
                        <span className={f.name.endsWith('.json') ? 'chip chip-muted' : 'chip'}>{f.name.endsWith('.json') ? '백업' : 'MD'}</span>
                        <span className="import-title">{f.name}</span>
                        <span className="muted small">{time(f.modifiedTime)}</span>
                        <button className="link small" onClick={() => importFiles([f])} disabled={!!busy}>가져오기</button>
                      </li>
                    ))}
                  </ul>
                ))}
            </>
          )}
        </>
      )}
      <div className="io-row">
        <ImportFlow label="" hideButton incoming={incoming} />
      </div>
    </Card>
  );
}
