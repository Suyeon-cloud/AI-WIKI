import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { disconnectDrive } from './drive';
import { setVault } from './obsidian';

export interface AuthUser { id: string; name: string; email: string; picture?: string }
let snapshot: { ready: boolean; user: AuthUser | null; error: string | null } = { ready: false, user: null, error: null };
const listeners = new Set<() => void>();
export const authState = () => snapshot;
export const authUser = () => snapshot.user;
export function subscribeAuth(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function publish(user: User | null, error: string | null = null) {
  const next = user?.email ? { id: user.id, email: user.email, name: user.user_metadata.full_name || user.email, picture: user.user_metadata.avatar_url } : null;
  if (snapshot.user?.id !== next?.id) {
    disconnectDrive();
    setVault(null, false);
  }
  snapshot = { ready: true, user: next, error };
  listeners.forEach((l) => l());
}

let started = false;
export async function initializeAuth() {
  if (started) return;
  started = true;
  if (!supabase) { publish(null, 'Supabase 연결 설정이 필요합니다.'); return; }
  let generation = 0;
  supabase.auth.onAuthStateChange((event, session) => {
    // Supabase holds its auth lock here; do not await another auth call.
    if (event === 'INITIAL_SESSION') return;
    generation++;
    publish(session?.user ?? null);
  });
  const current = generation;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (current !== generation) return;
    if (!session) { publish(null); return; }
    const { data, error } = await supabase.auth.getUser();
    if (current === generation) publish(error ? null : data.user, error ? '로그인을 다시 확인해 주세요.' : null);
  } catch { if (current === generation) publish(null, '로그인 정보를 확인하지 못했습니다. 새로고침해 주세요.'); }
}
export async function signIn(): Promise<void> {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error('Google 로그인을 시작하지 못했습니다. 연결 설정을 확인해 주세요.');
}
export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.');
  publish(null);
}
