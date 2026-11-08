-- 계정 1개를 변경분 저장 방식으로 전환한다. Supabase SQL Editor에서 직접 실행한다(앱은 자동 전환하지 않음).
-- 전제: migrations/202611080001_split_materials.sql 적용, 이 계정의 AI WIKI 탭을 모두 닫음, 전체 백업 보관.
-- 사용법: 아래 'REPLACE_WITH_EMAIL'을 계정 이메일로 바꿔 실행한다.
-- 전체가 한 트랜잭션이다. 검사가 하나라도 실패하면 예외로 끝나고 아무것도 바뀌지 않는다.
-- 기존 ai_wiki_user_state 행은 읽기만 하며 수정·삭제하지 않는다(전환 뒤에는 트리거가 이 행의 수정을 막는다).
do $$
declare
  v_email text := 'REPLACE_WITH_EMAIL';
  v_user uuid;
  v_state jsonb;
  v_n bigint;
  v_rows bigint;
begin
  select id into strict v_user from auth.users where lower(email) = lower(v_email);

  -- 기존 행을 잠가 복사하는 동안 기존 저장 경로의 수정이 끼어들지 못하게 한다.
  select state into v_state from public.ai_wiki_user_state where user_id = v_user for update;
  if v_state is null then raise exception '중단: 기존 저장 행이 없습니다.'; end if;
  if exists (select 1 from public.ai_wiki_user_meta where user_id = v_user) then raise exception '중단: 이미 전환된 계정입니다.'; end if;
  if exists (select 1 from public.ai_wiki_materials where user_id = v_user) then raise exception '중단: 새 테이블에 이 계정의 자료가 이미 있습니다.'; end if;
  if jsonb_typeof(v_state->'materials') is distinct from 'array' then raise exception '중단: materials 배열이 없습니다.'; end if;

  v_n := jsonb_array_length(v_state->'materials');
  if exists (select 1 from jsonb_array_elements(v_state->'materials') e where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
    raise exception '중단: id가 없는 자료가 있습니다.';
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(v_state->'materials') e) <> v_n then
    raise exception '중단: 같은 id를 가진 자료가 있습니다.';
  end if;

  insert into public.ai_wiki_materials (user_id, id, position, data)
  select v_user, e->>'id', o, e from jsonb_array_elements(v_state->'materials') with ordinality t(e, o);
  get diagnostics v_rows = row_count;
  if v_rows <> v_n then raise exception '중단: 자료 복사 수가 다릅니다 (원본 %, 복사 %).', v_n, v_rows; end if;

  insert into public.ai_wiki_user_meta (user_id, state, revision)
  values (v_user,
          (v_state - 'materials') || jsonb_build_object('materialOrder',
            coalesce((select jsonb_agg(e->>'id' order by o) from jsonb_array_elements(v_state->'materials') with ordinality t(e, o)), '[]'::jsonb)),
          1);

  -- 검증: 모든 자료의 내용·순서가 원본과 같고, 자료를 뺀 나머지 문서가 원본과 완전히 같아야 한다.
  if exists (
    select 1 from jsonb_array_elements(v_state->'materials') with ordinality t(e, o)
    left join public.ai_wiki_materials m on m.user_id = v_user and m.id = e->>'id'
    where m.data is distinct from e or m.position <> o or m.deleted_at is not null
  ) then raise exception '중단: 복사한 자료 내용이나 순서가 원본과 다릅니다.'; end if;
  if (select state - 'materialOrder' from public.ai_wiki_user_meta where user_id = v_user) is distinct from (v_state - 'materials') then
    raise exception '중단: 프로젝트·집필·기록 데이터가 원본과 다릅니다.';
  end if;

  raise notice '전환 완료: 자료 %건', v_n;
end $$;
