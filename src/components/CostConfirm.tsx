import { useEffect, useState } from 'react';
import { authUser } from '../lib/auth';
import { AI_MODELS, loadCost, modelLabel, saveCost, usd, type CostSettings, type Estimate } from '../lib/ai-cost';
import { Modal } from './ui';

const EVENT = 'ai-wiki:ai-cost-changed';

/** 계정별 AI 비용 설정 (연구 설정에서 바꾸면 열린 화면에도 반영) */
export function useCostSettings(): [CostSettings, (s: CostSettings) => void] {
  const [s, setS] = useState<CostSettings>(() => loadCost(authUser()?.id));
  useEffect(() => {
    const on = () => setS(loadCost(authUser()?.id));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [
    s,
    (next) => {
      saveCost(authUser()?.id, next);
      window.dispatchEvent(new Event(EVENT));
    },
  ];
}

/** 분석에 쓸 모델 고르기 (기본값은 연구 설정의 기본 모델) */
export function ModelSelect({ value, onChange, disabled }: { value: string; onChange: (m: string) => void; disabled?: boolean }) {
  return (
    <label className="model-select">
      모델
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {AI_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.note})
          </option>
        ))}
      </select>
    </label>
  );
}

/** 실행 전 예상 입력량·호출 수·비용 확인. 한도를 넘으면 한 번 더 확인해야 실행된다 */
export function CostConfirm({
  title,
  estimate: e,
  settings,
  notes,
  onConfirm,
  onClose,
}: {
  title: string;
  estimate: Estimate;
  settings: CostSettings;
  notes: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const over = e.overTokens || e.overCost;
  const [agree, setAgree] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={over && !agree}>
            분석 시작
          </button>
        </>
      }
    >
      <table className="table cost-table">
        <tbody>
          <tr><th>모델</th><td>{modelLabel(e.model)}</td></tr>
          <tr><th>AI 호출</th><td>{e.calls}회</td></tr>
          <tr><th>예상 입력</th><td>약 {e.inputTokens.toLocaleString()} 토큰 {e.overTokens && <span className="warn-tag">한도 {settings.maxInputTokens.toLocaleString()} 초과</span>}</td></tr>
          <tr><th>출력 상한</th><td>{e.maxOutputTokens.toLocaleString()} 토큰 (생각 토큰 포함)</td></tr>
          <tr><th>예상 비용</th><td>약 {usd(e.expectedUsd)} · 최대 {usd(e.maxUsd)} {e.overCost && <span className="warn-tag">한도 {usd(settings.maxCostUsd)} 초과</span>}</td></tr>
        </tbody>
      </table>
      <ul className="small cost-notes">
        {notes.map((n) => <li key={n}>{n}</li>)}
        <li className="muted">토큰은 글자 수로 어림한 값이고, 비용은 연구 설정의 단가로 계산합니다. 실제 사용량은 분석 결과에 표시됩니다.</li>
      </ul>
      {over && (
        <label className="radio">
          <input type="checkbox" checked={agree} onChange={(x) => setAgree(x.target.checked)} />
          한도를 넘는 것을 확인했고 이번 분석은 그대로 진행합니다
        </label>
      )}
    </Modal>
  );
}
