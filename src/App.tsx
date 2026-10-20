import { useEffect, useState } from 'react';
import type { PageKey } from './types';
import { NAV, Sidebar } from './components/Sidebar';
import { Toasts } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Collect } from './pages/Collect';
import { Library } from './pages/Library';
import { Analysis } from './pages/Analysis';
import { Writing } from './pages/Writing';
import { References } from './pages/References';
import { Settings } from './pages/Settings';

const fromHash = (): PageKey => {
  const h = window.location.hash.slice(1) as PageKey;
  return NAV.some((n) => n.key === h) ? h : 'dashboard';
};

export default function App() {
  const [page, setPage] = useState<PageKey>(fromHash);

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (p: PageKey) => {
    window.location.hash = p;
    setPage(p);
    document.querySelector('.main')?.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={go} />
      <main className="main">
        <div className="main-inner">
          {page === 'dashboard' && <Dashboard go={go} />}
          {page === 'collect' && <Collect go={go} />}
          {page === 'library' && <Library go={go} />}
          {page === 'analysis' && <Analysis />}
          {page === 'writing' && <Writing />}
          {page === 'references' && <References />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
