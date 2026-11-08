-- 계정 1개를 기존 저장 방식(ai_wiki_user_state)으로 되돌린다. SQL Editor에서 직접 실행한다.
-- 전제: 이 계정의 AI WIKI 탭을 모두 닫음, 앱에서 전체 백업을 받아 둠.
-- 'REPLACE_WITH_EMAIL'과 v_mode를 정한 뒤 실행한다. 전체가 한 트랜잭션이며 실패하면 아무것도 바뀌지 않는다.
--   v_mode = 'discard'      : 새 구조에서 바꾼 내용은 버리고, 전환 전 그대로인 기존 행을 다시 사용
--   v_mode = 'keep_changes' : 새 구조의 현재 내용(삭제 표시 제외)으로 기존 행을 다시 만든 뒤 사용
-- 어느 경우든 새 구조의 행은 지우기 전에 ai_wiki_split_rollback_backup 테이블에 그대로 보관한다.
create table if not exists public.ai_wiki_split_rollback_backup (
  backed_up_at timestamptz not null default now(),
  user_id uuid not null,
  kind text not null,
  id text,
  position double precision,
  data jsonb not null,
  revision bigint,
  deleted_at timestamptz
);
alter table public.ai_wiki_split_rollback_backup enable row level security;
revoke all on table public.ai_wiki_split_rollback_backup from public, anon, authenticated;

do $$
declare
  v_email text := 'REPLACE_WITH_EMAIL';
  v_mode text := 'discard';
  v_user uuid;
  v_meta jsonb;
  v_rebuilt jsonb;
  v_live bigint;
begin
  if v_mode not in ('discard', 'keep_changes') then raise exception '중단: v_mode를 확인하세요.'; end if;
  select id into strict v_user from auth.users where lower(email) = lower(v_email);
  select state into v_meta from public.ai_wiki_user_meta where user_id = v_user for update;
  if v_meta is null then raise exception '중단: 전환된 계정이 아닙니다.'; end if;
  perform 1 from public.ai_wiki_user_state where user_id = v_user for update;
  if not found then raise exception '중단: 기존 저장 행이 없습니다.'; end if;

  insert into public.ai_wiki_split_rollback_backup (user_id, kind, data, revision)
  select user_id, 'meta', state, revision from public.ai_wiki_user_meta where user_id = v_user;
  insert into public.ai_wiki_split_rollback_backup (user_id, kind, id, position, data, deleted_at)
  select user_id, 'material', id, position, data, deleted_at from public.ai_wiki_materials where user_id = v_user;

  select count(*) into v_live from public.ai_wiki_materials where user_id = v_user and deleted_at is null;
  v_rebuilt := (v_meta - 'materialOrder') || jsonb_build_object('materials', coalesce((
    select jsonb_agg(m.data order by o.ord nulls last, m.position, m.id)
      from public.ai_wiki_materials m
      left join jsonb_array_elements_text(coalesce(v_meta->'materialOrder', '[]')) with ordinality o(id, ord) on o.id = m.id
     where m.user_id = v_user and m.deleted_at is null), '[]'::jsonb));
  if jsonb_array_length(v_rebuilt->'materials') <> v_live then raise exception '중단: 되돌릴 자료 수가 맞지 않습니다.'; end if;

  -- meta 행을 먼저 지워야 기존 행 보호 트리거가 해제된다.
  delete from public.ai_wiki_user_meta where user_id = v_user;
  delete from public.ai_wiki_materials where user_id = v_user;
  if v_mode = 'keep_changes' then
    update public.ai_wiki_user_state set state = v_rebuilt, revision = revision + 1 where user_id = v_user;
  end if;
  raise notice '되돌리기 완료 (%): 새 구조 자료 %건은 ai_wiki_split_rollback_backup에 보관', v_mode, v_live;
end $$;
