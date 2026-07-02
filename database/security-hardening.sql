-- Run once in Supabase Dashboard > SQL Editor.
begin;

alter table public.jcr_data enable row level security;
alter table public.hdgsnn_list enable row level security;
alter table public.scopus_list enable row level security;
alter table public.vip_plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.ai_usage enable row level security;

revoke insert, update, delete, truncate on public.jcr_data,
  public.hdgsnn_list, public.scopus_list from anon, authenticated;
grant select on public.jcr_data, public.hdgsnn_list, public.scopus_list
  to anon, authenticated;

drop policy if exists "users_read_own_profile" on public.profiles;
create policy "users_read_own_profile" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile" on public.profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "users_read_own_subscription" on public.subscriptions;
create policy "users_read_own_subscription" on public.subscriptions for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users_read_own_payments" on public.payments;
create policy "users_read_own_payments" on public.payments for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users_read_own_ai_usage" on public.ai_usage;
create policy "users_read_own_ai_usage" on public.ai_usage for select
  to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.subscriptions, public.payments,
  public.payment_events, public.ai_usage from anon;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.subscriptions, public.payments,
  public.payment_events, public.ai_usage from authenticated;
revoke select on public.payments from authenticated;
grant select (id, user_id, plan_id, amount_vnd, payment_code, status,
  created_at, expires_at, paid_at) on public.payments to authenticated;
grant select, update (display_name, updated_at) on public.profiles to authenticated;
grant select on public.subscriptions, public.ai_usage to authenticated;

-- Never assign privileges based on a hard-coded email address.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80))
  on conflict (user_id) do nothing;
  insert into public.subscriptions (user_id, plan_id, status, expires_at)
  values (new.id, 'chatbox_ai', 'inactive', null)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.consume_ai_message(uuid) from public, anon, authenticated;
revoke all on function public.process_sepay_payment(text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_ai_message(uuid) to service_role;
grant execute on function public.process_sepay_payment(text, text, integer, jsonb)
  to service_role;

do $$ begin
  if to_regclass('public.admin_users') is not null then
    execute 'alter table public.admin_users enable row level security';
    execute 'revoke all on public.admin_users from anon, authenticated';
  end if;
end $$;

commit;
