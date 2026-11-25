-- ══════════════════════════════════════════════════════════════════
-- 会员体系 + 管理员功能（v3.14.0）
--
-- 管理员：手机号 18474728056（数据库侧 is_admin() 强制校验，客户端 UI 只是展示）。
-- 会员：vip_members 按手机号记录等级与到期时间；expires_at 为空 = 永久。
-- 用途：皮肤页「会员」分区专享皮肤、顶栏 VIP 徽章；后续会员功能沿用此表。
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.vip_members (
  phone      text primary key,                 -- 11 位手机号（不含 +86）
  tier       text not null default 'vip'
             check (tier in ('vip', 'svip')),
  expires_at timestamptz,                      -- null = 永久有效
  note       text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_members enable row level security;

-- 所有人可读（客户端渲染 VIP 徽章/皮肤分区需要查任意用户状态）
drop policy if exists "vip_members_read" on public.vip_members;
create policy "vip_members_read"
  on public.vip_members for select
  to anon, authenticated
  using (true);

-- 管理员判定：登录用户手机号匹配白名单（security definer，防篡改）
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and regexp_replace(regexp_replace(coalesce(u.phone, ''), '^\+86', ''), '^86(?=1[0-9]{10}$)', '') = '18474728056'
  );
$$;

-- 增删改：仅管理员（数据库强制，绕不过）
drop policy if exists "vip_members_admin_write" on public.vip_members;
create policy "vip_members_admin_write"
  on public.vip_members for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 管理员用户列表：security definer 读 auth.users（anon/普通用户不可调用）
create or replace function public.admin_list_users()
returns table (
  user_id       uuid,
  phone         text,
  nickname      text,
  username      text,
  created_at    timestamptz,
  vip_tier      text,
  vip_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    right(coalesce(u.phone,''), 11),
    coalesce(u.raw_user_meta_data ->> 'nickname', ''),
    coalesce(u.raw_user_meta_data ->> 'username', ''),
    u.created_at,
    v.tier,
    v.expires_at
  from auth.users u
  left join public.vip_members v
    on v.phone = right(coalesce(u.phone,''), 11)
  where coalesce(u.phone, '') <> ''
  order by u.created_at desc;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- v3.15.0 补充：数据库侧权威管理员判定（RPC，免疫客户端改动与手机号格式差异）
create or replace function public.is_current_user_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and regexp_replace(regexp_replace(coalesce(u.phone, ''), '^\+86', ''), '^86(?=1[0-9]{10}$)', '') = '18474728056'
  );
$$;
revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;
