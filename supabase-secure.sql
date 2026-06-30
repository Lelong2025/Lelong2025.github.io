-- ============================================================
-- SQL SCRIPT ĐỂ BẢO MẬT SUPABASE DATABASE
-- Chạy file này trong Supabase SQL Editor (https://supabase.com)
-- ============================================================

-- 1. Bật tính năng Row Level Security (RLS) cho tất cả các bảng
-- Điều này ngăn chặn việc truy cập tự do từ client (web/app)
ALTER TABLE jcr_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE hdgsnn_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE scopus_list ENABLE ROW LEVEL SECURITY;

-- 2. Thu hồi toàn bộ quyền INSERT, UPDATE, DELETE đối với role 'anon' (anonymous/publishable key)
-- Role anon bây giờ chỉ được phép truy vấn dữ liệu (SELECT)
REVOKE INSERT, UPDATE, DELETE ON jcr_data FROM anon;
REVOKE INSERT, UPDATE, DELETE ON hdgsnn_list FROM anon;
REVOKE INSERT, UPDATE, DELETE ON scopus_list FROM anon;

-- Thu hồi quyền dùng sequence tự tăng đối với role anon để tránh spam
REVOKE USAGE, SELECT ON SEQUENCE jcr_data_id_seq FROM anon;
REVOKE USAGE, SELECT ON SEQUENCE hdgsnn_list_id_seq FROM anon;
REVOKE USAGE, SELECT ON SEQUENCE scopus_list_id_seq FROM anon;

-- 3. Tạo chính sách RLS (Policy) cho phép đọc công khai (SELECT) cho tất cả mọi người (anon)
-- Policy này cho phép tất cả khách truy cập website đọc dữ liệu nhưng không thể chỉnh sửa hay xoá.
DROP POLICY IF EXISTS "Allow public read-only" ON jcr_data;
CREATE POLICY "Allow public read-only" ON jcr_data 
    FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public read-only" ON hdgsnn_list;
CREATE POLICY "Allow public read-only" ON hdgsnn_list 
    FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public read-only" ON scopus_list;
CREATE POLICY "Allow public read-only" ON scopus_list 
    FOR SELECT TO anon USING (true);
