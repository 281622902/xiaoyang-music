-- Run once in Supabase SQL Editor. Existing favorites/version tables are unchanged.
create table if not exists public.user_music_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint music_state_size check (octet_length(payload::text) <= 2000000)
);
alter table public.user_music_state enable row level security;
revoke all on public.user_music_state from anon;
grant select, insert, update on public.user_music_state to authenticated;
drop policy if exists music_state_owner on public.user_music_state;
create policy music_state_owner on public.user_music_state for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Optimistic revision check prevents a concurrent upload from silently overwriting another device.
create or replace function public.save_music_state(expected_user uuid, expected_revision bigint, new_payload jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare owner_id uuid := auth.uid(); saved_revision bigint;
begin
  if owner_id is null or owner_id <> expected_user then raise exception 'login_required'; end if;
  if jsonb_typeof(new_payload) <> 'object' or octet_length(new_payload::text) > 2000000 then raise exception 'invalid_music_state'; end if;
  if expected_revision = 0 then
    insert into public.user_music_state(user_id, payload, revision)
      values(owner_id, new_payload, 1) on conflict (user_id) do nothing returning revision into saved_revision;
  else
    update public.user_music_state set payload = new_payload, revision = revision + 1, updated_at = now()
      where user_id = owner_id and revision = expected_revision returning revision into saved_revision;
  end if;
  if saved_revision is null then raise exception 'music_state_conflict'; end if;
  return saved_revision;
end; $$;
revoke all on function public.save_music_state(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_music_state(uuid,bigint,jsonb) to authenticated;
