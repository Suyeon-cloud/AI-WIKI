import { useState } from 'react';
import { useStore, useProject } from '../store';
import { AI_MODEL_LABEL, AiError, EFFORTS, aiState, generate, setApiKey, setEffort, type Effort } from '../lib/ai';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { ImportFlow, downloadBackup } from '../components/ImportExport';
import { DriveSync } from '../components/DriveSync';
import { ObsidianSync } from '../components/ObsidianSync';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';
import { vaultBaseDir } from '../lib/obsidian';
import { folderName } from '../lib/projects';

function AiSettings() {
  const { toast } = useStore();
  useConnections(); // 키 변경 시 다시 그림
  const s = aiState();
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    try {
      const r = await generate({ system: '짧게 답한다.', content: '연결 확인입니다. "연결됨" 한 단어로만 답하세요.', maxTokens: 2000, effort: 'low' });
      toast(`Claude 연결 확인: ${r.text.trim().slice(0, 20)} (${r.model})`);
    } catch (e) {
      toast(e instanceof AiError ? e.message : String(e), 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title="AI 설정 (Claude API)" extra={s.configured ? <StatusBadge s="real">설정됨</StatusBadge> : <span className="warn-tag">키 필요</span>}>
      <p className="muted small">
        AI 분석 · AI 집필 · PDF 서지 보완에 <b>{AI_MODEL_LABEL}</b>를 사용합니다. 키는 <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Claude Console</a>
        에서 만들 수 있으며, 사용량에 따라 요금이 부과됩니다.
      </p>
      {s.fromEnv ? (
        <p className="notice">
          <code>.env</code>의 <code>VITE_ANTHROPIC_API_KEY</code>를 사용 중입니다 ({s.masked}). 빌드 결과물(dist)을 다른 사람에게 배포하지 마세요 — 키가 포함됩니다.
        </p>
      ) : (
        <>
          {s.configured && (
            <p className="small">
              현재 키: <code>{s.masked}</code> {s.remembered ? '(이 브라우저에 기억)' : '(이 탭에서만 사용 — 탭을 닫으면 지워짐)'}{' '}
              <button className="link small" onClick={() => { setApiKey('', false); toast('API 키를 지웠습니다.', 'info'); }}>
                지우기
              </button>
            </p>
          )}
          <div className="io-row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" style={{ flex: 1 }} />
            <button
              className="btn btn-primary"
              disabled={!key.trim()}
              onClick={() => {
                setApiKey(key, remember);
                setKey('');
                toast('API 키를 저장했습니다. "연결 확인"으로 확인해 보세요.');
              }}
            >
              저장
            </button>
          </div>
          <label className="radio small" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            이 브라우저에 기억 (공용 PC에서는 사용하지 마세요). 키는 백업 파일에 포함되지 않습니다.
          </label>
        </>
      )}
      <div className="io-row">
        <span className="io-label">분석 깊이</span>
        <div className="seg">
          {EFFORTS.map((e) => (
            <button key={e.key} className={s.effort === e.key ? 'active' : ''} onClick={() => setEffort(e.key as Effort)}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={test} disabled={!s.configured || testing}>
          {testing ? '확인 중…' : '연결 확인'}
        </button>
        <span className="muted small">거절 응답 시 서버 측 대체 모델(fallback)로 자동 재시도합니다.</span>
      </div>
    </Card>
  );
}

export function Settings() {
  const { state, dispatch, toast, storageError, saveBlocked, resumeSave } = useStore();
  const { project } = useProject();
  const nav = useNav();
  const [confirmReset, setConfirmReset] = useState(false);
  const conn = useConnections();
  const samples = state.materials.filter((m) => m.isSample);

  return (
    <>
      <PageHeader title="연구 설정" desc="AI·Obsidian·Google Drive 연결과 데이터 백업을 관리합니다." />

      <div className="settings-layout">
        <div>
          <Card title="현재 프로젝트" extra={project && <button className="btn btn-sm" onClick={() => nav.editProject(project)}>정보 수정</button>}>
            {project ? (
              <dl className="meta">
                <dt>이름</dt><dd>{project.name}</dd>
                <dt>논문 주제</dt><dd>{project.topic}</dd>
                <dt>키워드</dt><dd className="chips">{project.keywords.map((k) => <span key={k} className="chip">{k}</span>)}</dd>
                <dt>학위 · 학과</dt><dd>{project.degree} · {project.department || '-'}</dd>
                <dt>지도교수</dt><dd>{project.advisor || '-'}</dd>
                <dt>폴더</dt>
                <dd className="small">
                  Obsidian:{' '}
                  {project.obsidianPath ? (
                    project.obsidianPath
                  ) : conn.obsidian ? (
                    <>
                      연결됨 · 프로젝트 폴더는 첫 저장 시 생성
                      <span className="muted"> (예정 경로: {conn.vaultName}/{[vaultBaseDir(), folderName(project)].filter(Boolean).join('/')})</span>
                    </>
                  ) : (
                    'Vault 미연결'
                  )}
                  <br />
                  Drive: {project.driveFolderId ? `AI WIKI/${project.name}` : '없음'}
                </dd>
              </dl>
            ) : (
              <button className="btn btn-primary" onClick={nav.newProject}>＋ 새 프로젝트</button>
            )}
          </Card>
          <AiSettings />
          <ObsidianSync />
          <DriveSync />
        </div>

        <div>
          <Card title="데이터 백업 · 복원" extra={<StatusBadge s="local" />}>
            <p className="muted small">프로젝트·자료(관점·서지정보 포함)·AI 결과물·집필 원고를 JSON 파일 하나로 백업합니다. API 키와 Google 로그인 정보는 포함되지 않습니다.</p>
            {saveBlocked && (
              <div className="notice err">
                ⚠ 브라우저에 저장된 데이터를 읽지 못해, 원본을 덮어쓰지 않도록 자동 저장을 중지했습니다. 백업 파일로 복원하면 다시 저장됩니다.
                <button className="btn btn-sm btn-danger-ghost" onClick={() => { resumeSave(); toast('자동 저장을 재개했습니다.', 'info'); }}>
                  현재 상태로 저장 재개
                </button>
              </div>
            )}
            {storageError && <p className="notice err">⚠ {storageError}: 최근 변경 내용이 브라우저에 저장되지 않았습니다. 지금 백업 파일을 받아 두세요.</p>}
            <div className="actions">
              <button className="btn btn-primary" onClick={() => { downloadBackup(state); toast('전체 상태를 JSON 파일로 백업했습니다.'); }}>
                전체 백업 받기
              </button>
              <ImportFlow label="백업 파일에서 복원" accept=".json" />
            </div>
          </Card>

          {samples.length > 0 && (
            <Card title="이전 버전 샘플 자료">
              <p className="muted small">이전 판본의 샘플(가상) 자료 {samples.length}건이 남아 있습니다. 실제 연구자료만 남기려면 삭제하세요.</p>
              <button className="btn btn-danger-ghost" onClick={() => { dispatch({ type: 'removeMany', ids: samples.map((m) => m.id) }); toast(`샘플 자료 ${samples.length}건을 삭제했습니다.`); }}>
                샘플 자료 {samples.length}건 삭제
              </button>
            </Card>
          )}

          <Card title="데이터 초기화">
            <p className="muted small">모든 프로젝트·자료·AI 결과물을 이 브라우저에서 지웁니다. Obsidian·Drive에 저장한 파일은 지워지지 않습니다. 먼저 전체 백업을 받으세요.</p>
            {confirmReset ? (
              <div className="actions">
                <button className="btn btn-danger" onClick={() => { dispatch({ type: 'reset' }); setConfirmReset(false); toast('모든 데이터를 지웠습니다.'); }}>
                  초기화 확인
                </button>
                <button className="btn" onClick={() => setConfirmReset(false)}>취소</button>
              </div>
            ) : (
              <button className="btn btn-danger-ghost" onClick={() => setConfirmReset(true)}>모든 데이터 지우기</button>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
