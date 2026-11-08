import { supabase } from './supabase';
import type { StateRepository } from './cloud-state';

// Supabase가 돌려준 오류 코드·HTTP 상태만 보여 준다. 오류 본문·요청 내용·토큰은 화면에 싣지 않는다.
const REASONS: Record<string, string> = {
  '57014': '서버 처리 시간 초과: 저장할 자료가 커서 제한 시간 안에 끝나지 않았을 수 있습니다',
  '413': '요청 크기 초과: 저장할 자료가 서버 허용 크기보다 큽니다',
  '401': '로그인 만료: 다시 로그인해야 합니다',
  PGRST301: '로그인 만료: 다시 로그인해야 합니다',
  '403': '권한 없음: 로그인 계정을 확인해야 합니다',
  '42501': '권한 없음: 로그인 계정을 확인해야 합니다',
  '23514': '저장 형식 검사 실패',
  '429': '요청이 너무 많음: 잠시 후 다시 시도해야 합니다',
  '0': '네트워크 연결 실패: 요청이 서버에 닿지 않았습니다',
};
const size = (state: unknown) => {
  try { return `${(new Blob([JSON.stringify(state)]).size / 1024 / 1024).toFixed(1)}MB`; } catch { return '확인 불가'; }
};
function describe(error: { code?: string } | null, status: number, state?: unknown) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9]{1,8}$/.test(error.code) ? error.code : '';
  const http = Number.isSafeInteger(status) ? status : 0;
  const reason = REASONS[code] ?? REASONS[String(http)] ?? (http >= 500 ? '서버 오류' : '원인 미확인');
  const parts = [code && `오류 코드 ${code}`, `HTTP ${http}`, state !== undefined && `저장 크기 ${size(state)}`].filter(Boolean);
  return `(${parts.join(' · ')}) ${reason}`;
}

export const cloudRepository: StateRepository = {
  async read(userId) {
    if (!supabase) throw new Error('Supabase 연결이 필요합니다.');
    const { data, error, status } = await supabase.from('ai_wiki_user_state').select('state, revision').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`서버 자료를 불러오지 못했습니다 ${describe(error, status)}. 인터넷 연결과 Supabase 설정을 확인해 주세요.`);
    return data;
  },
  async write(userId, state, revision) {
    if (!supabase) throw new Error('Supabase 연결이 필요합니다.');
    const table = supabase.from('ai_wiki_user_state');
    const query = revision === null
      ? table.insert({ user_id: userId, state, revision: 1 })
      : table.update({ state, revision: revision + 1 }).eq('user_id', userId).eq('revision', revision);
    const { data, error, status } = await query.select('revision').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) throw new Error('서버에 저장하지 못했습니다 (저장 버전 충돌) 다른 창에서 자료가 변경되었습니다. 다른 AI WIKI 탭을 닫고 현재 내용을 백업한 뒤 새로고침해 주세요.');
    if (error) throw new Error(`서버에 저장하지 못했습니다 ${describe(error, status, state)}.`);
    return data!.revision;
  },
};
