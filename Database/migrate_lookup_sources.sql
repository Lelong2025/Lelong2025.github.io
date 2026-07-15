create table if not exists public.lookup_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  result_url text,
  sample_keyword text,
  url_template text not null,
  source_type text not null default 'search' check (source_type in ('fixed', 'search', 'journal_checker_widget')),
  display_mode text not null default 'both' check (display_mode in ('iframe', 'link', 'both')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lookup_sources_https_template check (url_template ~* '^https://'),
  constraint lookup_sources_https_result check (result_url is null or result_url ~* '^https://'),
  constraint lookup_sources_search_has_query check (source_type <> 'search' or position('{{query}}' in url_template) > 0)
);

create index if not exists lookup_sources_active_order_idx
  on public.lookup_sources (is_active, sort_order, created_at);

alter table public.lookup_sources
  add column if not exists display_mode text not null default 'both';

alter table public.lookup_sources
  drop constraint if exists lookup_sources_display_mode_check;

alter table public.lookup_sources
  add constraint lookup_sources_display_mode_check
  check (display_mode in ('iframe', 'link', 'both'));

alter table public.lookup_sources
  drop constraint if exists lookup_sources_source_type_check;

alter table public.lookup_sources
  add constraint lookup_sources_source_type_check
  check (source_type in ('fixed', 'search', 'journal_checker_widget'));

alter table public.lookup_sources enable row level security;

drop policy if exists public_read_active_lookup_sources on public.lookup_sources;
create policy public_read_active_lookup_sources
on public.lookup_sources for select
to anon, authenticated
using (is_active = true);

drop policy if exists admin_read_all_lookup_sources on public.lookup_sources;
create policy admin_read_all_lookup_sources
on public.lookup_sources for select
to authenticated
using (public.is_magazine_admin());

grant select on public.lookup_sources to anon, authenticated;
grant insert, update, delete on public.lookup_sources to service_role;

insert into public.lookup_sources (name, result_url, sample_keyword, url_template, source_type, display_mode, is_active, sort_order)
select seed.name, seed.result_url, seed.sample_keyword, seed.url_template, seed.source_type, seed.display_mode, seed.is_active, seed.sort_order
from (
  values
    ('Non-APC', 'https://noapc.com/journal.php?q=iatreia', 'iatreia', 'https://noapc.com/journal.php?q={{query}}', 'search', 'both', true, 10),
    ('Resurchify', 'https://www.resurchify.com/find/?query=2773+0123#search_results', '2773 0123', 'https://www.resurchify.com/find/?query={{query}}#search_results', 'search', 'both', true, 20),
    ('Web Of Science', 'https://wos-journal.info/?jsearch=iatreia', 'iatreia', 'https://wos-journal.info/?jsearch={{query}}', 'search', 'both', true, 30)
) as seed(name, result_url, sample_keyword, url_template, source_type, display_mode, is_active, sort_order)
where not exists (
  select 1 from public.lookup_sources existing
  where lower(existing.name) = lower(seed.name)
);
