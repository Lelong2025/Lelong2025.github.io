-- ============================================================
-- CHẠY FILE NÀY trong Supabase SQL Editor để fix lỗi RLS
-- Cấp quyền cho anon role (publishable key) có thể ghi dữ liệu
-- ============================================================

-- Tắt RLS (chạy lại để chắc chắn)
ALTER TABLE jcr_data    DISABLE ROW LEVEL SECURITY;
ALTER TABLE hdgsnn_list DISABLE ROW LEVEL SECURITY;
ALTER TABLE scopus_list DISABLE ROW LEVEL SECURITY;

-- Cấp quyền SELECT, INSERT, DELETE cho role anon
GRANT SELECT, INSERT, DELETE, UPDATE ON jcr_data    TO anon;
GRANT SELECT, INSERT, DELETE, UPDATE ON hdgsnn_list TO anon;
GRANT SELECT, INSERT, DELETE, UPDATE ON scopus_list TO anon;

-- Cấp quyền dùng SEQUENCE (cần cho SERIAL/auto-increment id)
GRANT USAGE, SELECT ON SEQUENCE jcr_data_id_seq    TO anon;
GRANT USAGE, SELECT ON SEQUENCE hdgsnn_list_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE scopus_list_id_seq TO anon;
