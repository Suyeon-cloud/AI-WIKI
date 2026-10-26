import { useEffect, useReducer } from 'react';
import type { PageKey } from '../types';
import { useStore, useProject } from '../store';
import { aiState, subscribeAi } from '../lib/ai';
import { driveState, subscribeDrive } from '../lib/drive';
import { subscribeVault, vaultState } from '../lib/obsidian';
import { useNav } from './ProjectDialog';

export const NAV: { key: PageKey; label: string; icon: string; step?: number }[] = [
  { key: 'home', label: '시작하기', icon: '⌂' },
  { key: 'dashboard', label: '대시보드', icon: '▦' },
  { key: 'collect', label: '자료 수집', icon: '＋', step: 1 },
  { key: 'library', label: '자료 라이브러리', icon: '▤', step: 2 },
  { key: 'analysis', label: 'AI 분석', icon: '◎', step: 3 },
  { key: 'references', label: '참고문헌', icon: '❝', step: 4 },
  { key: 'writing', label: 'AI 집필', icon: '✎', step: 5 },
  { key: 'settings', label: '연구 설정', icon: '⚙' },
];

/** 외부 연결 상태가 바뀌면 다시 그린다 */
export function useConnections() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const offs = [subscribeAi(rerender), subscribeDrive(rerender), subscribeVault(rerender)];
    return () => offs.forEach((off) => off());
  }, []);
  const v = vaultState();
  return { ai: aiState().configured, drive: driveState().status === 'connected', obsidian: !!v.handle && v.granted, vaultName: v.handle?.name };
}

export function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: (p: PageKey) => void }) {
  const { state, dispatch } = useStore();
  const { project, materials } = useProject();
  const nav = useNav();
  const c = useConnections();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">AI</div>
        <div>
          <div className="brand-name">AI WIKI</div>
          <div className="brand-sub">HUFS 학위논문 연구 워크스페이스</div>
        </div>
      </div>

      <div className="project-box">
        <div className="project-label">현재 프로젝트</div>
        {state.projects.length ? (
          <select
            className="project-select"
            value={project?.id ?? ''}
            onChange={(e) => dispatch({ type: 'selectProject', id: e.target.value })}
            aria-label="프로젝트 선택"
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="project-title muted">프로젝트 없음</div>
        )}
        {project && (
          <div className="project-meta">
            자료 {materials.length}건 · {project.status}
          </div>
        )}
        <button className="btn btn-sm full" style={{ marginTop: 8 }} onClick={nav.newProject}>
          ＋ 새 프로젝트
        </button>
      </div>

      <nav className="nav">
        {NAV.map((n) => (
          <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => onNavigate(n.key)}>
            <span className="nav-icon" aria-hidden>
              {n.step ?? n.icon}
            </span>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="conn-list">
          <button className={`conn ${c.ai ? 'on' : ''}`} onClick={() => onNavigate('settings')} title="Claude API 키 설정">
            <i /> Claude AI {c.ai ? '연결됨' : '설정 필요'}
          </button>
          <button className={`conn ${c.obsidian ? 'on' : ''}`} onClick={() => onNavigate('settings')} title="Obsidian Vault 폴더">
            <i /> Obsidian {c.obsidian ? c.vaultName : '미연결'}
          </button>
          <button className={`conn ${c.drive ? 'on' : ''}`} onClick={() => onNavigate('settings')} title="Google Drive">
            <i /> Google Drive {c.drive ? '연결됨' : '미연결'}
          </button>
        </div>
        <p>자료는 이 브라우저(localStorage)에 저장됩니다. 연구 설정에서 정기적으로 백업하세요.</p>
      </div>
    </aside>
  );
}
