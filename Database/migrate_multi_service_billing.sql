begin;

-- Billing test data is intentionally discarded. Application/auth/content
-- tables are not touched by this reset.
drop function if exists public.activate_free_trial(uuid) cascade;
drop function if exists public.consume_ai_message(uuid) cascade;
drop function if exists public.process_sepay_payment(text, text, integer, jsonb) cascade;
drop function if exists public.get_my_account_info() cascade;
drop function if exists public.admin_get_dashboard_stats() cascade;
drop function if exists public.admin_get_timeseries(text, text, integer) cascade;
drop function if exists public.admin_get_user_payments(uuid) cascade;
drop function if exists public.admin_count_users(text) cascade;
drop function if exists public.admin_list_users(integer, integer, text) cascade;
drop function if exists public.admin_update_vip_plan(text, integer, integer, integer, text, boolean) cascade;
drop function if exists public.initialize_user_services(uuid, timestamptz) cascade;
drop function if exists public.handle_new_user_service_trials() cascade;
drop function if exists public.reserve_service_usage(uuid, text, text, text, jsonb) cascade;
drop function if exists public.finalize_service_usage(uuid, uuid, boolean) cascade;

drop table if exists public.service_usage cascade;
drop table if exists public.service_daily_usage cascade;
drop table if exists public.auto_renew_preferences cascade;
drop table if exists public.user_entitlements cascade;
drop table if exists public.user_wallets cascade;
drop table if exists public.payment_events cascade;
drop table if exists public.payments cascade;
drop table if exists public.service_plans cascade;
drop table if exists public.service_products cascade;
drop table if exists public.ai_usage cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.vip_plans cascade;

create table if not exists public.service_products (
  code text primary key,
  name text not null,
  description text not null default '',
  trial_days integer not null default 14 check (trial_days >= 0),
  trial_daily_limit integer not null default 30 check (trial_daily_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_products (code, name, description, trial_days, trial_daily_limit)
values
  ('chatbox_ai', 'Chatbox AI', 'Trợ lý tra cứu tạp chí', 14, 30),
  ('magazine_export', 'Xuất báo Word/PDF', 'Xuất bài hoặc số báo sang Word và PDF', 14, 30),
  ('magazine_ai_review', 'AI Review', 'Đánh giá học thuật bài báo bằng AI', 14, 30)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

create table if not exists public.service_plans (
  id text primary key,
  product_code text not null references public.service_products(code),
  name text not null,
  billing_type text not null check (billing_type in ('credit_pack', 'monthly')),
  price_vnd integer not null check (price_vnd >= 0),
  credits integer not null check (credits > 0),
  duration_days integer check (
    (billing_type = 'credit_pack' and duration_days is null)
    or (billing_type = 'monthly' and duration_days is not null and duration_days > 0)
  ),
  payment_prefix text not null default 'CHAT',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_plans_product_idx
  on public.service_plans(product_code, active, sort_order);

create table if not exists public.user_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_vnd integer not null default 0 check (balance_vnd >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.service_products(code),
  credit_balance integer not null default 0 check (credit_balance >= 0),
  monthly_balance integer not null default 0 check (monthly_balance >= 0),
  monthly_plan_id text references public.service_plans(id),
  monthly_started_at timestamptz,
  monthly_ends_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_daily_limit integer not null default 30 check (trial_daily_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_code)
);

create table if not exists public.auto_renew_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.service_products(code),
  plan_id text not null references public.service_plans(id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, product_code)
);

create table if not exists public.service_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.service_products(code),
  usage_date date not null default ((now() at time zone 'utc')::date),
  usage_count integer not null default 0 check (usage_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_code, usage_date)
);

create table if not exists public.service_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.service_products(code),
  action text not null,
  units integer not null default 1 check (units > 0),
  source text not null check (source in ('admin', 'trial', 'monthly', 'credits', 'wallet_renewal')),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'refunded')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (user_id, product_code, idempotency_key)
);

create index if not exists service_usage_user_created_idx
  on public.service_usage(user_id, created_at desc);
create index if not exists service_usage_product_created_idx
  on public.service_usage(product_code, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text references public.service_products(code),
  service_plan_id text references public.service_plans(id),
  amount_vnd integer not null check (amount_vnd > 0),
  payment_code text not null unique check (payment_code ~ '^[A-Z0-9]{6,30}$'),
  provider text not null default 'sepay',
  provider_transaction_id text unique,
  sepay_transaction_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  order_type text not null check (order_type in ('plan_purchase', 'wallet_topup')),
  credits_granted integer not null default 0,
  wallet_amount_vnd integer not null default 0,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_at timestamptz
);

