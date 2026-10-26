import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PageKey, Project } from './types';
import { NAV, Sidebar } from './components/Sidebar';
import { Toasts } from './components/ui';
import { NavContext, ProjectDialog } from './components/ProjectDialog';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Collect } from './pages/Collect';
import { Library } from './pages/Library';
import { Analysis } from './pages/Analysis';
import { Writing } from './pages/Writing';
import { References } from './pages/References';
import { Settings } from './pages/Settings';

const fromHash = (): PageKey => {
  const h = window.location.hash.slice(1) as PageKey;
  return NAV.some((n) => n.key === h) ? h : 'home';
};

export default function App() {
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
        </main>
        {dialog && <ProjectDialog edit={dialog.edit} onClose={() => setDialog(null)} />}
        <Toasts />
      </div>
    </NavContext.Provider>
  );
}
