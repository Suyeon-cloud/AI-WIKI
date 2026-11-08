-- 읽기 전용 점검. 데이터를 바꾸지 않는다. 'REPLACE_WITH_EMAIL'을 계정 이메일로 바꿔 실행한다.
-- 전환 직후: legacy_count = new_count, materials_match = true, meta_match = true 이어야 한다.
-- 전환 뒤 앱에서 저장하면 new_count·meta_revision이 바뀌는 것이 정상이며, legacy_* 값은 그대로여야 한다.
with u as (
  select id from auth.users where lower(email) = lower('REPLACE_WITH_EMAIL')
), legacy as (
  select s.state, s.revision from public.ai_wiki_user_state s join u on s.user_id = u.id
), meta as (
  select m.state, m.revision from public.ai_wiki_user_meta m join u on m.user_id = u.id
)
select
  (select count(*) from u) as accounts_found,
  (select jsonb_array_length(state->'materials') from legacy) as legacy_count,
  (select revision from legacy) as legacy_revision,
  (select count(*) from public.ai_wiki_materials m join u on m.user_id = u.id where m.deleted_at is null) as new_count,
  (select count(*) from public.ai_wiki_materials m join u on m.user_id = u.id where m.deleted_at is not null) as deleted_marked,
  (select revision from meta) as meta_revision,
  (select jsonb_array_length(state->'materialOrder') from meta) as order_count,
  not exists (
    select 1 from legacy, jsonb_array_elements(legacy.state->'materials') with ordinality t(e, o)
    left join public.ai_wiki_materials m on m.user_id = (select id from u) and m.id = e->>'id'
    where m.data is distinct from e or m.position <> o
  ) as materials_match,
  (select state - 'materialOrder' from meta) is not distinct from (select state - 'materials' from legacy) as meta_match,
  pg_size_pretty((select octet_length(state::text)::bigint from meta)) as meta_size;
