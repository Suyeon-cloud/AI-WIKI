import { useSyncExternalStore } from 'react';
import { authUser, subscribeAuth } from '../lib/auth';
import type { PageKey } from '../types';
import { useConnections, useSignOut } from './Sidebar';

/** 본문 오른쪽 위: Google Drive 연결 상태와 로그인 계정 (연결·로그아웃은 기존 기능을 그대로 사용) */
export function TopBar({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const user = useSyncExternalStore(subscribeAuth, authUser);
  const c = useConnections();
  const signOut = useSignOut();
  const openDrive = () => {
    onNavigate('settings');
    setTimeout(() => document.getElementById('drive-settings')?.scrollIntoView({ block: 'start' }), 0);
  };

  return (
    <div className="topbar">
      <button className={`conn topbar-drive ${c.drive ? 'on' : ''}`} onClick={openDrive} title="Google Drive 연결 설정으로 이동">
        <i /> Google Drive {c.drive ? '연결됨' : '미연결'}
      </button>
      {user && (
        <div className="account-box topbar-account">
          {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="account-initial">{user.name.slice(0, 1)}</span>}
          <div className="account-text">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </div>
          <button className="link small" onClick={signOut}>로그아웃</button>
        </div>
      )}
    </div>
  );
}
