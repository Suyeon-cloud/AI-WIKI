-- Split storage: one row per research material + a small per-account meta document.
-- Run once in the Supabase SQL Editor. It creates new objects only:
-- no existing row is read, changed or moved, and no account is switched.
-- An account switches only when supabase/manual/split-migrate-user.sql is run for it.
begin;

-- Account document without materials (projects, theses, events, AI outputs, settings, materialOrder).
create table public.ai_wiki_user_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and not (state ? 'materials')),
  revision bigint not null default 1 check (revision > 0),
  storage_version int not null default 2,
  migrated_at timestamptz not null default now()
);

-- One row per material. deleted_at marks deletions instead of removing rows.
create table public.ai_wiki_materials (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id <> ''),
  position double precision not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- RLS applies to every client role. It is not forced on the table owner, so the two
-- security definer functions below (owned by the same role) can check revisions and guard rows
-- whether or not that role has BYPASSRLS.
alter table public.ai_wiki_user_meta enable row level security;
alter table public.ai_wiki_materials enable row level security;

-- Clients may only read their own rows; every write goes through ai_wiki_save_changes,
-- so the revision check cannot be bypassed.
revoke all on table public.ai_wiki_user_meta, public.ai_wiki_materials from public, anon, authenticated;
grant select on table public.ai_wiki_user_meta, public.ai_wiki_materials to authenticated;

create policy "Users read only their own meta"
on public.ai_wiki_user_meta for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users read only their own materials"
on public.ai_wiki_materials for select to authenticated
using ((select auth.uid()) = user_id);

-- Saves changed materials and the meta document in one transaction.
-- p_upserts: [{ "position": number, "data": Material }], p_meta: null keeps the stored meta.
-- SQL NULL and JSON null are treated the same (PostgREST may send either for a JSON null).
-- A stale p_expected_revision raises PT409 (HTTP 409) and nothing is written.
create function public.ai_wiki_save_changes(p_expected_revision bigint, p_meta jsonb, p_upserts jsonb, p_deletes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb := nullif(p_meta, 'null'::jsonb);
  v_upserts jsonb := coalesce(nullif(p_upserts, 'null'::jsonb), '[]'::jsonb);
  v_deletes text[] := coalesce(p_deletes, '{}');
  v_revision bigint;
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'login required' using errcode = '28000';
  end if;
  if v_meta is not null and (jsonb_typeof(v_meta) <> 'object' or v_meta ? 'materials') then
    raise exception 'invalid meta' using errcode = '22023';
  end if;
  if jsonb_typeof(v_upserts) <> 'array' then
    raise exception 'invalid upserts' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_upserts) e
    where jsonb_typeof(e->'data') is distinct from 'object'
       or coalesce(e->'data'->>'id', '') = ''
       or jsonb_typeof(e->'position') is distinct from 'number'
  ) then
    raise exception 'invalid material' using errcode = '22023';
  end if;
  -- 같은 요청 안에서 한 자료를 두 번 저장하거나, 저장과 삭제를 동시에 요청하면 거부한다.
  if (select count(*) <> count(distinct e->'data'->>'id') from jsonb_array_elements(v_upserts) e) then
    raise exception 'duplicate material id in upserts' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_upserts) e where e->'data'->>'id' = any(v_deletes)) then
    raise exception 'material id in both upserts and deletes' using errcode = '22023';
  end if;

  update public.ai_wiki_user_meta
     set revision = revision + 1, state = coalesce(v_meta, state)
   where user_id = v_uid and revision = p_expected_revision
  returning revision into v_revision;
  if v_revision is null then
    raise exception 'revision conflict' using errcode = 'PT409';
  end if;

  insert into public.ai_wiki_materials (user_id, id, position, data, updated_at, deleted_at)
  select v_uid, e->'data'->>'id', (e->>'position')::double precision, e->'data', now(), null
    from jsonb_array_elements(v_upserts) e
  on conflict (user_id, id) do update
     set position = excluded.position, data = excluded.data, updated_at = now(), deleted_at = null;

  update public.ai_wiki_materials
     set deleted_at = now(), updated_at = now()
   where user_id = v_uid and id = any(v_deletes) and deleted_at is null;

  select count(*) into v_count from public.ai_wiki_materials where user_id = v_uid and deleted_at is null;
  return jsonb_build_object('revision', v_revision, 'count', v_count);
end;
$$;
-- Only signed-in users may call it. Supabase grants EXECUTE on new public functions to anon,
-- authenticated and service_role by default, so every other role is revoked explicitly.
revoke all on function public.ai_wiki_save_changes(bigint, jsonb, jsonb, text[]) from public, anon, authenticated, service_role;
grant execute on function public.ai_wiki_save_changes(bigint, jsonb, jsonb, text[]) to authenticated;

-- Once an account has a meta row, the old whole-document row is frozen:
-- tabs still running the old app cannot overwrite it.
create function public.ai_wiki_guard_legacy_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.ai_wiki_user_meta
     where user_id = case tg_op when 'INSERT' then new.user_id else old.user_id end
  ) then
    raise exception '이 계정은 변경분 저장 방식으로 전환되었습니다. 새로고침해 주세요.' using errcode = 'PT409';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
revoke all on function public.ai_wiki_guard_legacy_state() from public, anon, authenticated, service_role;
create trigger ai_wiki_guard_legacy_state
before insert or update or delete on public.ai_wiki_user_state
for each row execute function public.ai_wiki_guard_legacy_state();

commit;
