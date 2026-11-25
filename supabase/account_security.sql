-- ══════════════════════════════════════════════════════════════════
-- 账户密保体系（v3.15.1）
-- 用途：短信不可用时的密码找回 + 引导用户设置密保
-- 机制：answer_hash = sha256('xymusic-sec-v1|' + lower(trim(answer)))，客户端计算
--       密码重置直接写 auth.users.encrypted_password（pgcrypto bcrypt，GoTrue 兼容 $2a$）
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists public.account_security (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  phone        text not null,           -- 11 位规范化手机号
  question     text not null,
  answer_hash  text not null,           -- 客户端计算的 SHA-256
  attempts     int not null default 0,  -- 连续失败次数（>=5 锁定 30 分钟）
  locked_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.account_security enable row level security;
-- 不建任何 policy = 匿名/普通用户均不可直接读写，一切走 security definer RPC

-- 读密保问题（找回第一步 / 登录后检测是否已设置；返回 null = 未设置）
create or replace function public.get_security_question(p_phone text)
returns text
language sql stable security definer set search_path = public as $$
  select question from public.account_security
  where phone = right(coalesce(p_phone, ''), 11) limit 1;
$$;
grant execute on function public.get_security_question(text) to anon, authenticated;

-- 设置/更新密保（仅本人，登录态）
create or replace function public.set_security_question(p_question text, p_answer_hash text)
returns boolean
language sql security definer set search_path = public as $$
  insert into public.account_security (user_id, phone, question, answer_hash, attempts, locked_until)
  values (auth.uid(),
          right(coalesce((select phone from auth.users where id = auth.uid()), ''), 11),
          left(p_question, 100), left(p_answer_hash, 64), 0, null)
  on conflict (user_id) do update
    set question = excluded.question,
        answer_hash = excluded.answer_hash,
        attempts = 0,
        locked_until = null,
        updated_at = now()
  returning true;
$$;
revoke all on function public.set_security_question(text, text) from public, anon;
grant execute on function public.set_security_question(text, text) to authenticated;

-- 密保找回密码：校验答案 → 重置 auth.users.encrypted_password（含防暴力）
create or replace function public.reset_password_by_security(
  p_phone text, p_answer_hash text, p_new_password text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_rec   public.account_security;
  v_user  uuid;
  v_phone text := right(coalesce(p_phone, ''), 11);
begin
  if length(coalesce(p_new_password, '')) < 6 then
    return '新密码至少 6 位';
  end if;
  select * into v_rec from public.account_security where phone = v_phone limit 1;
  if not found then return '该账户未设置密保'; end if;
  if v_rec.locked_until is not null and v_rec.locked_until > now() then
    return '尝试次数过多，请 ' || to_char(v_rec.locked_until, 'HH24:MI') || ' 后再试';
  end if;
  if v_rec.answer_hash <> left(coalesce(p_answer_hash, ''), 64) then
    update public.account_security
      set attempts = attempts + 1,
          locked_until = case when attempts + 1 >= 5 then now() + interval '30 minutes' else locked_until end
      where user_id = v_rec.user_id;
    return '密保答案不正确';
  end if;
  select id into v_user from auth.users where right(coalesce(phone, ''), 11) = v_phone limit 1;
  if v_user is null then return '账户不存在'; end if;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)) where id = v_user;
  update public.account_security set attempts = 0, locked_until = null where user_id = v_rec.user_id;
  return 'ok';
end;
$$;
revoke all on function public.reset_password_by_security(text, text, text) from public;
grant execute on function public.reset_password_by_security(text, text, text) to anon, authenticated;

-- 管理员重置任意用户密码（个人主页会员管理 tab 使用）
create or replace function public.admin_reset_user_password(p_phone text, p_new_password text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '仅管理员可重置用户密码';
  end if;
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception '新密码至少 6 位';
  end if;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10))
    where right(coalesce(phone, ''), 11) = right(coalesce(p_phone, ''), 11);
  return found;
end;
$$;
revoke all on function public.admin_reset_user_password(text, text) from public, anon;
grant execute on function public.admin_reset_user_password(text, text) to authenticated;
