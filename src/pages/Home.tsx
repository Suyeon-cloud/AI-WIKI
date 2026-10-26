import type { PageKey } from '../types';
import { useStore, useProject } from '../store';
import { useNav } from '../components/ProjectDialog';
import { useConnections } from '../components/Sidebar';
import { hasMyView } from '../types';

/** 동작 흐름도: 프로젝트 → 자료 수집 → 라이브러리 → AI 분석 → 참고문헌 → AI 집필 → HWPX 출력·저장, 아래는 외부 저장소 */
function FlowDiagram({ go }: { go: (p: PageKey) => void }) {
  const steps: { no: string; title: string; sub: string; page: PageKey }[] = [
    { no: '①', title: '프로젝트', sub: '논문 주제 단위', page: 'dashboard' },
    { no: '②', title: '자료 수집', sub: 'KCI PDF · Drive', page: 'collect' },
    { no: '③', title: '자료 라이브러리', sub: '주제별 폴더', page: 'library' },
    { no: '④', title: 'AI 분석', sub: '전체 · 선택 논문', page: 'analysis' },
    { no: '⑤', title: '참고문헌', sub: '서지사항 목록', page: 'references' },
    { no: '⑥', title: 'AI 집필', sub: '외대 서식 원고', page: 'writing' },
    { no: '⑦', title: 'HWPX 출력·저장', sub: '내려받기 · Drive AI 생성', page: 'writing' },
  ];
  return (
    <div className="flow-map" aria-label="AI WIKI 동작 흐름도">
      <ol className="flow-steps">
        {steps.map((s, i) => (
          <li key={s.no}>
            <button className="flow-step" onClick={() => go(s.page)}>
              <span className="flow-no">{s.no}</span>
              <b className="flow-title">{s.title}</b>
              <span className="flow-sub">{s.sub}</span>
            </button>
            {i < steps.length - 1 && (
              <span className="flow-arrow" aria-hidden>
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="flow-stores">
        <div className="flow-store">
          <b>Obsidian · Google Drive</b>
          <span>프로젝트/자료 폴더 (원본 자료)</span>
          <small>폴더 생성 · 가져오기(체크 선택) · 보내기</small>
        </div>
        <div className="flow-store flow-ai">
          <b>Google Drive · Obsidian</b>
          <span>프로젝트/AI 생성 폴더 (AI 결과물)</span>
          <small>AI 분석·집필 결과 저장</small>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const { state } = useStore();
  const { project, materials, outputs, thesis } = useProject();
  const nav = useNav();
  const c = useConnections();

  const checks: { done: boolean; title: string; desc: string; action: string; run: () => void }[] = [
    { done: c.ai, title: 'Claude API 키 설정', desc: 'AI 분석·집필·서지 추출에 사용', action: '설정하기', run: () => nav.go('settings') },
    { done: c.obsidian, title: 'Obsidian Vault 폴더 연결', desc: '자료·AI 결과물을 Markdown 노트로 보관', action: '연결하기', run: () => nav.go('settings') },
    { done: c.drive, title: 'Google Drive 연결', desc: 'Drive의 PDF·노트를 골라 가져오고, AI 결과물 저장', action: '연결하기', run: () => nav.go('settings') },
    { done: !!project, title: '연구 프로젝트 만들기', desc: '논문 주제 = 라이브러리 폴더 = Obsidian/Drive 폴더', action: '만들기', run: nav.newProject },
    { done: materials.length > 0, title: '자료 모으기', desc: 'KCI 논문 PDF를 끌어다 놓으면 초록·서지 자동 추출', action: '자료 수집', run: () => nav.go('collect') },
    { done: materials.some(hasMyView), title: '나의 관점 기록', desc: '자료마다 내 해석을 직접 적기 (AI가 대신 쓰지 않음)', action: '라이브러리', run: () => nav.go('library') },
    { done: outputs.some((o) => o.kind === '전체 분석'), title: 'AI 전체 분석', desc: '모은 자료 전체에서 쟁점·공백·인사이트 도출', action: 'AI 분석', run: () => nav.go('analysis') },
    { done: !!thesis?.chapters.some((ch) => ch.text.trim()), title: 'AI 집필 → HWPX', desc: '지도교수·목차를 정하고 외대 서식 원고 생성', action: 'AI 집필', run: () => nav.go('writing') },
  ];
  const doneCount = checks.filter((x) => x.done).length;

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">HUFS 학위논문 연구 워크스페이스</div>
          <h1>모은 자료에서 논문까지, 한 흐름으로</h1>
          <p>
            KCI 논문 PDF를 넣으면 초록과 서지사항이 정리되고, Claude AI가 모은 자료 전체를 읽어 연구 공백과 인사이트를 짚어 줍니다. 마지막에는
            한국외대 학위논문 서식 그대로 HWPX 원고를 만듭니다.
          </p>
          <div className="btn-group">
            {project ? (
              <button className="btn btn-primary" onClick={() => nav.go('collect')}>
                자료 수집 계속하기 →
              </button>
            ) : (
              <button className="btn btn-primary" onClick={nav.newProject}>
                ＋ 첫 프로젝트 만들기
              </button>
            )}
            <button className="btn" onClick={() => nav.go('dashboard')}>
              대시보드
            </button>
          </div>
        </div>
        <div className="hero-stats">
          <div>
            <b>{state.projects.length}</b>
            <span>프로젝트</span>
          </div>
          <div>
            <b>{state.materials.length}</b>
            <span>연구자료</span>
          </div>
          <div>
            <b>{state.aiOutputs.length}</b>
            <span>AI 결과물</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>동작 흐름도</h3>
          <span className="muted small">단계를 누르면 해당 화면으로 이동합니다</span>
        </div>
        <FlowDiagram go={nav.go} />
      </section>

      <div className="grid-2-1">
        <section className="card">
          <div className="card-head">
            <h3>시작 체크리스트</h3>
            <span className="muted small">
              {doneCount} / {checks.length} 완료
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${(doneCount / checks.length) * 100}%` }} />
          </div>
          <ol className="checklist">
            {checks.map((x) => (
              <li key={x.title} className={x.done ? 'done' : ''}>
                <span className="check-mark">{x.done ? '✓' : ''}</span>
                <div>
                  <b>{x.title}</b>
                  <span className="muted small">{x.desc}</span>
                </div>
                {!x.done && (
                  <button className="btn btn-sm" onClick={x.run}>
                    {x.action}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>AI 분석과 AI 집필은 어떻게 다른가요?</h3>
          </div>
          <div className="diff-box">
            <div>
              <h4>◎ AI 분석 — 판단과 인사이트</h4>
              <p>
                내가 <b>주제·키워드</b>를 주면, 모아 둔 <b>자료 전체</b>를 AI가 읽고 주제 지형·쟁점·연구 공백·내 연구의 차별점을 판단합니다. 선택한
                논문 한 편만 깊게 분석할 수도 있습니다.
              </p>
            </div>
            <div>
              <h4>✎ AI 집필 — 외대 서식 원고</h4>
              <p>
                <b>지도교수·목차</b>를 정하면, 학위논문집필 스킬(외대 서식 규칙)에 따라 장별 원고를 쓰고 표지·심사청구서·인정서·참고문헌까지{' '}
                <b>HWPX</b>로 출력합니다.
              </p>
            </div>
          </div>
          <h4 className="sub-title">자료와 AI 결과물은 섞이지 않습니다</h4>
          <p className="muted small">
            라이브러리에는 내가 모은 원본 자료만 들어갑니다. AI가 만든 분석·원고는 <b>AI 결과물</b>로 따로 보관되고, Google Drive·Obsidian에서도{' '}
            <code>프로젝트/AI 생성</code> 폴더에 따로 저장됩니다.
          </p>
        </section>
      </div>
    </>
  );
}
