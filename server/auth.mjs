const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const jsonError = (status, message) => Response.json({ error: message }, { status, headers });

/** Supabase 세션으로 확인된 Google 계정만 통과시킨다. 실패하면 { denied: Response }를 돌려준다. */
export async function requireGoogleUser(request, env, fetchUser = fetch) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/i)?.[1];
  if (!token) return { denied: jsonError(401, 'Google 계정으로 다시 로그인해 주세요.') };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) return { denied: jsonError(503, '서버의 로그인 연결 설정이 필요합니다.') };
  let user;
  try {
    const result = await fetchUser(`${url}/auth/v1/user`, { headers: { apikey: publicKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!result.ok) return { denied: jsonError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.') };
    user = await result.json();
  } catch { return { denied: jsonError(503, '로그인을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (!user?.id || !user.email_confirmed_at || !user.identities?.some((i) => i.provider === 'google'))
    return { denied: jsonError(403, '이메일 확인이 완료된 Google 계정으로 로그인해 주세요.') };
  return { user };
}
