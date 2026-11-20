-- Roll back 202611200001_fulltext_storage.sql: removes the four policies only.
-- The bucket and any uploaded full texts are kept (delete them from the Storage dashboard
-- only if you are sure; the app falls back to browser-only storage without them).
begin;
drop policy if exists "ai-wiki fulltext: read own" on storage.objects;
drop policy if exists "ai-wiki fulltext: insert own" on storage.objects;
drop policy if exists "ai-wiki fulltext: update own" on storage.objects;
drop policy if exists "ai-wiki fulltext: delete own" on storage.objects;
commit;
