import { useCallback, useEffect, useState } from 'react';
import type { PageKey } from '../types';
import { NAV, pageFromHash } from './Sidebar';
import { Card, PageHeader } from './ui';
import { Footer } from './Footer';
import { GoogleLoginButton } from './LoginScreen';
import { FlowDiagram } from '../pages/Home';

/**
 * 로그인 전 둘러보기.
 * 계정 저장소를 만들지 않으므로 서버 자료를 읽지 않고, 저장·AI 실행 화면도 그리지 않는다.
 * 각 메뉴는 기능 소개만 보여 주고, 실제 사용은 로그인으로 안내한다.
 */
const GUIDES: Record<Exclude<PageKey, 'home'>, { title: string; desc: string; points: string[] }> = {
  dashboard: {
    title: '대시보드',
    desc: '논문 주제(프로젝트) 단위로 연구 진행 상황과 이력을 확인합니다.',
    points: ['프로젝트 만들기·전환·정보 수정', '프로젝트 이력 표와 활동 기록', '자료 수, 나의 관점 작성 현황 집계'],
  },
  collect: {
    title: '자료 수집',
    desc: '선행연구를 찾아 서지사항과 함께 프로젝트에 모읍니다.',
    points: [
      'KCI 논문 검색: 본인 KCI 인증키로 검색하고 체크한 논문만 가져오기',
      '논문 PDF: 제목·저자·학술지·DOI·초록을 추출해 확인한 뒤 추가',
      '웹·YouTube·Markdown·JSON 파일 등록',
      'Google Drive·Obsidian에 보관한 자료 골라 가져오기',
      'AI가 주제 관련도(1~5)를 제안하고 연구자가 확정',
    ],
  },
  library: {
    title: '자료 라이브러리',
    desc: '프로젝트별 폴더로 자료를 정리합니다.',
    points: ['검색·필터, 관련도·PARA 분류', '여러 자료를 골라 폴더 이동·삭제·외부 저장소로 보내기', '자료별 서지정보·본문·나의 관점 확인'],
  },
  analysis: {
    title: 'AI 분석',
    desc: '모은 자료를 연구 주제와 키워드 기준으로 분석하고, 연구자의 관점을 기록합니다.',
    points: ['전체 자료 분석: 주제 흐름, 쟁점, 연구 공백, 제안 연구 문제', '선택 논문 심층 분석: 요약, 연구 방법, 결과, 한계, 활용 제안', '자료별 나의 관점·연구 메모·논문 활용 위치 기록'],
  },
  references: {
    title: '참고문헌',
    desc: '서지정보를 확인·보완하고 원하는 서식으로 참고문헌 목록을 만듭니다.',
    points: ['자료 유형 7종별 서지정보 입력·누락 확인', 'APA 7 · Chicago · MLA 9 · 국내 학술지 일반형', 'TXT·HTML 내보내기'],
  },
  writing: {
    title: 'AI 집필',
    desc: '학위논문 또는 학술지논문 원고를 장별로 작성하고 HWPX(한글) 파일로 출력합니다.',
    points: ['논문 유형(학위논문·학술지논문)별로 원고를 따로 보관', '목차를 정하고 근거 자료를 바탕으로 장별 본문·초록 작성', '한국외대 학위논문 서식 / 학술지 투고용 A4 HWPX 출력, Drive 저장'],
  },
  settings: {
    title: '연구 설정',
    desc: 'AI·외부 저장소 연결과 데이터 백업을 관리합니다.',
    points: ['본인 Claude API 키 입력(이 탭에서만 사용, 저장하지 않음)', 'Obsidian Vault 폴더·Google Drive 연결', '전체 JSON 백업과 복원'],
  },
};

const LOGIN_NOTE = '로그인하면 계정이 만들어지고, 자료는 그 계정에만 저장되어 다른 사람에게 보이지 않습니다.';

export function GuestApp({ errorMessage }: { errorMessage?: string | null }) {
  const [page, setPage] = useState<PageKey>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((p: PageKey) => {
    window.location.hash = p;
    setPage(p);
    document.querySelector('.main')?.scrollTo(0, 0);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <div className="brand-name">AI WIKI</div>
            <div className="brand-sub">논문 연구 워크스페이스</div>
          </div>
        </div>
        <div className="project-box guest-box">
          <div className="project-label">로그인 전 둘러보기</div>
          <p className="guest-box-text">기능 소개만 볼 수 있습니다. 자료 수집·분석·집필은 오른쪽 위에서 로그인한 뒤 이용하세요.</p>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => go(n.key)}>
              <span className="nav-icon" aria-hidden>{n.step ?? n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><p>{LOGIN_NOTE}</p></div>
      </aside>
      <main className="main">
        <div className="topbar">
          <GoogleLoginButton label="로그인" className="login-google-inline" errorMessage={errorMessage} />
        </div>
        <div className="main-inner">
          {page === 'home' ? <GuestHome go={go} /> : <GuestGuide page={page} />}
        </div>
        <Footer />
      </main>
    </div>
  );
}

function GuestHome({ go }: { go: (p: PageKey) => void }) {
  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">로그인 전 둘러보기</div>
          <h1>자료 수집부터 논문 원고까지, 한 흐름으로</h1>
          <p>석사논문과 연구자료를 논문 주제 단위로 모으고 분석하며, Claude AI와 함께 학위논문·학술지논문 원고를 작성해 HWPX(한글) 파일로 출력합니다.</p>
          <div className="actions">
            <GoogleLoginButton className="login-google-inline" />
            <button className="btn" onClick={() => go('collect')}>기능 둘러보기</button>
          </div>
        </div>
      </section>
      <Card title="동작 흐름" extra={<span className="muted small">단계를 누르면 해당 기능 소개로 이동합니다</span>}>
        <FlowDiagram go={go} />
      </Card>
      <div className="grid-3 guest-grid">
        {(Object.keys(GUIDES) as (keyof typeof GUIDES)[]).map((key) => (
          <button key={key} className="card guest-card" onClick={() => go(key)}>
            <b>{GUIDES[key].title}</b>
            <span>{GUIDES[key].desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function GuestGuide({ page }: { page: Exclude<PageKey, 'home'> }) {
  const g = GUIDES[page];
  return (
    <>
      <PageHeader title={g.title} desc={g.desc} badges={<span className="chip chip-muted">기능 소개</span>} />
      <Card title="할 수 있는 일">
        <ul className="guest-points">
          {g.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </Card>
      <Card title="로그인 후 이용할 수 있습니다" className="guest-login-card">
        <p className="muted">{LOGIN_NOTE}</p>
        <GoogleLoginButton className="login-google-inline" />
      </Card>
    </>
  );
}
