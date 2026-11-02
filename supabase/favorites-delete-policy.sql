-- 已有 SELECT/INSERT 策略继续保留，只补上本次删除功能所需权限。
alter table public.user_favorites enable row level security;
grant delete on table public.user_favorites to authenticated;
create index if not exists user_favorites_user_song_url_idx
  on public.user_favorites (user_id, song_url);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_favorites'
      and policyname = 'user_favorites_delete_own'
  ) then
    create policy user_favorites_delete_own
      on public.user_favorites for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- 删除还需要已有 SELECT 策略能看到本人行。
-- 请保留 user_id = auth.uid() 的本人 SELECT/INSERT 策略，不要关闭 RLS。
