-- ============================================================
-- BƯỚC 1: Chạy toàn bộ file này trong Supabase SQL Editor
-- Project: duycstnptwojisioeosk.supabase.co
-- ============================================================

-- Bảng JCR Impact Factor
CREATE TABLE IF NOT EXISTS jcr_data (
  id            SERIAL PRIMARY KEY,
  journal_name  TEXT,
  journal_norm  TEXT,   -- tên đã normalize (không dấu, chữ thường) để tìm kiếm
  issn          TEXT,   -- đã làm sạch, không dấu gạch ngang
  eissn         TEXT,
  category      TEXT,
  jcr_2024      TEXT,
  jcr_2025      TEXT,
  jif_quartile  TEXT
);

-- Bảng HDGSNN list (danh mục tính điểm)
CREATE TABLE IF NOT EXISTS hdgsnn_list (
  id            SERIAL PRIMARY KEY,
  ten_tap_chi   TEXT,
  ten_norm      TEXT,   -- tên normalize
  issn          TEXT,
  diem_hdgsnn   TEXT
);

-- Bảng Scopus May 2026
CREATE TABLE IF NOT EXISTS scopus_list (
  id                  SERIAL PRIMARY KEY,
  source_title        TEXT,
  source_title_norm   TEXT,  -- tên normalize
  issn                TEXT,
  eissn               TEXT,
  publisher           TEXT,
  coverage            TEXT,
  source_type         TEXT,
  active_or_inactive  TEXT,
  discontinued        TEXT,
  open_access_status  TEXT
);

-- ============================================================
-- Tắt RLS để script upload dùng publishable key có thể ghi
-- (Dữ liệu này là công khai nên không cần bảo mật row-level)
-- ============================================================
ALTER TABLE jcr_data    DISABLE ROW LEVEL SECURITY;
ALTER TABLE hdgsnn_list DISABLE ROW LEVEL SECURITY;
ALTER TABLE scopus_list DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Index để tăng tốc tìm kiếm
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jcr_issn     ON jcr_data(issn);
CREATE INDEX IF NOT EXISTS idx_jcr_eissn    ON jcr_data(eissn);
CREATE INDEX IF NOT EXISTS idx_jcr_norm     ON jcr_data(journal_norm);

CREATE INDEX IF NOT EXISTS idx_hdgsnn_issn  ON hdgsnn_list(issn);
CREATE INDEX IF NOT EXISTS idx_hdgsnn_norm  ON hdgsnn_list(ten_norm);

CREATE INDEX IF NOT EXISTS idx_scopus_issn  ON scopus_list(issn);
CREATE INDEX IF NOT EXISTS idx_scopus_eissn ON scopus_list(eissn);
CREATE INDEX IF NOT EXISTS idx_scopus_norm  ON scopus_list(source_title_norm);
