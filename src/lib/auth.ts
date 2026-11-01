/**
 * Google 로그인 (브라우저 전용, Client Secret 없음)
 * - Google Drive 연결과 같은 팝업·토큰을 써서, 로그인 한 번으로 가입과 Drive 연결을 함께 끝낸다.
 * - 이 브라우저에는 프로필(이름·이메일·사진)만 남겨 로그인 상태를 표시한다. 접근 토큰은 drive.ts가 관리한다.
 * - 서버가 토큰을 검증하지 않는 화면 안내용 로그인이다. 자료는 계정별로 나뉘지 않고 이 브라우저에 저장된다.
 */
import { DriveError, connectDrive, currentAccessToken, disconnectDrive, driveConfigured } from './drive';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

const KEY = 'ai-wiki:auth-user';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

function readUser(): AuthUser | null {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AuthUser | null;
    return u && typeof u.id === 'string' && typeof u.email === 'string' ? u : null;
  } catch {
    return null;
  }
}

let user = readUser();
const listeners = new Set<() => void>();
export const authUser = () => user;
export const loginRequired = () => driveConfigured();
export function subscribeAuth(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function setUser(u: AuthUser | null) {
  user = u;
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장 불가 환경에서는 이번 세션만 로그인 */
  }
  listeners.forEach((l) => l());
}

/** Google 로그인 — 반드시 버튼 클릭에서 호출 (팝업 차단 방지) */
export async function signIn(): Promise<AuthUser> {
  await connectDrive('select_account');
  const token = currentAccessToken();
  if (!token) throw new DriveError('Google 로그인에 실패했습니다. 다시 시도하세요.', 'auth');
  let res: Response;
  try {
    res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('Google에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', 'network');
  }
  if (!res.ok) throw new DriveError('Google 계정 정보를 읽지 못했습니다. 다시 시도하세요.', 'auth');
  const info = (await res.json()) as { sub?: string; name?: string; email?: string; email_verified?: boolean; picture?: string };
  if (!info.sub || !info.email) throw new DriveError('Google 계정 정보를 읽지 못했습니다. 다시 시도하세요.', 'auth');
  if (info.email_verified === false) throw new DriveError('이메일이 확인된 Google 계정으로만 로그인할 수 있습니다.', 'denied');
  const u: AuthUser = { id: info.sub, name: info.name || info.email, email: info.email, picture: info.picture };
  setUser(u);
  return u;
}

/** 로그아웃 — Drive 연결도 함께 해제한다. 이 브라우저의 자료와 Drive 파일은 지우지 않는다. */
export function signOut() {
  disconnectDrive();
  setUser(null);
}
