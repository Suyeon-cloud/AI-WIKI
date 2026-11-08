import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { authState, initializeAuth, subscribeAuth } from './lib/auth';
import { StoreProvider } from './store';
import { refreshAi } from './lib/ai';
import { GuestApp } from './components/GuestApp';
import type { PageKey, Project } from './types';
import { pageFromHash as fromHash, Sidebar } from './components/Sidebar';
import { Toasts } from './components/ui';
import { Footer } from './components/Footer';
import { TopBar } from './components/TopBar';
import { NavContext, ProjectDialog } from './components/ProjectDialog';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Collect } from './pages/Collect';
import { Library } from './pages/Library';
import { Analysis } from './pages/Analysis';
import { Writing } from './pages/Writing';
import { References } from './pages/References';
import { Settings } from './pages/Settings';

export default function App() {
  const auth = useSyncExternalStore(subscribeAuth, authState);
  useEffect(() => { void initializeAuth(); }, []);
  if (!auth.ready) return <div className="boot-loading">로그인 확인 중…</div>;
  // 로그인 전: 계정 저장소(StoreProvider)를 만들지 않는 소개 화면만 보여 준다
  if (!auth.user) return <GuestApp errorMessage={auth.error} />;
  return <StoreProvider key={auth.user.id} userId={auth.user.id}><Workspace /></StoreProvider>;
}

function Workspace() {
  useEffect(() => { void refreshAi(); }, []);
  const [page, setPage] = useState<PageKey>(fromHash);
  const [dialog, setDialog] = useState<{ edit?: Project } | null>(null);

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((p: PageKey) => {
    window.location.hash = p;
    setPage(p);
    document.querySelector('.main')?.scrollTo(0, 0);
  }, []);

  const nav = useMemo(
    () => ({ go, newProject: () => setDialog({}), editProject: (p: Project) => setDialog({ edit: p }) }),
    [go],
  );


  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        <Sidebar page={page} onNavigate={go} />
        <main className="main">
          <TopBar onNavigate={go} />
          <div className="main-inner">
            {page === 'home' && <Home />}
            {page === 'dashboard' && <Dashboard />}
            {page === 'collect' && <Collect />}
            {page === 'library' && <Library />}
            {page === 'analysis' && <Analysis />}
            {page === 'writing' && <Writing />}
            {page === 'references' && <References />}
            {page === 'settings' && <Settings />}
          </div>
          <Footer />
        </main>
        {dialog && <ProjectDialog edit={dialog.edit} onClose={() => setDialog(null)} />}
        <Toasts />
      </div>
    </NavContext.Provider>
  );
}
