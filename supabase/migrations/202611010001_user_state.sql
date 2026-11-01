-- Preserve the existing AppState JSON structure; one private document per user.
-- Run once in the Supabase SQL Editor. No existing application data is changed.
begin;

create table public.ai_wiki_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision > 0)
);

alter table public.ai_wiki_user_state enable row level security;
alter table public.ai_wiki_user_state force row level security;

revoke all on table public.ai_wiki_user_state from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.ai_wiki_user_state to authenticated;

create policy "Users manage only their own research state"
on public.ai_wiki_user_state
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