create table public.payment_events (
  provider text not null,
  provider_transaction_id text not null,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null,
  primary key (provider, provider_transaction_id)
);

create index if not exists payments_product_created_idx
  on public.payments(product_code, created_at desc);
create index payments_user_created_idx on public.payments(user_id, created_at desc);
create index payments_pending_code_idx on public.payments(payment_code) where status = 'pending';

create or replace function public.initialize_user_services(
  p_user_id uuid,
  p_trial_started_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer := 0;
begin
  insert into public.user_wallets (user_id, balance_vnd)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  insert into public.user_entitlements (
    user_id, product_code, trial_started_at, trial_ends_at, trial_daily_limit
  )
  select
    p_user_id, p.code, p_trial_started_at,
    p_trial_started_at + make_interval(days => p.trial_days),
    p.trial_daily_limit
  from public.service_products p
  where p.active = true
  on conflict (user_id, product_code) do nothing;

  get diagnostics v_count = row_count;
  return jsonb_build_object('initialized', true, 'services_created', v_count);
end;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (user_id, display_name, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80),
    coalesce(new.email, '')
  )
  on conflict (user_id) do update
  set email = excluded.email,
      display_name = case when public.profiles.display_name = '' then excluded.display_name else public.profiles.display_name end,
      updated_at = now();
  perform public.initialize_user_services(new.id, coalesce(new.created_at, now()));
  return new;
end;
$function$;

drop trigger if exists on_auth_user_service_trials on auth.users;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Billing data is test-only, so every existing account starts the clean
-- 14-day trial at reset time.
select public.initialize_user_services(u.id, now()) from auth.users u;

create or replace function public.reserve_service_usage(
  p_user_id uuid,
  p_product_code text,
  p_action text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ent public.user_entitlements%rowtype;
  v_existing public.service_usage%rowtype;
  v_plan public.service_plans%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_pref public.auto_renew_preferences%rowtype;
  v_source text;
  v_usage integer;
  v_reservation_id uuid;
  v_today date := (now() at time zone 'utc')::date;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_idempotency_key');
  end if;

  select * into v_existing from public.service_usage
  where user_id = p_user_id and product_code = p_product_code
    and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'allowed', v_existing.status in ('reserved', 'consumed'),
      'reservation_id', v_existing.id,
      'status', v_existing.status,
      'source', v_existing.source
    );
  end if;

  select * into v_ent from public.user_entitlements
  where user_id = p_user_id and product_code = p_product_code
  for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'service_unavailable');
  end if;

  if v_ent.trial_ends_at is not null and v_ent.trial_ends_at > now() then
    insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
    values (p_user_id, p_product_code, v_today, 1)
    on conflict (user_id, product_code, usage_date)
    do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
    returning usage_count into v_usage;
    if v_usage > v_ent.trial_daily_limit then
      update public.service_daily_usage set usage_count = usage_count - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_ent.trial_daily_limit);
    end if;
    v_source := 'trial';
  elsif v_ent.monthly_ends_at is not null and v_ent.monthly_ends_at > now() and v_ent.monthly_balance > 0 then
    insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
    values (p_user_id, p_product_code, v_today, 1)
    on conflict (user_id, product_code, usage_date)
    do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
    returning usage_count into v_usage;
    if v_usage > v_ent.monthly_balance then
      update public.service_daily_usage set usage_count = usage_count - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_ent.monthly_balance);
    end if;
    v_source := 'monthly';
  elsif v_ent.credit_balance > 0 then
    update public.user_entitlements set credit_balance = credit_balance - 1, updated_at = now()
    where user_id = p_user_id and product_code = p_product_code;
    v_source := 'credits';
  else
    select * into v_pref from public.auto_renew_preferences
    where user_id = p_user_id and product_code = p_product_code and enabled = true;
    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'credits_exhausted');
    end if;
    select * into v_plan from public.service_plans
    where id = v_pref.plan_id and product_code = p_product_code and active = true;
    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'renewal_plan_unavailable');
    end if;
    select * into v_wallet from public.user_wallets where user_id = p_user_id for update;
    if not found or v_wallet.balance_vnd < v_plan.price_vnd then
      return jsonb_build_object('allowed', false, 'reason', 'wallet_insufficient', 'required_vnd', v_plan.price_vnd);
    end if;
    if v_plan.billing_type = 'monthly' then
      select coalesce(usage_count, 0) into v_usage
      from public.service_daily_usage
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      if coalesce(v_usage, 0) >= v_plan.credits then
        return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_plan.credits);
      end if;
    end if;
    update public.user_wallets
    set balance_vnd = balance_vnd - v_plan.price_vnd, updated_at = now()
    where user_id = p_user_id;
    if v_plan.billing_type = 'monthly' then
      update public.user_entitlements
      set monthly_plan_id = v_plan.id,
          monthly_started_at = now(),
          monthly_ends_at = now() + make_interval(days => v_plan.duration_days),
          monthly_balance = v_plan.credits,
          updated_at = now()
      where user_id = p_user_id and product_code = p_product_code;
      insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
      values (p_user_id, p_product_code, v_today, 1)
      on conflict (user_id, product_code, usage_date)
      do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
      returning usage_count into v_usage;
      v_source := 'monthly';
    else
      update public.user_entitlements
      set credit_balance = credit_balance + v_plan.credits - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code;
      v_source := 'credits';
    end if;
  end if;

  insert into public.service_usage (
    user_id, product_code, action, units, source, status, idempotency_key, metadata
  ) values (
    p_user_id, p_product_code, p_action, 1, v_source, 'reserved', p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_reservation_id;

  select * into v_ent from public.user_entitlements
  where user_id = p_user_id and product_code = p_product_code;
  select * into v_wallet from public.user_wallets where user_id = p_user_id;
  return jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'source', v_source,
    'credit_balance', v_ent.credit_balance,
    'monthly_balance', v_ent.monthly_balance,
    'daily_usage', coalesce(v_usage, 0),
    'daily_remaining', case when v_source in ('trial', 'monthly')
      then greatest((case when v_source = 'trial' then v_ent.trial_daily_limit else v_ent.monthly_balance end) - coalesce(v_usage, 0), 0)
      else null end,
    'remaining_credits', v_ent.credit_balance + case when v_source in ('trial', 'monthly')
      then greatest((case when v_source = 'trial' then v_ent.trial_daily_limit else v_ent.monthly_balance end) - coalesce(v_usage, 0), 0)
      else 0 end,
    'wallet_balance_vnd', coalesce(v_wallet.balance_vnd, 0)
  );
