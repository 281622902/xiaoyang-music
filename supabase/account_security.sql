-- ══════════════════════════════════════════════════════════════════
-- 账户密保体系 v2（v3.15.2）
-- 变更：① 每用户 3~5 道密保题（支持自定义问题），找回时须全部答对
--       ② search_path = public, extensions 修复 gen_salt/crypt 找不到
-- 机制：answer_hash = sha256('xymusic-sec-v1|' + lower(trim(answer)))，客户端计算
--       密码重置直接写 auth.users.encrypted_password（pgcrypto bcrypt，GoTrue 兼容 $2a$）
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- v2 表结构：一行一道题
drop table if exists public.account_security cascade;
create table public.account_security (
  user_id     uuid not null references auth.users (id) on delete cascade,
  slot        int not null,            -- 0..4
  phone       text not null,           -- 11 位规范化手机号
  question    text not null,
  answer_hash text not null,           -- 客户端计算的 SHA-256
  attempts    int not null default 0,  -- 连续失败次数（>=5 锁定 30 分钟）
  locked_until timestamptz,
  created_at  timestamptz not null default now(),
  primary key (user_id, slot)
);
create index if not exists account_security_phone_idx on public.account_security (phone);

alter table public.account_security enable row level security;
-- 不建任何 policy = 匿名/普通用户均不可直接读写，一切走 security definer RPC

-- 读密保问题（找回第一步 / 登录后检测是否已设置；返回 [] = 未设置）
create or replace function public.get_security_question(p_phone text)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('slot', slot, 'question', question) order by slot),
    '[]'::jsonb)
  from public.account_security
  where phone = right(coalesce(p_phone, ''), 11);
$$;
grant execute on function public.get_security_question(text) to anon, authenticated;

-- 设置/更新密保（仅本人，登录态；3~5 题）
create or replace function public.set_security_question(p_questions jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_phone text;
  n int;
begin
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions must be an array';
  end if;
  n := jsonb_array_length(p_questions);
  if n < 3 then raise exception 'at least 3 security questions are required'; end if;
  if n > 5 then raise exception 'too many questions (max 5)'; end if;
  v_phone := right(coalesce((select phone from auth.users where id = auth.uid()), ''), 11);
  delete from public.account_security where user_id = auth.uid();
  insert into public.account_security (user_id, slot, phone, question, answer_hash)
  select auth.uid(), ord - 1, v_phone,
         left(q->>'question', 100), left(q->>'answer_hash', 64)
  from jsonb_array_elements(p_questions) with ordinality as t(q, ord);
  return true;
end;
$$;
revoke all on function public.set_security_question(jsonb) from public, anon;
grant execute on function public.set_security_question(jsonb) to authenticated;

-- 密保找回密码：全部题目答对 → 重置 auth.users.encrypted_password（含防暴力）
create or replace function public.reset_password_by_security(
  p_phone text, p_answers jsonb, p_new_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_phone   text := right(coalesce(p_phone, ''), 11);
  v_user    uuid;
  v_locked  timestamptz;
  v_att     int;
  v_total   int;
  v_correct int;
begin
  if length(coalesce(p_new_password, '')) < 6 then
    return 'new password must be at least 6 characters';
  end if;
  select max(locked_until), max(attempts) into v_locked, v_att
    from public.account_security where phone = v_phone;
  if v_locked is not null and v_locked > now() then
    return 'too many attempts, retry after ' || to_char(v_locked, 'HH24:MI');
  end if;
  select count(*),
         coalesce(sum(case when exists (
           select 1 from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
           where (a->>'slot')::int = s.slot
             and left(coalesce(a->>'answer_hash', ''), 64) = s.answer_hash
         ) then 1 else 0 end), 0)
    into v_total, v_correct
    from public.account_security s where s.phone = v_phone;
  if v_total = 0 then return 'security question not set for this account'; end if;
  if v_correct < v_total then
    update public.account_security
      set attempts = v_att + 1,
          locked_until = case when v_att + 1 >= 5 then now() + interval '30 minutes' else locked_until end
      where phone = v_phone;
    return 'wrong security answer';
  end if;
  select id into v_user from auth.users where right(coalesce(phone, ''), 11) = v_phone limit 1;
  if v_user is null then return 'account not found'; end if;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)) where id = v_user;
  update public.account_security set attempts = 0, locked_until = null where phone = v_phone;
  return 'ok';
end;
$$;
revoke all on function public.reset_password_by_security(text, jsonb, text) from public;
grant execute on function public.reset_password_by_security(text, jsonb, text) to anon, authenticated;

-- 管理员重置任意用户密码（个人主页会员管理 tab 使用）
create or replace function public.admin_reset_user_password(p_phone text, p_new_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then
    raise exception 'only admin can reset user password';
  end if;
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception 'new password must be at least 6 characters';
  end if;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10))
    where right(coalesce(phone, ''), 11) = right(coalesce(p_phone, ''), 11);
  return found;
end;
$$;
revoke all on function public.admin_reset_user_password(text, text) from public, anon;
grant execute on function public.admin_reset_user_password(text, text) to authenticated;

-- 校验密保答案（更改密保前验证；仅本人登录态；共享防暴力计数）
create or replace function public.verify_security_answers(p_answers jsonb)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid     uuid := auth.uid();
  v_att     int;
  v_locked  timestamptz;
  v_total   int;
  v_correct int;
begin
  if v_uid is null then return 'not logged in'; end if;
  select max(locked_until), max(attempts) into v_locked, v_att
    from public.account_security where user_id = v_uid;
  if v_locked is not null and v_locked > now() then
    return 'too many attempts, retry after ' || to_char(v_locked, 'HH24:MI');
  end if;
  select count(*),
         coalesce(sum(case when exists (
           select 1 from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
           where (a->>'slot')::int = s.slot
             and left(coalesce(a->>'answer_hash', ''), 64) = s.answer_hash
         ) then 1 else 0 end), 0)
    into v_total, v_correct
    from public.account_security s where s.user_id = v_uid;
  if v_total = 0 then return 'security question not set for this account'; end if;
  if v_correct < v_total then
    update public.account_security
      set attempts = v_att + 1,
          locked_until = case when v_att + 1 >= 5 then now() + interval '30 minutes' else locked_until end
      where user_id = v_uid;
    return 'wrong security answer';
  end if;
  update public.account_security set attempts = 0, locked_until = null where user_id = v_uid;
  return 'ok';
end;
$$;
revoke all on function public.verify_security_answers(jsonb) from public, anon;
grant execute on function public.verify_security_answers(jsonb) to authenticated;
