-- ═══════════════════════════════════════════════════════════════
-- 小杨音乐 · 设备授权表（v3.5.0 防泄露机制）
--
-- 用途：
--   App 首次安装到「陌生设备」时必须输入授权码；同一台设备升级新版本
--   凭本地记录自动续期，无需再次输入。
--
-- 设计要点：
--   1. 授权码与「设备指纹 + 版本号」绑定，泄露到别的设备无法使用；
--   2. 授权码带版本号，每次发版换一批新码 —— 旧版本授权码在新版本上
--      校验失败，自动失效；
--   3. revoked=true 可随时吊销单个码（设备丢失、App 外泄时止损）；
--   4. 本表只允许 service_role 访问（服务端代理读写），不开放 anon 策略，
--      避免任何人自行签发授权码。
--
-- 需要的 Supabase 环境变量：SUPABASE_URL / SUPABASE_SERVICE_KEY
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.app_licenses (
  code        text primary key,
  device_id   text        not null,
  version     text        not null,
  platform    text        not null default 'android',
  note        text,
  revoked     boolean     not null default false,
  issued_at   timestamptz not null default now(),
  used_at     timestamptz
);

create index if not exists app_licenses_device_idx on public.app_licenses (device_id);
create index if not exists app_licenses_version_idx on public.app_licenses (version);

-- 开启 RLS 并显式拒绝 anon/authenticated 直连：
-- 所有读写必须经音乐后端 /api/auth/license/* 用 service_role 代理。
alter table public.app_licenses enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'app_licenses' and policyname = 'app_licenses_service_only') then
    create policy app_licenses_service_only on public.app_licenses for all to service_role using (true) with check (true);
  end if;
end
$$;
