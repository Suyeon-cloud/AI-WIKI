import { useEffect, useReducer, useState } from 'react';
import { useStore } from '../store';
import { buildBackup } from '../lib/data';
import { formatDate } from '../lib/utils';
import { DRIVE_ROOT_NAME, DriveError, connectDrive, createFile, disconnectDrive, driveState, ensureFolders, subscribeDrive } from '../lib/drive';
import { Card, StatusBadge } from './ui';
import { DriveImportModal } from './DriveImport';

const time = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Google Drive 연결 카드
 * - 자료 가져오기: Drive 목록 창에서 체크한 파일만 (PDF·Markdown·백업)
 * - 원본 자료 Markdown 보내기: 자료 라이브러리에서 선택 → 'Drive로 보내기'
 * - AI 결과물: AI 분석·집필 화면에서 프로젝트 'AI 생성' 폴더로 저장
 * - 전체 백업 JSON: 내 Drive/AI WIKI/
 */
export function DriveSync() {
  const { state, toast } = useStore();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeDrive(rerender), []);
  const { status, expiresAt } = driveState();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
    <Card title="Google Drive" extra={badge}>
      {status === 'unconfigured' ? (
        <p className="notice">
          Google Drive 연결이 설정되지 않았습니다. 프로젝트 폴더의 <code>.env</code>에 <code>VITE_GOOGLE_CLIENT_ID</code>를 입력하고 개발 서버를 다시 시작하세요
          (<code>.env.example</code>, README 참고).
        </p>
      ) : (
        <>
          <p className="muted small">
            Drive는 <b>자료를 가져오는 곳</b>이자 AI 결과물 보관처입니다. 프로젝트마다 <code>{DRIVE_ROOT_NAME}/프로젝트/자료</code>와{' '}
            <code>{DRIVE_ROOT_NAME}/프로젝트/AI 생성</code> 폴더를 씁니다. 로그인 정보는 이 탭의 메모리에만 있고 저장되지 않습니다.
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
            <div className="btn-group" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setOpen(true)} disabled={!!busy}>
                Drive 자료 목록 열기
              </button>
              <button className="btn" onClick={saveBackup} disabled={!!busy}>
                전체 백업을 Drive에 저장
              </button>
            </div>
          )}
        </>
      )}
      {open && <DriveImportModal onClose={() => setOpen(false)} />}
    </Card>
  );
}
