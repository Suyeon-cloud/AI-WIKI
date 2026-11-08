-- 수동 복원: 백업(ai_wiki_backup.user_state_20261108)의 계정 1개를 ai_wiki_user_state로 되돌린다.
-- 복원은 백업 이후의 변경을 지운다. 꼭 필요할 때만, 아래 순서대로 한 계정씩 실행한다.
--
-- 1단계(준비)
--   * 그 계정의 AI WIKI 탭을 모두 닫는다. 가능하면 앱에서 전체 JSON 백업을 받아 둔다.
--   * 변경분 저장으로 전환된 계정이면 먼저 split-rollback-user.sql로 되돌린다(아래 스크립트는 전환된 계정이면 중단).
-- 2단계(읽기 전용 미리보기): 아래 select의 'REPLACE_WITH_EMAIL'을 바꿔 실행하고 current_revision 값을 적어 둔다.
--   current_*는 지금 서버 내용, backup_*은 되돌릴 내용이다. 이 차이만큼 백업 이후 변경이 사라진다.
-- 3단계(복원): do 블록의 v_email과 v_expected_revision(2단계의 current_revision)을 채워 실행한다.
--   * 2단계 이후 누군가 저장해 revision이 바뀌었으면 중단한다(최신 데이터를 모르고 덮어쓰지 않음).
--   * 덮어쓰기 직전의 현재 내용은 ai_wiki_backup.user_state_pre_restore에 보관하므로 복원도 되돌릴 수 있다.
--   * revision은 1 올린다. 복원 전에 열려 있던 탭은 충돌로 저장이 멈춘다.
--   * 다른 계정은 읽지도 바꾸지도 않는다.

-- 2단계: 미리보기 (읽기 전용)
select s.revision as current_revision,
       jsonb_array_length(s.state->'materials') as current_materials,
       b.revision as backup_revision,
       jsonb_array_length(b.state->'materials') as backup_materials,
       b.backed_up_at,
       exists (select 1 from public.ai_wiki_user_meta m where m.user_id = s.user_id) as switched_to_split
  from auth.users u
  join public.ai_wiki_user_state s on s.user_id = u.id
  left join ai_wiki_backup.user_state_20261108 b on b.user_id = u.id
 where lower(u.email) = lower('REPLACE_WITH_EMAIL');

-- 3단계: 복원 (한 트랜잭션, 검사 실패 시 아무것도 바뀌지 않음)
create table if not exists ai_wiki_backup.user_state_pre_restore (
  saved_at timestamptz not null default now(),
  user_id uuid not null,
  state jsonb not null,
  revision bigint not null
);
alter table ai_wiki_backup.user_state_pre_restore enable row level security;
revoke all on table ai_wiki_backup.user_state_pre_restore from public, anon, authenticated, service_role;

do $$
declare
  v_email text := 'REPLACE_WITH_EMAIL';
  v_expected_revision bigint := null; -- 2단계의 current_revision
  v_user uuid;
  v_current public.ai_wiki_user_state%rowtype;
  v_backup jsonb;
begin
  if v_expected_revision is null then raise exception '중단: v_expected_revision에 미리보기의 current_revision을 넣으세요.'; end if;
  select id into strict v_user from auth.users where lower(email) = lower(v_email);
  if exists (select 1 from public.ai_wiki_user_meta where user_id = v_user) then
    raise exception '중단: 변경분 저장으로 전환된 계정입니다. split-rollback-user.sql을 먼저 실행하세요.';
  end if;
  select state into v_backup from ai_wiki_backup.user_state_20261108 where user_id = v_user;
  if v_backup is null then raise exception '중단: 이 계정의 백업이 없습니다.'; end if;

  select * into v_current from public.ai_wiki_user_state where user_id = v_user for update;
  if not found then raise exception '중단: 이 계정의 저장 행이 없습니다.'; end if;
  if v_current.revision <> v_expected_revision then
    raise exception '중단: 미리보기 이후 저장이 있었습니다(현재 %, 예상 %). 미리보기부터 다시 하세요.', v_current.revision, v_expected_revision;
  end if;

  insert into ai_wiki_backup.user_state_pre_restore (user_id, state, revision) values (v_user, v_current.state, v_current.revision);
  update public.ai_wiki_user_state set state = v_backup, revision = revision + 1
   where user_id = v_user and revision = v_expected_revision;
  if not found then raise exception '중단: 복원하지 못했습니다.'; end if;
  if (select state from public.ai_wiki_user_state where user_id = v_user) is distinct from v_backup then
    raise exception '중단: 복원 결과가 백업과 다릅니다.';
  end if;
  raise notice '복원 완료: 자료 %건, 새 revision %', jsonb_array_length(v_backup->'materials'), v_expected_revision + 1;
end $$;
