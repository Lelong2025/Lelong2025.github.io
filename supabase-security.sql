-- Chạy một lần trong Supabase Dashboard > SQL Editor.
-- Ba bảng này là dữ liệu tra cứu công khai: chỉ cho phép đọc, cấm sửa từ client.

alter table public.jcr_data enable row level security;
alter table public.hdgsnn_list enable row level security;
alter table public.scopus_list enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on public.jcr_data, public.hdgsnn_list, public.scopus_list
  from anon, authenticated;

grant select on public.jcr_data, public.hdgsnn_list, public.scopus_list
  to anon, authenticated;

drop policy if exists "public_read_jcr_data" on public.jcr_data;
create policy "public_read_jcr_data"
  on public.jcr_data for select to anon, authenticated using (true);

drop policy if exists "public_read_hdgsnn_list" on public.hdgsnn_list;
create policy "public_read_hdgsnn_list"
  on public.hdgsnn_list for select to anon, authenticated using (true);

drop policy if exists "public_read_scopus_list" on public.scopus_list;
create policy "public_read_scopus_list"
  on public.scopus_list for select to anon, authenticated using (true);

-- ================================================================
-- Hệ thống tài khoản và VIP Chatbox AI
-- Cấu hình mặc định có thể đổi trong bảng vip_plans sau này.
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists public.vip_plans (
  id text primary key,
  name text not null,
  price_vnd integer not null check (price_vnd > 0),
  duration_days integer not null check (duration_days > 0),
  daily_ai_limit integer not null check (daily_ai_limit > 0),
  payment_prefix text not null check (payment_prefix ~ '^[A-Z0-9]{2,10}$'),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.vip_plans
  (id, name, price_vnd, duration_days, daily_ai_limit, payment_prefix, active)
values ('chatbox_ai', 'Chatbox AI', 25000, 30, 30, 'CHAT', true)
on conflict (id) do nothing;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null references public.vip_plans(id),
  status text not null default 'inactive' check (status in ('inactive', 'active', 'suspended')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.vip_plans(id),
  amount_vnd integer not null check (amount_vnd > 0),
  payment_code text not null unique check (payment_code ~ '^[A-Z0-9]{6,30}$'),
  provider text not null default 'sepay',
  provider_transaction_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_at timestamptz,
  raw_payload jsonb
);

create index if not exists payments_user_created_idx
  on public.payments(user_id, created_at desc);
create index if not exists payments_pending_code_idx
  on public.payments(payment_code) where status = 'pending';

create table if not exists public.payment_events (
  provider text not null,
  provider_transaction_id text not null,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null,
  primary key (provider, provider_transaction_id)
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  message_count integer not null default 0 check (message_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.vip_plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "public_read_active_vip_plans" on public.vip_plans;
create policy "public_read_active_vip_plans" on public.vip_plans
  for select to anon, authenticated using (active = true);

drop policy if exists "users_read_own_profile" on public.profiles;
create policy "users_read_own_profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users_read_own_subscription" on public.subscriptions;
create policy "users_read_own_subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "users_read_own_payments" on public.payments;
create policy "users_read_own_payments" on public.payments
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "users_read_own_ai_usage" on public.ai_usage;
create policy "users_read_own_ai_usage" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.subscriptions, public.payments,
  public.payment_events, public.ai_usage from anon;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.subscriptions, public.payments,
  public.payment_events, public.ai_usage from authenticated;
grant select on public.vip_plans to anon, authenticated;
grant select, update (display_name, updated_at) on public.profiles to authenticated;
grant select on public.subscriptions, public.payments, public.ai_usage to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80))
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan_id, status, expires_at)
  values (
    new.id,
    'chatbox_ai',
    case when new.email = 'phuonglong@lhu.edu.vn' then 'active'::text else 'inactive'::text end,
    case when new.email = 'phuonglong@lhu.edu.vn' then '2099-12-31 23:59:59+00'::timestamptz else null end
  )
  on conflict (user_id) do update
    set status = excluded.status,
        expires_at = excluded.expires_at;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Bổ sung hồ sơ nếu dự án đã có người dùng trước khi chạy migration này.
insert into public.profiles (user_id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'display_name', ''), 80)
from auth.users
on conflict (user_id) do nothing;

insert into public.subscriptions (user_id, plan_id, status, expires_at)
select
  id,
  'chatbox_ai',
  case when email = 'phuonglong@lhu.edu.vn' then 'active'::text else 'inactive'::text end,
  case when email = 'phuonglong@lhu.edu.vn' then '2099-12-31 23:59:59+00'::timestamptz else null end
from auth.users
on conflict (user_id) do update
  set status = excluded.status,
      expires_at = excluded.expires_at;

-- Trừ một lượt chat theo cách atomic, đồng thời kiểm tra VIP ở server.
create or replace function public.consume_ai_message(p_user_id uuid)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_expires timestamptz;
  v_limit integer;
  v_count integer;
begin
  select s.expires_at, p.daily_ai_limit
    into v_expires, v_limit
  from public.subscriptions s
  join public.vip_plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and p.active = true
  for update of s;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('allowed', false, 'reason', 'vip_required');
  end if;

  v_count := null;
  insert into public.ai_usage (user_id, usage_date, message_count, updated_at)
  values (p_user_id, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id, usage_date) do update
    set message_count = public.ai_usage.message_count + 1,
        updated_at = now()
    where public.ai_usage.message_count < v_limit
  returning message_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_limit);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_count,
    'limit', v_limit,
    'remaining', greatest(v_limit - v_count, 0),
    'vip_expires_at', v_expires
  );
end;
$$;

-- Xử lý webhook đúng một lần và cộng dồn số ngày VIP.
create or replace function public.process_sepay_payment(
  p_payment_code text,
  p_transaction_id text,
  p_amount integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_days integer;
  v_new_expiry timestamptz;
begin
  insert into public.payment_events
    (provider, provider_transaction_id, raw_payload)
  values ('sepay', p_transaction_id, p_payload)
  on conflict do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_payment
  from public.payments
  where payment_code = upper(p_payment_code)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_payment.status = 'paid' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_payment.status <> 'pending' or v_payment.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'order_expired');
  end if;
  if v_payment.amount_vnd <> p_amount then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  select duration_days into v_days
  from public.vip_plans where id = v_payment.plan_id and active = true;
  if v_days is null then
    return jsonb_build_object('ok', false, 'reason', 'plan_inactive');
  end if;

  update public.payments
    set status = 'paid', provider_transaction_id = p_transaction_id,
        paid_at = now(), raw_payload = p_payload
  where id = v_payment.id;

  insert into public.subscriptions (user_id, plan_id, status, expires_at, updated_at)
  values (v_payment.user_id, v_payment.plan_id, 'active', now() + make_interval(days => v_days), now())
  on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        status = 'active',
        expires_at = greatest(coalesce(public.subscriptions.expires_at, now()), now())
          + make_interval(days => v_days),
        updated_at = now()
  returning expires_at into v_new_expiry;

  return jsonb_build_object('ok', true, 'user_id', v_payment.user_id,
    'vip_expires_at', v_new_expiry);
end;
$$;

revoke all on function public.consume_ai_message(uuid) from public, anon, authenticated;
revoke all on function public.process_sepay_payment(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.consume_ai_message(uuid) to service_role;
grant execute on function public.process_sepay_payment(text, text, integer, jsonb) to service_role;
