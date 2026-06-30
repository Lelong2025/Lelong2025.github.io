// upload-to-supabase.mjs
// Chạy: node upload-to-supabase.mjs
// Yêu cầu: node >= 18, đã cài @supabase/supabase-js, xlsx, dotenv

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// CẤU HÌNH SUPABASE — đọc từ file .env
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong file .env!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: ws }
});

const BATCH_SIZE = 1500; // số dòng mỗi lần insert

// ============================================================
// HÀM TIỆN ÍCH
// ============================================================

/** Xoá dấu gạch ngang và ký tự không phải alphanumeric khỏi ISSN */
function cleanISSN(issn) {
  if (!issn) return null;
  const cleaned = String(issn).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned || null;
}

/** Normalize tên: bỏ dấu tiếng Việt, chữ thường */
function normalizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/** Upload 1 batch vào Supabase */
async function insertBatch(table, rows) {
  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`  ❌ Lỗi insert vào ${table}:`, error.message);
    throw error;
  }
}

/** Đọc file Excel và trả về mảng JSON */
function readExcel(filename, sheetName = null) {
  const filePath = join(__dirname, filename);
  console.log(`\n📂 Đang đọc: ${filename} ...`);
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = sheetName
    ? (workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]])
    : workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`   ✅ Đọc xong: ${data.length.toLocaleString()} dòng`);
  return data;
}

/** Upload toàn bộ dữ liệu vào một bảng theo batch */
async function uploadTable(table, rows) {
  const total = rows.length;
  console.log(`\n🚀 Bắt đầu upload ${total.toLocaleString()} dòng → bảng "${table}" ...`);

  let uploaded = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await insertBatch(table, batch);
    uploaded += batch.length;
    const pct = Math.round((uploaded / total) * 100);
    process.stdout.write(`\r   ⏳ ${uploaded.toLocaleString()}/${total.toLocaleString()} dòng (${pct}%)`);
  }
  console.log(`\n   ✅ Upload "${table}" hoàn tất!\n`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('='.repeat(60));
  console.log('  UPLOAD DỮ LIỆU TẠP CHÍ → SUPABASE');
  console.log('='.repeat(60));
  console.log(`  URL: ${SUPABASE_URL}`);

  // ─── 1. XOÁ DỮ LIỆU CŨ (tránh trùng lặp khi chạy lại) ──
  console.log('\n🗑️  Đang xoá dữ liệu cũ...');
  await supabase.from('jcr_data').delete().neq('id', 0);
  await supabase.from('hdgsnn_list').delete().neq('id', 0);
  await supabase.from('scopus_list').delete().neq('id', 0);
  console.log('   ✅ Đã xoá xong.');

  // ─── 2. JCR IMPACT FACTOR ────────────────────────────────
  let jcrCount = 0;
  try {
    const jcrRaw = readExcel('2019-2023JCRImpactFactor.xlsx');
    const jcrRows = jcrRaw.map(row => ({
      journal_name:  String(row['journal_name'] || '').trim() || null,
      journal_norm:  normalizeName(row['journal_name']),
      issn:          cleanISSN(row['issn']),
      eissn:         cleanISSN(row['eissn']),
      category:      String(row['category'] || '').trim() || null,
      jcr_2024:      row['2024_JCR'] != null ? String(row['2024_JCR']) : null,
      jcr_2025:      row['2025_JCR'] != null ? String(row['2025_JCR']) : null,
      jif_quartile:  String(row['JIF Quartile'] || '').trim() || null,
    })).filter(r => r.journal_name || r.issn);

    await uploadTable('jcr_data', jcrRows);
    jcrCount = jcrRows.length;
  } catch (err) {
    console.warn('\n⚠️  Bỏ qua JCR Impact Factor vì không tìm thấy file hoặc lỗi:', err.message);
  }

  // ─── 3. HDGSNN LIST ──────────────────────────────────────
  let hdgsnnCount = 0;
  try {
    const hdgsnnRaw = readExcel('danh sách tạp chí HDGSNN.xlsx');
    const hdgsnnRows = hdgsnnRaw.map(row => ({
      ten_tap_chi:  String(row['Tên Tạp chí'] || '').trim() || null,
      ten_norm:     normalizeName(row['Tên Tạp chí']),
      issn:         cleanISSN(row['ISSN']),
      diem_hdgsnn:  row['Điểm HDDGSNN'] != null ? String(row['Điểm HDDGSNN']) : null,
    })).filter(r => r.ten_tap_chi || r.issn);

    await uploadTable('hdgsnn_list', hdgsnnRows);
    hdgsnnCount = hdgsnnRows.length;
  } catch (err) {
    console.warn('\n⚠️  Bỏ qua HDGSNN list vì không tìm thấy file hoặc lỗi:', err.message);
  }

  // ─── 4. SCOPUS MAY 2026 (file lớn 22.8MB) ────────────────
  let scopusCount = 0;
  try {
    console.log('\n⚠️  Scopus 22.8MB — quá trình có thể mất 2-5 phút, vui lòng đợi...');
    const scopusRaw = readExcel('ext_list_May_2026.xlsx', 'Scopus Sources May 2026');
    const scopusRows = scopusRaw.map(row => ({
      source_title:       String(row['Source Title'] || '').trim() || null,
      source_title_norm:  normalizeName(row['Source Title']),
      issn:               cleanISSN(row['ISSN']),
      eissn:              cleanISSN(row['EISSN']),
      publisher:          String(row['Publisher'] || '').trim() || null,
      coverage:           String(row['Coverage'] || '').trim() || null,
      source_type:        String(row['Source Type'] || '').trim() || null,
      active_or_inactive: String(row['Active or Inactive'] || '').trim() || null,
      discontinued:       String(row['Titles Discontinued by Scopus'] || '').trim() || null,
      open_access_status: String(row['Open Access Status'] || '').trim() || null,
    })).filter(r => r.source_title || r.issn);

    await uploadTable('scopus_list', scopusRows);
    scopusCount = scopusRows.length;
  } catch (err) {
    console.warn('\n⚠️  Bỏ qua Scopus list vì không tìm thấy file hoặc lỗi:', err.message);
  }

  // ─── TỔNG KẾT ─────────────────────────────────────────────
  console.log('='.repeat(60));
  console.log('  🎉 UPLOAD HOÀN TẤT!');
  console.log(`  JCR:    ${jcrCount.toLocaleString()} dòng`);
  console.log(`  HDGSNN: ${hdgsnnCount.toLocaleString()} dòng`);
  console.log(`  Scopus: ${scopusCount.toLocaleString()} dòng`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('\n❌ Lỗi nghiêm trọng:', err.message);
  process.exit(1);
});