end;
$function$;

create or replace function public.finalize_service_usage(
  p_user_id uuid,
  p_reservation_id uuid,
  p_success boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_usage public.service_usage%rowtype;
begin
  select * into v_usage from public.service_usage
  where id = p_reservation_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'reservation_not_found'); end if;
  if v_usage.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'status', v_usage.status);
  end if;

  if p_success then
    update public.service_usage set status = 'consumed', finalized_at = now()
    where id = v_usage.id;
    return jsonb_build_object('ok', true, 'status', 'consumed');
  end if;

  if v_usage.source = 'trial' then
    update public.service_daily_usage
    set usage_count = greatest(usage_count - v_usage.units, 0), updated_at = now()
    where user_id = v_usage.user_id and product_code = v_usage.product_code
      and usage_date = ((v_usage.created_at at time zone 'utc')::date);
  elsif v_usage.source = 'monthly' then
    update public.service_daily_usage
    set usage_count = greatest(usage_count - v_usage.units, 0), updated_at = now()
    where user_id = v_usage.user_id and product_code = v_usage.product_code
      and usage_date = ((v_usage.created_at at time zone 'utc')::date);
  elsif v_usage.source in ('credits', 'wallet_renewal') then
    update public.user_entitlements
    set credit_balance = credit_balance + v_usage.units, updated_at = now()
    where user_id = v_usage.user_id and product_code = v_usage.product_code;
  end if;

  update public.service_usage set status = 'refunded', finalized_at = now()
  where id = v_usage.id;
  return jsonb_build_object('ok', true, 'status', 'refunded');
end;
$function$;

