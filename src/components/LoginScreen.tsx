import { useState } from 'react';
import { signIn } from '../lib/auth';

/** Google 로그인 버튼 — 로그인 전 둘러보기 화면 곳곳에서 같은 로그인 흐름을 쓴다 */
export function GoogleLoginButton({ label = 'Google 계정으로 시작하기', className = '', errorMessage }: { label?: string; className?: string; errorMessage?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={`login-google ${className}`} onClick={login} disabled={busy}>
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.8-9.9 6.8-17.4z" />
          <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.7-3-.7-4.7s.3-3.2.7-4.7l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.3-5.7c-2.1 1.4-4.7 2.2-8.2 2.2-6.3 0-11.6-4.2-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {busy ? '로그인 중…' : label}
      </button>
      {(error || errorMessage) && <p className="login-error" role="alert">{error || errorMessage}</p>}
    </>
  );
}
