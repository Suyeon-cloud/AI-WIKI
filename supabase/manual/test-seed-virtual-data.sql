-- 테스트 계정 전용: 가상 연구자료 202건(약 14MB)을 만든다. 실제 연구자료는 읽거나 복사하지 않는다.
-- 전제: 테스트 계정으로 앱에 로그인해 프로젝트를 하나 만들어 저장 행이 생겨 있어야 하고(로그인만으로는 저장되지 않음),
--       그 계정의 AI WIKI 탭은 닫는다.
-- 사용법: 'REPLACE_WITH_TEST_EMAIL' 두 곳을 테스트 계정 이메일로 바꿔 실행한다(두 값이 다르면 중단).
-- 안전 장치(하나라도 걸리면 예외로 끝나고 아무것도 바뀌지 않는다):
--   * 이메일과 정확히 일치하는 계정이 하나여야 한다.
--   * 그 계정의 자료가 모두 이 스크립트가 만든 가상 자료(id가 'virtual-'로 시작)이거나 0건이어야 한다.
--     실제 자료가 한 건이라도 있으면 덮어쓰지 않는다.
--   * 변경분 저장으로 이미 전환된 계정이면 중단한다.
-- 자료 외의 내용(프로젝트·집필·기록·설정)은 그대로 두고 materials만 가상 자료로 바꾼다. revision을 올려 열린 탭은 충돌로 멈춘다.
do $$
declare
  v_email text := 'REPLACE_WITH_TEST_EMAIL';
  v_confirm text := 'REPLACE_WITH_TEST_EMAIL';
  v_count int := 202;
  v_body_chars int := 23000; -- 한글 1자 = 3바이트 → 자료당 약 69KB, 전체 약 14MB
  v_user uuid;
  v_state jsonb;
  v_project text;
  v_materials jsonb;
begin
  if v_email <> v_confirm or v_email like 'REPLACE_WITH%' then raise exception '중단: 테스트 계정 이메일을 두 곳 모두 같게 입력하세요.'; end if;
  select id into strict v_user from auth.users where lower(email) = lower(v_email);

  select state into v_state from public.ai_wiki_user_state where user_id = v_user for update;
  if v_state is null then raise exception '중단: 이 계정의 저장 행이 없습니다. 테스트 계정으로 앱에 한 번 로그인하세요.'; end if;
  if exists (select 1 from public.ai_wiki_user_meta where user_id = v_user) then raise exception '중단: 이미 변경분 저장으로 전환된 계정입니다.'; end if;
  if jsonb_typeof(v_state->'materials') is distinct from 'array' then raise exception '중단: materials 배열이 없습니다.'; end if;
  if exists (select 1 from jsonb_array_elements(v_state->'materials') e where coalesce(e->>'id', '') not like 'virtual-%') then
    raise exception '중단: 가상 자료가 아닌 자료가 있는 계정입니다. 실제 계정일 수 있어 덮어쓰지 않습니다.';
  end if;

  v_project := nullif(v_state->>'currentProjectId', '');
  if v_project is null then v_project := v_state->'projects'->0->>'id'; end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', format('virtual-%s', lpad(i::text, 3, '0')),
           'title', format('가상 논문 %s', i),
           'sourceType', 'PDF',
           'origin', '원본 자료',
           'topic', '가상 시험 자료',
           'keywords', jsonb_build_array('가상', '시험'),
           'relevance', 1 + i % 5,
           'para', 'Resources',
           'createdAt', '2026-01-01T00:00:00.000Z',
           'updatedAt', '2026-01-01T00:00:00.000Z',
           'viewStatus', '미작성',
           'bibStatus', '서지정보 확인 필요',
           'citationIncluded', false,
           'projectId', v_project,
           'abstract', format('가상 초록 %s', i),
           'content', repeat('가', v_body_chars)
         )) order by i)
    into v_materials
    from generate_series(1, v_count) i;

  update public.ai_wiki_user_state
     set state = jsonb_set(v_state, '{materials}', v_materials), revision = revision + 1
   where user_id = v_user;

  raise notice '가상 자료 %건 생성, 저장 크기 %', v_count,
    (select pg_size_pretty(octet_length(state::text)::bigint) from public.ai_wiki_user_state where user_id = v_user);
end $$;
