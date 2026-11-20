import { useState } from 'react';
import { useStore, useProject } from '../store';
import { AiError, EFFORTS, aiModelLabel, aiState, aiWritingModel, generate, refreshAi, setSessionApiKey, setEffort, type Effort } from '../lib/ai';
import { AI_MODELS, DEFAULT_PRICES, normCost, usd } from '../lib/ai-cost';
import { useCostSettings } from '../components/CostConfirm';
import { Card, PageHeader } from '../components/ui';
import { ImportFlow, downloadBackup } from '../components/ImportExport';
import { DriveSync } from '../components/DriveSync';
import { ObsidianSync } from '../components/ObsidianSync';
import { ClipEnrich } from '../components/ClipEnrich';
import { YoutubeEnrich } from '../components/YoutubeEnrich';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';
import { vaultBaseDir } from '../lib/obsidian';
import { folderName } from '../lib/projects';

function AiSettings() {
  const { toast } = useStore();
  useConnections();
  const s = aiState();
  const [testing, setTesting] = useState(false);
  const [key, setKey] = useState('');
  async function test() {
    setTesting(true);
    try {
      await refreshAi();
      if (!aiState().configured) throw new AiError(aiState().message);
      const result = await generate({ system:'짧게 답한다.', content:'연결 확인입니다. 연결됨 한 단어로 답하세요.', maxTokens:2000, effort:'low' });
      toast(`Claude 연결 확인: ${result.text.trim().slice(0,20)} (${result.model})`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Claude 연결 오류', 'error'); }
    finally { setTesting(false); }
  }
  return <Card title="AI 설정 (Claude API)" extra={<span className={s.configured ? 'ok-tag' : 'warn-tag'}>{s.hasKey ? '이 탭에 키 입력됨' : '본인 키 필요'}</span>}>
    <p className="muted small">기본 모델: 분석 {aiModelLabel()} · 집필 {aiModelLabel(aiWritingModel())} (아래 'AI 비용 설정'에서 변경). 각자 본인의 API 키를 입력하며 해당 API 계정에 요금이 청구됩니다. 키는 서버를 거쳐 Claude에 전달됩니다.</p>
    <p className="notice">{s.message}</p>
    <div className="io-row">
      <input type="password" aria-label="본인 Claude API 키" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
      <button className="btn btn-primary" disabled={!key.trim() || testing} onClick={() => { try { setSessionApiKey(key); setKey(''); toast('이 탭에서 사용할 키를 적용했습니다.'); } catch (e) { toast(e instanceof Error ? e.message : '키 형식 오류', 'error'); } }}>이 탭에서 사용</button>
      {s.hasKey && <button className="btn" onClick={() => { setSessionApiKey(''); setKey(''); }}>키 지우기</button>}
    </div>
    <p className="muted small">키는 Supabase나 브라우저 저장소에 저장하지 않습니다. 새로고침·탭 닫기·로그아웃 후에는 다시 입력해 주세요.</p>
    <div className="io-row"><span className="io-label">분석 깊이</span><div className="seg">{EFFORTS.map((e) => <button key={e.key} className={s.effort === e.key ? 'active' : ''} onClick={() => setEffort(e.key as Effort)}>{e.label}</button>)}</div></div>
    <button className="btn" onClick={test} disabled={testing || !s.hasKey}>{testing ? '확인 중…' : '연결 확인'}</button>
    <p className="muted small">연결 확인은 짧은 AI 요청을 보내며 API 사용 요금이 발생합니다.</p>
  </Card>;
}

/** 기본 모델·분석 1회 한도·모델별 단가 (계정별, 이 브라우저에 저장) */
function AiCostSettings() {
  const { toast } = useStore();
  const [cost, setCost] = useCostSettings();
  const [draft, setDraft] = useState(cost);
  const dirty = JSON.stringify(draft) !== JSON.stringify(cost);
  const price = (id: string, k: 'input' | 'output', v: string) =>
    setDraft((d) => ({ ...d, prices: { ...d.prices, [id]: { ...d.prices[id], [k]: Number(v) } } }));
  return <Card title="AI 비용 설정" extra={<span className="muted small">분석 {AI_MODELS.find((m) => m.id === cost.model)?.label} · 집필 {AI_MODELS.find((m) => m.id === cost.writingModel)?.label}</span>}>
    <p className="muted small">기능별 기본 모델(분석·서지 보정·관련도 / 집필)과, 분석 1회에 허용할 입력 토큰·비용 한도입니다. 한도를 넘을 것으로 예상되면 실행 전에 한 번 더 확인합니다. 단가는 예상 비용 계산에만 쓰입니다.</p>
    <div className="form-grid">
      <label>AI 분석 기본 모델
        <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
          {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note})</option>)}
        </select>
      </label>
      <label>AI 집필 기본 모델
        <select value={draft.writingModel} onChange={(e) => setDraft({ ...draft, writingModel: e.target.value })}>
          {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note})</option>)}
        </select>
      </label>
      <label>분석 1회 입력 토큰 한도
        <input type="number" min={1000} step={1000} value={draft.maxInputTokens} onChange={(e) => setDraft({ ...draft, maxInputTokens: Number(e.target.value) })} />
      </label>
      <label>분석 1회 비용 한도 (USD)
        <input type="number" min={0.001} step={0.01} value={draft.maxCostUsd} onChange={(e) => setDraft({ ...draft, maxCostUsd: Number(e.target.value) })} />
      </label>
    </div>
    <table className="table compact cost-prices">
      <thead><tr><th>모델</th><th>입력 $/100만 토큰</th><th>출력 $/100만 토큰</th></tr></thead>
      <tbody>
        {AI_MODELS.map((m) => (
          <tr key={m.id}>
            <td>{m.label}{DEFAULT_PRICES[m.id].tierAbove ? <small className="muted"> (입력 {DEFAULT_PRICES[m.id].tierAbove!.toLocaleString()} 토큰 초과 시 {usd(DEFAULT_PRICES[m.id].inputHigh!)} / {usd(DEFAULT_PRICES[m.id].outputHigh!)})</small> : null}</td>
            <td><input type="number" min={0} step={0.01} value={draft.prices[m.id]?.input ?? 0} onChange={(e) => price(m.id, 'input', e.target.value)} /></td>
            <td><input type="number" min={0} step={0.01} value={draft.prices[m.id]?.output ?? 0} onChange={(e) => price(m.id, 'output', e.target.value)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="actions">
      <button className="btn btn-primary" disabled={!dirty} onClick={() => { const n = normCost(draft); setCost(n); setDraft(n); toast('AI 비용 설정을 저장했습니다.'); }}>저장</button>
      <button className="btn" onClick={() => setDraft(normCost({ model: draft.model, writingModel: draft.writingModel }))}>단가·한도 기본값</button>
    </div>
  </Card>;
}

export function Settings() {
  const { state, dispatch, toast, storageError } = useStore();
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
          <AiCostSettings />
          <ObsidianSync />
          <ClipEnrich />
          <YoutubeEnrich />
          <div id="drive-settings"><DriveSync /></div>
        </div>

        <div>
          <Card title="데이터 백업 · 복원" extra={<span className="ok-tag">Supabase · 계정별 저장</span>}>
            <p className="muted small">프로젝트·자료(관점·서지정보 포함)·AI 결과물·집필 원고를 JSON 파일 하나로 백업합니다. API 키와 Google 로그인 정보는 포함되지 않습니다.</p>
            {storageError && <p className="notice err">⚠ {storageError} 최근 변경은 아직 서버에 저장되지 않았습니다. 먼저 전체 백업을 받아 주세요.</p>}
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
            <p className="muted small">현재 로그인한 계정의 모든 프로젝트·자료·AI 결과물을 Supabase에서 지웁니다. Obsidian·Drive에 저장한 파일은 지워지지 않습니다. 먼저 전체 백업을 받으세요.</p>
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
