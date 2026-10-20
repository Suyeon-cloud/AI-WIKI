import type { PageKey } from '../types';
import { useStore } from '../store';

export const NAV: { key: PageKey; label: string; icon: string }[] = [
  { key: 'dashboard', label: '대시보드', icon: '▦' },
  { key: 'collect', label: '자료 수집', icon: '＋' },
  { key: 'library', label: '자료 라이브러리', icon: '▤' },
  { key: 'analysis', label: 'AI 분석', icon: '◎' },
  { key: 'writing', label: 'AI 집필', icon: '✎' },
  { key: 'references', label: '참고문헌', icon: '❝' },
  { key: 'settings', label: '연구 설정', icon: '⚙' },
];

export function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: (p: PageKey) => void }) {
  const { state } = useStore();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">AI</div>
        <div>
          <div className="brand-name">AI WIKI</div>
          <div className="brand-sub">Research Knowledge Workspace</div>
        </div>
      </div>

      <div className="project-box">
        <div className="project-label">현재 연구 프로젝트</div>
        <div className="project-title">{state.settings.topic}</div>
        <div className="project-meta">자료 {state.materials.length}건</div>
      </div>

      <nav className="nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${page === n.key ? 'active' : ''}`}
            onClick={() => onNavigate(n.key)}
          >
            <span className="nav-icon" aria-hidden>
              {n.icon}
            </span>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="legend">
          <span className="badge badge-real">실제 기능</span>
          <span className="badge badge-demo">Demo</span>
          <span className="badge badge-planned">연동 예정</span>
        </div>
        <p>2차 판본 · 기본 데이터는 브라우저(localStorage)에 저장되며, Google Drive 백업 및 Obsidian 연동을 지원합니다.</p>
      </div>
    </aside>
  );
}
