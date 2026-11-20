-- Paper full texts (extracted PDF text split into sections) live outside the material rows:
-- a private Storage bucket with one JSON object per material at <user_id>/<material_id>.json.
-- Run once in the Supabase SQL Editor. It creates new objects only: no table, row or
-- existing policy is read, changed or removed, and ai_wiki_materials / ai_wiki_user_meta are untouched.
-- Until this runs, the app keeps full texts in the browser's IndexedDB only (and says so).
begin;

-- Private bucket: 20 MB per object, JSON only. Not public: every read goes through the policies below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-wiki-fulltext', 'ai-wiki-fulltext', false, 20971520, array['application/json'])
on conflict (id) do nothing;

-- Each signed-in user can only see and write objects under their own user id folder.
create policy "ai-wiki fulltext: read own"
on storage.objects for select to authenticated
using (bucket_id = 'ai-wiki-fulltext' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "ai-wiki fulltext: insert own"
on storage.objects for insert to authenticated
with check (bucket_id = 'ai-wiki-fulltext' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "ai-wiki fulltext: update own"
on storage.objects for update to authenticated
using (bucket_id = 'ai-wiki-fulltext' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'ai-wiki-fulltext' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "ai-wiki fulltext: delete own"
on storage.objects for delete to authenticated
using (bucket_id = 'ai-wiki-fulltext' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;

-- Check after running (read-only):
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'ai-wiki-fulltext';
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'ai-wiki fulltext:%';
