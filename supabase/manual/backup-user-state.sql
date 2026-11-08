-- 서버 백업: ai_wiki_user_state 전체(모든 계정)를 비공개 스키마에 복사한다. SQL Editor에서 직접 실행한다.
-- 범위: 전환·시험 SQL은 계정 하나만 다루지만, 새 보호 트리거는 테이블 전체에 붙으므로 모든 계정을 백업한다.
-- 공개 차단:
--   * public 스키마가 아닌 ai_wiki_backup 스키마에 만든다. Data API(PostgREST)는 Settings → API의
--     Exposed schemas(기본값 public, graphql_public)만 노출하므로 이 스키마를 추가하지 않는 한 API로 보이지 않는다.
--   * 그래도 기본 권한 설정으로 붙을 수 있는 권한을 PUBLIC·anon·authenticated에서 모두 회수하고 RLS를 켠다(정책 없음 = 전부 거부).
-- 덮어쓰기 방지: 같은 이름의 백업 테이블이 이미 있으면 create table이 실패하고 아무것도 바뀌지 않는다.
--   다시 백업하려면 아래 테이블 이름의 날짜·번호를 바꾼다(예: user_state_20261108_2).
-- 원본 테이블은 읽기만 한다.
begin;

create schema if not exists ai_wiki_backup;
revoke all on schema ai_wiki_backup from public, anon, authenticated;

create table ai_wiki_backup.user_state_20261108 as
select user_id, state, revision, now() as backed_up_at from public.ai_wiki_user_state;

alter table ai_wiki_backup.user_state_20261108 enable row level security;
revoke all on table ai_wiki_backup.user_state_20261108 from public, anon, authenticated;

-- 검증: 행 수와 각 행의 내용·버전이 원본과 같아야 한다. 다르면 예외로 끝나고 백업 테이블도 만들어지지 않는다.
do $$
begin
  if (select count(*) from ai_wiki_backup.user_state_20261108) <> (select count(*) from public.ai_wiki_user_state) then
    raise exception '중단: 백업 행 수가 원본과 다릅니다.';
  end if;
  if exists (
    select 1 from public.ai_wiki_user_state s
    left join ai_wiki_backup.user_state_20261108 b on b.user_id = s.user_id
    where b.state is distinct from s.state or b.revision is distinct from s.revision
  ) then
    raise exception '중단: 백업 내용이 원본과 다릅니다.';
  end if;
  if has_schema_privilege('anon', 'ai_wiki_backup', 'usage') or has_schema_privilege('authenticated', 'ai_wiki_backup', 'usage')
     or has_table_privilege('anon', 'ai_wiki_backup.user_state_20261108', 'select')
     or has_table_privilege('authenticated', 'ai_wiki_backup.user_state_20261108', 'select') then
    raise exception '중단: 백업이 앱 사용자 역할에 노출되어 있습니다.';
  end if;
end $$;

commit;

-- 확인용(읽기 전용): 계정 수, 각 계정의 자료 수, 크기
select count(*) as accounts,
       sum(jsonb_array_length(state->'materials')) as materials,
       pg_size_pretty(sum(octet_length(state::text))::bigint) as size
from ai_wiki_backup.user_state_20261108;

-- 복원(필요할 때만, 계정 하나씩). 그 계정이 변경분 저장으로 전환돼 있으면 먼저 split-rollback-user.sql을 실행한다.
-- update public.ai_wiki_user_state s
--    set state = b.state, revision = s.revision + 1
--   from ai_wiki_backup.user_state_20261108 b, auth.users u
--  where s.user_id = b.user_id and u.id = s.user_id and lower(u.email) = lower('REPLACE_WITH_EMAIL');
