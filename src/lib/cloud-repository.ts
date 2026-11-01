import { supabase } from './supabase';
import type { StateRepository } from './cloud-state';

export const cloudRepository: StateRepository = {
  async read(userId) {
    if (!supabase) throw new Error('Supabase 연결이 필요합니다.');
    const { data, error } = await supabase.from('ai_wiki_user_state').select('state, revision').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('서버 자료를 불러오지 못했습니다. 인터넷 연결과 Supabase 설정을 확인해 주세요.');
    return data;
  },
  async write(userId, state, revision) {
    if (!supabase) throw new Error('Supabase 연결이 필요합니다.');
    const table = supabase.from('ai_wiki_user_state');
    const query = revision === null
      ? table.insert({ user_id: userId, state, revision: 1 })
      : table.update({ state, revision: revision + 1 }).eq('user_id', userId).eq('revision', revision);
    const { data, error } = await query.select('revision').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) throw new Error('다른 창에서 자료가 변경되었습니다. 현재 내용을 백업한 뒤 새로고침해 주세요.');
    if (error) throw new Error('서버에 저장하지 못했습니다. 현재 내용을 백업하고 연결을 확인한 뒤 저장을 다시 시도해 주세요.');
    return data!.revision;
  },
};
