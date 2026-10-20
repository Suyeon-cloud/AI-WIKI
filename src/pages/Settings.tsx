import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Card, PageHeader, StatusBadge, type Status } from '../components/ui';
import { ImportFlow, downloadBackup } from '../components/ImportExport';
import { DriveSync } from '../components/DriveSync';
import { ObsidianSync } from '../components/ObsidianSync';
import type { ResearchSettings } from '../types';

const INTEGRATIONS: { name: string; status: Status; label: string; desc: string }[] = [
  { name: 'Obsidian', status: 'real', label: '폴더 연결 · 파일 교류', desc: 'Chrome·Edge에서 Vault 폴더를 직접 선택해 Markdown을 저장·불러오기 합니다. 그 외 브라우저는 .md 가져오기·내보내기를 사용합니다. 자동 동기화는 하지 않습니다.' },
  { name: 'Google Drive', status: 'real', label: '수동 저장·불러오기', desc: 'Google 계정 연결 후 전체 백업(JSON)과 자료별 Markdown을 내 Drive의 AI WIKI 폴더에 저장하고 다시 불러옵니다. 자동·양방향 동기화는 하지 않습니다. .env 설정이 필요합니다.' },
  { name: 'AI API', status: 'demo', label: 'Demo', desc: '외부 AI를 호출하지 않으며, 준비된 샘플 결과를 표시합니다.' },
  { name: 'HWPX 출력', status: 'planned', label: '연동 예정', desc: 'HWPX 파싱 및 파일 생성은 추후 지원 예정입니다.' },
  { name: '데이터 저장', status: 'local', label: '브라우저 localStorage', desc: '서버나 클라우드에 저장되지 않으며, 브라우저 데이터 삭제 시 함께 사라집니다. 주소(포트)가 바뀌면 다른 저장소로 취급되므로 개발 서버는 5173 포트로 고정되어 있습니다. 정기적으로 전체 백업 파일을 받아 두세요.' },
];

export function Settings() {
  const { state, dispatch, toast, storageError, saveBlocked, resumeSave } = useStore();
  const [form, setForm] = useState<ResearchSettings>(state.settings);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => setForm(state.settings), [state.settings]);

  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings);

  function save() {
    if (!form.topic.trim()) return toast('연구 주제를 입력하세요.', 'error');
    dispatch({
      type: 'settings',
      settings: { ...form, topic: form.topic.trim(), keywords: form.keywords.map((k) => k.trim()) },
    });
    toast('연구 설정을 저장했습니다. 새로고침 후에도 유지됩니다.');
  }

  return (
    <>
      <PageHeader
        title="연구 설정"
        desc="논문 주제, 키워드, 연구 개요와 기본 분석 관점을 설정합니다. 다른 화면의 분석·집필 Demo에 반영됩니다."
        badges={<><StatusBadge s="real" /><StatusBadge s="local" /></>}
      />

      <div className="settings-layout">
        <Card title="연구 정보">
          <label className="field">
            <span className="field-label">논문 / 연구 주제</span>
            <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </label>
          <div className="field">
            <span className="field-label">키워드 (5개)</span>
            <div className="kw-inputs">
              {form.keywords.map((k, i) => (
                <label key={i} className="kw-input">
                  <span>{i + 1}</span>
                  <input
                    value={k}
                    onChange={(e) => {
                      const keywords = [...form.keywords];
                      keywords[i] = e.target.value;
                      setForm({ ...form, keywords });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">연구 개요</span>
            <textarea rows={5} value={form.overview} onChange={(e) => setForm({ ...form, overview: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">기본 분석 관점 (내 관점)</span>
            <textarea rows={3} value={form.defaultView} onChange={(e) => setForm({ ...form, defaultView: e.target.value })} />
          </label>
          <div className="actions">
            <button className="btn btn-primary" onClick={save} disabled={!dirty}>
              저장
            </button>
            <button className="btn" onClick={() => setForm(state.settings)} disabled={!dirty}>
              되돌리기
            </button>
            {dirty && <span className="small muted">저장되지 않은 변경사항이 있습니다.</span>}
          </div>
        </Card>

        <div>
          <Card title="연동 상태">
            <ul className="integrations">
              {INTEGRATIONS.map((it) => (
                <li key={it.name}>
                  <div className="int-head">
                    <b>{it.name}</b>
                    <StatusBadge s={it.status}>{it.label}</StatusBadge>
                  </div>
                  <p className="muted small">{it.desc}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="데이터 백업 · 복원" extra={<StatusBadge s="real" />}>
            <p className="muted small">
              자료(분석 결과·내 관점·서지정보·참고문헌 선택 포함), 연구 설정, 집필 상태와 이력을 JSON 파일 하나로 백업합니다.
              복원 전에 자료 수와 포함 항목을 확인하고, 전체 복원 또는 자료만 병합을 선택할 수 있습니다.
            </p>
            {saveBlocked && (
              <div className="notice err">
                ⚠ 브라우저에 저장된 데이터를 읽지 못해, 원본을 덮어쓰지 않도록 자동 저장을 중지했습니다. 백업 파일로 복원하면 다시 저장됩니다.
                <button
                  className="btn btn-sm btn-danger-ghost"
                  onClick={() => {
                    resumeSave();
                    toast('자동 저장을 재개했습니다. 읽지 못한 기존 데이터는 현재 상태로 대체됩니다.', 'info');
                  }}
                >
                  현재 상태로 저장 재개
                </button>
              </div>
            )}
            {storageError && (
              <p className="notice err">⚠ {storageError}: 최근 변경 내용이 브라우저에 저장되지 않았습니다. 지금 백업 파일을 받아 두세요.</p>
            )}
            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  downloadBackup(state);
                  toast('전체 상태를 JSON 파일로 백업했습니다.');
                }}
              >
                전체 백업 받기
              </button>
              <ImportFlow label="백업 파일에서 복원" accept=".json" />
            </div>
          </Card>

          <ObsidianSync />

          <DriveSync />

          <Card title="데이터 초기화">
            <p className="muted small">모든 자료·설정·집필 내용을 지우고 초기 샘플 상태로 되돌립니다. 필요하면 먼저 위에서 전체 백업을 받으세요.</p>
            {confirmReset ? (
              <div className="actions">
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    dispatch({ type: 'reset' });
                    setConfirmReset(false);
                    toast('초기 샘플 상태로 되돌렸습니다.');
                  }}
                >
                  초기화 확인
                </button>
                <button className="btn" onClick={() => setConfirmReset(false)}>취소</button>
              </div>
            ) : (
              <button className="btn btn-danger-ghost" onClick={() => setConfirmReset(true)}>샘플 데이터로 초기화</button>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
