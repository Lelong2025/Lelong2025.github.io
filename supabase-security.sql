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
