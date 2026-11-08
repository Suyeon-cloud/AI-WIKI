-- 서버 백업: ai_wiki_user_state 전체(모든 계정)를 비공개 스키마에 복사한다. SQL Editor에서 직접 실행한다.
-- 범위: 전환·시험 SQL은 계정 하나만 다루지만, 새 보호 트리거는 테이블 전체에 붙으므로 모든 계정을 백업한다.
-- 시점: REPEATABLE READ 트랜잭션이라 복사와 검증이 같은 스냅샷(트랜잭션 시작 시점)을 본다.
--   실행 중에 앱이 저장해도 그 저장은 막히지 않으며 백업에 들어가지 않는다. backed_up_at = 스냅샷 시각.
--   백업 이후의 변경분은 이 백업에 없다.
-- 공개 차단:
--   * public 스키마가 아닌 ai_wiki_backup 스키마에 만든다. Data API는 Settings → API → Exposed schemas
--     (기본값 public, graphql_public)만 노출하므로 이 스키마를 추가하지 않는 한 API로 보이지 않는다.
--   * 기본 권한 설정으로 붙을 수 있는 권한을 PUBLIC·anon·authenticated·service_role에서 모두 회수하고
--     RLS를 켠다(정책 없음 = 전부 거부). 아래 검증에서 하나라도 남아 있으면 전체를 취소한다.
-- 덮어쓰기 방지: 같은 이름의 백업 테이블이 이미 있으면 create table이 실패하고 아무것도 바뀌지 않는다.
--   다시 백업하려면 테이블 이름의 날짜·번호를 바꾼다(예: user_state_20261108_2). 이 파일 안의 이름을 모두 바꿔야 한다.
-- 원본 테이블은 읽기만 한다. 복원은 restore-user-state.sql을 따른다.
begin isolation level repeatable read;

create schema if not exists ai_wiki_backup;
revoke all on schema ai_wiki_backup from public, anon, authenticated, service_role;

create table ai_wiki_backup.user_state_20261108 as
select user_id, state, revision, now() as backed_up_at from public.ai_wiki_user_state;

alter table ai_wiki_backup.user_state_20261108 enable row level security;
revoke all on table ai_wiki_backup.user_state_20261108 from public, anon, authenticated, service_role;

-- 검증: 실패하면 예외로 끝나고 스키마·백업 테이블 생성까지 모두 취소된다.
do $$
declare
  v_role text;
  v_priv text;
  v_exposed text;
begin
  -- 같은 스냅샷 기준으로 행 수와 각 행의 내용·버전이 원본과 같아야 한다.
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

  -- 앱 역할(PUBLIC 포함)에 스키마·테이블 권한이 하나도 없어야 한다.
  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if v_role <> 'public' and not exists (select 1 from pg_roles where rolname = v_role) then continue; end if;
    if has_schema_privilege(v_role, 'ai_wiki_backup', 'usage') or has_schema_privilege(v_role, 'ai_wiki_backup', 'create') then
      raise exception '중단: % 역할이 백업 스키마에 접근할 수 있습니다.', v_role;
    end if;
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(v_role, 'ai_wiki_backup.user_state_20261108', v_priv) then
        raise exception '중단: % 역할에 백업 테이블 % 권한이 있습니다.', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'ai_wiki_backup.user_state_20261108'::regclass) then
    raise exception '중단: 백업 테이블의 RLS가 꺼져 있습니다.';
  end if;

  -- Data API 노출 스키마가 DB 역할 설정에 있으면 백업 스키마가 들어 있지 않은지 확인한다.
  -- (설정이 대시보드에만 있으면 여기서 보이지 않으므로 Settings → API에서 직접 확인한다.)
  select string_agg(c, ',') into v_exposed
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if v_exposed ilike '%ai_wiki_backup%' then
    raise exception '중단: 백업 스키마가 Data API 노출 스키마에 들어 있습니다.';
  end if;
end $$;

commit;

-- 확인용(읽기 전용): 계정 수, 자료 수 합계, 크기, 스냅샷 시각
select count(*) as accounts,
       sum(jsonb_array_length(state->'materials')) as materials,
       pg_size_pretty(sum(octet_length(state::text))::bigint) as size,
       min(backed_up_at) as snapshot_at
from ai_wiki_backup.user_state_20261108;
