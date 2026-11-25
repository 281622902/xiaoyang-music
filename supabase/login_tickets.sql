-- ══════════════════════════════════════════════════════════════════
-- 扫码登录票据表（桌面端显示二维码 → 手机端 xymusic App 扫码确认 → 桌面端轮询放行）
--
-- 状态机：
--   pending   已生成，等待扫码
--   scanned   手机已扫码，等待确认
--   confirmed 已确认（user_id 已写入；桌面端凭 token 换会话）
--   expired   过期作废（TTL 3 分钟，桌面端检测后提示刷新）
--
-- 安全模型：token 是唯一能力凭证（32 字节随机 hex），泄露即可接管票据，
-- 因此：仅未过期票据可读、confirmed 后不再开放更新、票据 5 分钟后由
-- pg_cron/应用侧删除。anon 可 insert/select（桌面端未登录），
-- 仅登录用户可把票据推进为 scanned/confirmed（手机端 App 已登录）。
--
-- 后续接入（手机端）：
--   1) App 扫码得到 xymusic://qr-login?t=<token>，App 端登录态下
--      update status='scanned'；
--   2) 用户点「确认登录」→ update status='confirmed', user_id=auth.uid()；
--   3) 桌面端轮询到 confirmed 后，调用音乐后端（Render，持 service role）
--      /api/login/qr/claim 换取一次性 OTP（admin.generateLink type=sms），
--      再走 supabase-js verifyOtp({phone, token, type:'sms'}) 建立会话。
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.login_tickets (
  token        text primary key,
  status       text not null default 'pending'
               check (status in ('pending', 'scanned', 'confirmed', 'expired')),
  user_id      uuid references auth.users (id) on delete cascade,
  scanned_at   timestamptz,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '3 minutes')
);

alter table public.login_tickets enable row level security;

-- 生成票据：任何人可创建（桌面端未登录时也要能出码）
drop policy if exists "login_tickets_insert" on public.login_tickets;
create policy "login_tickets_insert"
  on public.login_tickets for insert
  to anon, authenticated
  with check (true);

-- 读取票据：桌面端凭 token 轮询；只放行未过期行，且 confirmed 行立即对 anon 隐藏
-- （confirmed 票据只能由后端 service role 凭 token 精确读取换会话）
drop policy if exists "login_tickets_select" on public.login_tickets;
create policy "login_tickets_select"
  on public.login_tickets for select
  to anon, authenticated
  using (expires_at > now() and status <> 'confirmed');

-- 推进票据：仅已登录用户（手机端 App）可把未过期、未确认的票据推进；
-- 禁止把 confirmed 改回去（update 策略的 using 限定旧行，check 限定新行）
drop policy if exists "login_tickets_update" on public.login_tickets;
create policy "login_tickets_update"
  on public.login_tickets for update
  to authenticated
  using (expires_at > now() and status <> 'confirmed')
  with check (status in ('scanned', 'confirmed') and user_id = auth.uid() or status = 'scanned');

-- 清理辅助：视图 + 惰性删除。若库中启用了 pg_cron 可加定时任务：
--   select cron.schedule('login_tickets_gc', '*/5 * * * *',
--     $$delete from public.login_tickets where expires_at < now() - interval '2 minutes'$$);
create index if not exists login_tickets_expires_idx
  on public.login_tickets (expires_at);
