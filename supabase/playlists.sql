-- 云端歌单表：在 Supabase Dashboard → SQL Editor 中执行一次即可。
-- 已有的 user_favorites / app_versions / user_music_state 不受影响。

create table if not exists public.user_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tracks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlist_name_len check (char_length(name) between 1 and 100),
  constraint playlist_tracks_shape check (jsonb_typeof(tracks) = 'array'),
  constraint playlist_tracks_size check (octet_length(tracks::text) <= 2000000)
);

-- 同一用户下歌单名不重复（防手滑重复建表）。
create unique index if not exists user_playlists_user_name_idx
  on public.user_playlists (user_id, name);
-- 歌单列表按更新时间倒序查询走这个索引。
create index if not exists user_playlists_user_updated_idx
  on public.user_playlists (user_id, updated_at desc);

-- RLS：每行只有本人可见可改，anon 完全无权限。
alter table public.user_playlists enable row level security;
revoke all on public.user_playlists from anon;
grant select, insert, update, delete on public.user_playlists to authenticated;

drop policy if exists user_playlists_select_own on public.user_playlists;
create policy user_playlists_select_own on public.user_playlists
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists user_playlists_insert_own on public.user_playlists;
create policy user_playlists_insert_own on public.user_playlists
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists user_playlists_update_own on public.user_playlists;
create policy user_playlists_update_own on public.user_playlists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_playlists_delete_own on public.user_playlists;
create policy user_playlists_delete_own on public.user_playlists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 原子加歌：追加歌曲（按 url 去重）并刷新 updated_at，一次 RPC 完成，
-- 避免前端「读 tracks → 合并 → 写回」在弱网下丢歌。
create or replace function public.playlist_add_tracks(
  expected_user uuid,
  playlist_id uuid,
  new_tracks jsonb
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  owner_id uuid := auth.uid();
  merged jsonb;
  added integer;
  item jsonb;
begin
  if owner_id is null or owner_id <> expected_user then raise exception 'login_required'; end if;
  if jsonb_typeof(new_tracks) <> 'array' then raise exception 'invalid_tracks'; end if;
  if octet_length(new_tracks::text) > 1000000 then raise exception 'tracks_too_large'; end if;

  select tracks into merged from public.user_playlists
    where id = playlist_id and user_id = owner_id;
  if merged is null then raise exception 'playlist_not_found'; end if;

  for item in select * from jsonb_array_elements(new_tracks) loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item->>'name', '') = ''
       or coalesce(item->>'url', '') = '' then
      raise exception 'invalid_track_item';
    end if;
    if not exists (select 1 from jsonb_array_elements(merged) e where e->>'url' = item->>'url') then
      merged := merged || jsonb_build_array(item);
    end if;
  end loop;

  added := jsonb_array_length(merged) - jsonb_array_length(
    (select tracks from public.user_playlists where id = playlist_id and user_id = owner_id));
  if added > 0 then
    update public.user_playlists
      set tracks = merged, updated_at = now()
      where id = playlist_id and user_id = owner_id;
  end if;
  return added;
end; $$;

revoke all on function public.playlist_add_tracks(uuid, uuid, jsonb) from public, anon;
grant execute on function public.playlist_add_tracks(uuid, uuid, jsonb) to authenticated;