create or replace function public.process_sepay_payment(
  p_payment_code text,
  p_transaction_id text,
  p_amount integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_service_plan public.service_plans%rowtype;
  v_credits integer := 0;
  v_order_type text;
  v_product_code text;
begin
  select * into v_payment from public.payments
  where payment_code = upper(trim(p_payment_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'payment_not_found'); end if;
  if v_payment.status = 'paid' then return jsonb_build_object('ok', true, 'reason', 'already_paid'); end if;
  if v_payment.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'payment_not_pending'); end if;
  if v_payment.expires_at is not null and v_payment.expires_at <= now() then
    update public.payments set status = 'expired' where id = v_payment.id;
    return jsonb_build_object('ok', false, 'reason', 'payment_expired');
  end if;
  if exists (select 1 from public.payments where sepay_transaction_id = p_transaction_id and id <> v_payment.id) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_transaction');
  end if;
  if p_amount <> v_payment.amount_vnd then return jsonb_build_object('ok', false, 'reason', 'amount_mismatch'); end if;

  v_order_type := v_payment.order_type;
  v_product_code := v_payment.product_code;

  if v_order_type = 'plan_purchase' then
    select * into v_service_plan from public.service_plans
    where id = v_payment.service_plan_id and active = true;
    if not found then return jsonb_build_object('ok', false, 'reason', 'plan_unavailable'); end if;
    v_credits := v_service_plan.credits;
    v_product_code := v_service_plan.product_code;
  elsif v_order_type <> 'wallet_topup' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_order_type');
  end if;

  insert into public.payment_events (provider, provider_transaction_id, raw_payload)
  values ('sepay', p_transaction_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, provider_transaction_id) do nothing;

  update public.payments
  set status = 'paid', paid_at = now(), credits_granted = v_credits,
      wallet_amount_vnd = case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end,
      product_code = v_product_code, sepay_transaction_id = p_transaction_id,
      provider_transaction_id = coalesce(provider_transaction_id, p_transaction_id),
      raw_payload = p_payload
  where id = v_payment.id;

  insert into public.user_wallets (user_id, balance_vnd)
  values (v_payment.user_id, case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end)
  on conflict (user_id) do update
  set balance_vnd = public.user_wallets.balance_vnd
      + case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end,
      updated_at = now();

  if v_order_type = 'plan_purchase' then
    insert into public.user_entitlements (user_id, product_code)
    values (v_payment.user_id, v_service_plan.product_code)
    on conflict (user_id, product_code) do nothing;
    if v_service_plan.billing_type = 'monthly' then
      update public.user_entitlements
      set monthly_plan_id = v_service_plan.id,
          monthly_started_at = now(),
          monthly_ends_at = now() + make_interval(days => v_service_plan.duration_days),
          monthly_balance = v_service_plan.credits,
          updated_at = now()
      where user_id = v_payment.user_id and product_code = v_service_plan.product_code;
    else
      update public.user_entitlements
      set credit_balance = credit_balance + v_service_plan.credits, updated_at = now()
      where user_id = v_payment.user_id and product_code = v_service_plan.product_code;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'product_code', v_product_code, 'credits_granted', v_credits,
    'wallet_amount_vnd', case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end
  );
end;
$function$;

alter table public.service_products enable row level security;
alter table public.service_plans enable row level security;
alter table public.user_wallets enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.auto_renew_preferences enable row level security;
alter table public.service_daily_usage enable row level security;
alter table public.service_usage enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists public_read_active_service_products on public.service_products;
create policy public_read_active_service_products on public.service_products
for select to anon, authenticated using (active = true);
drop policy if exists public_read_active_service_plans on public.service_plans;
create policy public_read_active_service_plans on public.service_plans
for select to anon, authenticated using (active = true);

drop policy if exists users_read_own_wallet on public.user_wallets;
create policy users_read_own_wallet on public.user_wallets
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists users_read_own_entitlements on public.user_entitlements;
create policy users_read_own_entitlements on public.user_entitlements
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists users_read_own_renewals on public.auto_renew_preferences;
create policy users_read_own_renewals on public.auto_renew_preferences
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists users_read_own_service_usage on public.service_usage;
create policy users_read_own_service_usage on public.service_usage
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists users_read_own_daily_service_usage on public.service_daily_usage;
create policy users_read_own_daily_service_usage on public.service_daily_usage
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists users_read_own_payments on public.payments;
create policy users_read_own_payments on public.payments
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists admin_read_all_payments on public.payments;
create policy admin_read_all_payments on public.payments
for select to authenticated using (public.is_magazine_admin());

revoke all on function public.initialize_user_services(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_service_usage(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_service_usage(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.process_sepay_payment(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_service_usage(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.finalize_service_usage(uuid, uuid, boolean) to service_role;
grant execute on function public.process_sepay_payment(text, text, integer, jsonb) to service_role;

commit;
