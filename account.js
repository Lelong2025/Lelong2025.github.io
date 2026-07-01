// account.js
// Logic chính cho /account.html — auth guard + render info + handle actions

import { db, getSession } from './assets/supabase-client.js';
import { getMyAccountInfo } from './account-api.js';

// ============================================================
// Auth guard
// ============================================================
async function init() {
  const session = await getSession();
  if (!session) {
    // Redirect về trang chủ với flag mở login modal
    window.location.href = '/?login=1';
    return;
  }
  // Render UI
  document.getElementById('loadingState').style.display = 'none';
  ['profileCard', 'vipCard', 'historyCard', 'securityCard'].forEach(id => {
    document.getElementById(id).style.display = 'block';
  });
  await loadAccount();
  loadPayments(0);
}

// ============================================================
// Load account info
// ============================================================
async function loadAccount() {
  try {
    const session = await getSession();
    const info = await getMyAccountInfo();

    document.getElementById('accountEmail').textContent = session.user.email;
    document.getElementById('displayNameInput').value = info.profile?.display_name || '';

    renderVipStatus(info);
  } catch (err) {
    console.error('loadAccount error:', err);
    showMessage('displayNameMessage', 'Lỗi tải thông tin: ' + (err.message || err), 'error');
  }
}

function renderVipStatus(info) {
  const sub = info.subscription;
  const statusEl = document.getElementById('vipStatusText');
  const expiryEl = document.getElementById('vipExpiryText');
  const usageTextEl = document.getElementById('usageText');
  const usageFillEl = document.getElementById('usageBarFill');

  if (!sub || sub.status !== 'active' || new Date(sub.expires_at) <= new Date()) {
    statusEl.textContent = sub?.status === 'suspended' ? 'Tạm khoá' : 'Chưa kích hoạt';
    statusEl.className = 'vip-inactive';
    expiryEl.textContent = '—';
  } else {
    statusEl.textContent = 'Đang kích hoạt';
    statusEl.className = 'vip-active';
    const exp = new Date(sub.expires_at);
    const daysLeft = Math.ceil((exp - new Date()) / 86400000);
    expiryEl.textContent = exp.toLocaleDateString('vi-VN') + ` (còn ${daysLeft} ngày)`;
  }

  const used = info.used_today || 0;
  const limit = info.daily_limit || 30;
  usageTextEl.textContent = `${used}/${limit}`;
  const pct = Math.min(100, (used / limit) * 100);
  usageFillEl.style.width = pct + '%';
  usageFillEl.classList.remove('warning', 'danger');
  if (pct >= 90) usageFillEl.classList.add('danger');
  else if (pct >= 70) usageFillEl.classList.add('warning');
}

// ============================================================
// Payment history
// ============================================================
const PAYMENT_PAGE_SIZE = 10;
let currentPaymentPage = 0;
let lastPaymentPageHadData = true;

async function loadPayments(page = 0) {
  try {
    const session = await getSession();
    currentPaymentPage = page;
    const { data, error } = await db.from('payments')
      .select('id, created_at, amount_vnd, payment_code, status')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .range(page * PAYMENT_PAGE_SIZE, (page + 1) * PAYMENT_PAGE_SIZE - 1);
    if (error) throw error;
    renderPaymentRows(data);
    lastPaymentPageHadData = data.length === PAYMENT_PAGE_SIZE;
    renderPaymentPagination(page);
  } catch (err) {
    console.error('loadPayments error:', err);
    document.getElementById('paymentHistoryBody').innerHTML =
      `<tr><td colspan="4" style="text-align:center;color:var(--error-color);padding:24px;">Lỗi tải lịch sử giao dịch.</td></tr>`;
  }
}
window.loadPayments = loadPayments;

function renderPaymentRows(rows) {
  const tbody = document.getElementById('paymentHistoryBody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Chưa có giao dịch nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${new Date(r.created_at).toLocaleString('vi-VN')}</td>
      <td>${r.amount_vnd.toLocaleString('vi-VN')}đ</td>
      <td><code>${escapeHtml(r.payment_code)}</code></td>
      <td><span class="status-badge status-${r.status}">${paymentStatusLabel(r.status)}</span></td>
    </tr>
  `).join('');
}

function paymentStatusLabel(status) {
  return {
    paid: 'Đã thanh toán',
    pending: 'Đang chờ',
    expired: 'Hết hạn',
    cancelled: 'Đã huỷ'
  }[status] || status;
}

function renderPaymentPagination(page) {
  document.getElementById('paymentPagination').innerHTML = `
    <button onclick="loadPayments(${page - 1})" ${page === 0 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Trước</button>
    <span>Trang ${page + 1}</span>
    <button onclick="loadPayments(${page + 1})" ${!lastPaymentPageHadData ? 'disabled' : ''}>Sau <i class="fas fa-chevron-right"></i></button>
  `;
}

// ============================================================
// Edit display name
// ============================================================
document.getElementById('displayNameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newName = document.getElementById('displayNameInput').value.trim();
  try {
    const session = await getSession();
    const { error } = await db.from('profiles')
      .update({ display_name: newName || null })
      .eq('user_id', session.user.id);
    if (error) throw error;
    showMessage('displayNameMessage', 'Đã lưu tên hiển thị.', 'success');
  } catch (err) {
    showMessage('displayNameMessage', 'Lỗi: ' + (err.message || err), 'error');
  }
});

// ============================================================
// Change password
// ============================================================
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPw = document.getElementById('currentPw').value;
  const newPw = document.getElementById('newPw').value;
  const confirmPw = document.getElementById('confirmPw').value;
  const msgEl = document.getElementById('changePwMessage');

  if (newPw !== confirmPw) {
    showMessage('changePwMessage', 'Mật khẩu mới không khớp.', 'error');
    return;
  }
  if (newPw.length < 8) {
    showMessage('changePwMessage', 'Mật khẩu mới phải có ít nhất 8 ký tự.', 'error');
    return;
  }

  try {
    const session = await getSession();
    // Verify current password bằng cách sign in lại
    const { error: signInErr } = await db.auth.signInWithPassword({
      email: session.user.email,
      password: currentPw
    });
    if (signInErr) {
      showMessage('changePwMessage', 'Mật khẩu hiện tại không đúng.', 'error');
      return;
    }

    // Update password
    const { error: updateErr } = await db.auth.updateUser({ password: newPw });
    if (updateErr) throw updateErr;

    showMessage('changePwMessage', 'Đổi mật khẩu thành công!', 'success');
    e.target.reset();
  } catch (err) {
    showMessage('changePwMessage', 'Lỗi: ' + (err.message || err), 'error');
  }
});

// ============================================================
// Change email
// ============================================================
document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newEmail = document.getElementById('newEmail').value;
  try {
    const { error } = await db.auth.updateUser({ email: newEmail });
    if (error) throw error;
    showMessage('changeEmailMessage', 'Đã gửi email xác nhận. Kiểm tra cả hộp thư email cũ và mới.', 'success');
    e.target.reset();
  } catch (err) {
    showMessage('changeEmailMessage', 'Lỗi: ' + (err.message || err), 'error');
  }
});

// ============================================================
// Buy VIP (link to home page where modal handles it)
// ============================================================
window.handleBuyVip = function (e) {
  e.preventDefault();
  // Redirect về index.html với flag mở payment modal
  window.location.href = '/?buyVip=1';
};

// ============================================================
// Helpers
// ============================================================
function showMessage(elementId, text, type) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.className = 'form-message ' + type;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Boot
// ============================================================
init();
