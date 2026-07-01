// admin.js
// Logic chính cho /admin.html — auth guard + tab handling + data loading

import { db, getSession, getIsAdmin } from './assets/supabase-client.js';
import { renderLineChart } from './admin-chart.js';

// ============================================================
// Init: auth guard + admin check
// ============================================================
async function init() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/?login=1';
    return;
  }

  const isAdmin = await getIsAdmin();
  if (!isAdmin) {
    document.getElementById('forbiddenPage').style.display = 'block';
    return;
  }

  document.getElementById('adminMain').style.display = 'block';
  setupTabs();
  await loadDashboard();
}

// ============================================================
// Tabs
// ============================================================
function setupTabs() {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');

      // Lazy load
      if (tabName === 'users' && !usersLoaded) loadUsers();
      if (tabName === 'settings' && !settingsLoaded) loadSettings();
    });
  });
}

// ============================================================
// Dashboard
// ============================================================
let chartState = { granularity: 'day', periods: 30, showRevenue: true, showPageViews: true };

async function loadDashboard() {
  try {
    const { data: stats, error } = await db.rpc('admin_get_dashboard_stats');
    if (error) throw error;

    document.getElementById('stat-revenue-today').textContent = formatVnd(stats.revenue_today);
    document.getElementById('stat-revenue-month').textContent = formatVnd(stats.revenue_month);
    document.getElementById('stat-revenue-total').textContent = formatVnd(stats.revenue_total);
    document.getElementById('stat-vip-active').textContent = stats.vip_active_count.toLocaleString('vi-VN');
    document.getElementById('stat-users-total').textContent = stats.users_total.toLocaleString('vi-VN');
    document.getElementById('stat-pv-today').textContent = stats.page_views_today.toLocaleString('vi-VN');

    setupChartControls();
    await reloadChart();
    await loadRecentPayments();
  } catch (err) {
    console.error('loadDashboard error:', err);
    alert('Lỗi tải dashboard: ' + (err.message || err));
  }
}

function setupChartControls() {
  // Filter buttons
  document.querySelectorAll('.chart-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartState.granularity = btn.dataset.granularity;
      chartState.periods = parseInt(btn.dataset.periods);
      await reloadChart();
    });
  });
  // Metric toggles
  document.getElementById('toggleRevenue').addEventListener('change', async (e) => {
    chartState.showRevenue = e.target.checked;
    await reloadChart();
  });
  document.getElementById('togglePageViews').addEventListener('change', async (e) => {
    chartState.showPageViews = e.target.checked;
    await reloadChart();
  });
}

async function reloadChart() {
  const loading = document.getElementById('chartLoading');
  const svg = document.getElementById('chartSvg');
  const empty = document.getElementById('chartEmpty');
  loading.style.display = 'block';
  svg.style.display = 'none';
  empty.style.display = 'none';

  try {
    const promises = [];
    if (chartState.showRevenue) {
      promises.push(db.rpc('admin_get_timeseries', {
        p_metric: 'revenue', p_granularity: chartState.granularity, p_periods: chartState.periods
      }));
    } else {
      promises.push(Promise.resolve({ data: [] }));
    }
    if (chartState.showPageViews) {
      promises.push(db.rpc('admin_get_timeseries', {
        p_metric: 'page_views', p_granularity: chartState.granularity, p_periods: chartState.periods
      }));
    } else {
      promises.push(Promise.resolve({ data: [] }));
    }

    const [revRes, pvRes] = await Promise.all(promises);
    if (revRes.error) throw revRes.error;
    if (pvRes.error) throw pvRes.error;

    const hasData = renderLineChart(svg, revRes.data || [], pvRes.data || [], {
      showRevenue: chartState.showRevenue,
      showPageViews: chartState.showPageViews
    });

    loading.style.display = 'none';
    if (!hasData) {
      empty.style.display = 'block';
    }
  } catch (err) {
    console.error('reloadChart error:', err);
    loading.innerHTML = '<span style="color:var(--error-color)">Lỗi tải biểu đồ: ' + (err.message || err) + '</span>';
  }
}

// ============================================================
// Recent payments
// ============================================================
async function loadRecentPayments() {
  try {
    // Get recent payments (admin RLS policy allows)
    const { data: payments, error: payErr } = await db.from('payments')
      .select('created_at, amount_vnd, status, user_id')
      .order('created_at', { ascending: false })
      .limit(10);
    if (payErr) throw payErr;

    if (payments.length === 0) {
      document.getElementById('recentPaymentsBody').innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Chưa có giao dịch.</td></tr>';
      return;
    }

    // Get emails for these user IDs
    const userIds = [...new Set(payments.map(p => p.user_id))];
    const { data: users, error: userErr } = await db.rpc('admin_list_users', {
      p_limit: 1000, p_offset: 0
    });
    if (userErr) throw userErr;
    const emailMap = new Map(users.map(u => [u.user_id, u.email]));

    document.getElementById('recentPaymentsBody').innerHTML = payments.map(p => {
      const email = emailMap.get(p.user_id) || '(unknown)';
      return `<tr>
        <td>${new Date(p.created_at).toLocaleString('vi-VN')}</td>
        <td>${escapeHtml(email)}</td>
        <td>${formatVnd(p.amount_vnd)}</td>
        <td><span class="status-badge status-${p.status}">${paymentStatusLabel(p.status)}</span></td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('loadRecentPayments error:', err);
    document.getElementById('recentPaymentsBody').innerHTML =
      `<tr><td colspan="4" style="text-align:center;color:var(--error-color);padding:24px;">Lỗi tải giao dịch.</td></tr>`;
  }
}

// ============================================================
// Users tab
// ============================================================
const USERS_PAGE_SIZE = 20;
let currentUsersPage = 0;
let currentSearchTerm = '';
let usersLoaded = false;
let searchDebounce;

async function loadUsers(page = 0, search = currentSearchTerm) {
  currentUsersPage = page;
  currentSearchTerm = search;
  try {
    const [{ data: users, error: uErr }, { data: total, error: cErr }] = await Promise.all([
      db.rpc('admin_list_users', {
        p_limit: USERS_PAGE_SIZE,
        p_offset: page * USERS_PAGE_SIZE,
        p_search: search || null
      }),
      db.rpc('admin_count_users', { p_search: search || null })
    ]);
    if (uErr) throw uErr;
    if (cErr) throw cErr;

    usersLoaded = true;

    if (users.length === 0) {
      document.getElementById('usersTableBody').innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Không có user nào.</td></tr>';
      document.getElementById('usersPagination').innerHTML = '';
      return;
    }

    document.getElementById('usersTableBody').innerHTML = users.map(u => `
      <tr onclick="window.openUserDetail('${u.user_id}', '${escapeHtml(u.email).replace(/'/g, "\\'")}')">
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.display_name || '—')}</td>
        <td><span class="status-badge status-${u.vip_status === 'active' ? 'active' : 'inactive'}">${u.vip_status === 'active' ? '✓ Active' : u.vip_status || 'Chưa có'}</span></td>
        <td>${u.vip_expires_at ? new Date(u.vip_expires_at).toLocaleDateString('vi-VN') : '—'}</td>
        <td>${formatVnd(u.total_spent_vnd)}</td>
        <td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
      </tr>
    `).join('');

    const totalPages = Math.ceil(total / USERS_PAGE_SIZE);
    document.getElementById('usersPagination').innerHTML = `
      <button onclick="window.loadUsers(${page - 1})" ${page === 0 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Trước</button>
      <span>Trang ${page + 1} / ${totalPages || 1}</span>
      <button onclick="window.loadUsers(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>Sau <i class="fas fa-chevron-right"></i></button>
    `;
  } catch (err) {
    console.error('loadUsers error:', err);
    document.getElementById('usersTableBody').innerHTML =
      `<tr><td colspan="6" style="text-align:center;color:var(--error-color);padding:24px;">Lỗi tải users: ${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}
window.loadUsers = loadUsers;

// Search input with debounce
document.getElementById('usersSearch').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadUsers(0, e.target.value), 300);
});

// ============================================================
// User detail modal
// ============================================================
window.openUserDetail = async function (userId, email) {
  document.getElementById('userDetailTitle').textContent = email;
  document.getElementById('userDetailBody').innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Đang tải...';
  document.getElementById('userDetailModal').classList.add('open');
  try {
    const { data: payments, error } = await db.rpc('admin_get_user_payments', { p_user_id: userId });
    if (error) throw error;

    if (payments.length === 0) {
      document.getElementById('userDetailBody').innerHTML = '<p style="text-align:center;color:var(--text-muted);">User này chưa có giao dịch nào.</p>';
      return;
    }

    const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount_vnd, 0);
    document.getElementById('userDetailBody').innerHTML = `
      <p><strong>Tổng đã thanh toán:</strong> ${formatVnd(totalPaid)} (${payments.filter(p => p.status === 'paid').length} giao dịch thành công)</p>
      <table class="admin-table" style="margin-top:12px;">
        <thead><tr><th>Ngày</th><th>Mã GD</th><th>Số tiền</th><th>Trạng thái</th><th>Paid at</th></tr></thead>
        <tbody>
          ${payments.map(p => `
            <tr>
              <td>${new Date(p.created_at).toLocaleString('vi-VN')}</td>
              <td><code>${escapeHtml(p.payment_code)}</code></td>
              <td>${p.amount_vnd.toLocaleString('vi-VN')}đ</td>
              <td><span class="status-badge status-${p.status}">${paymentStatusLabel(p.status)}</span></td>
              <td>${p.paid_at ? new Date(p.paid_at).toLocaleString('vi-VN') : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('userDetailBody').innerHTML = `<p style="color:var(--error-color);">Lỗi: ${escapeHtml(err.message || String(err))}</p>`;
  }
};

window.closeUserDetail = function () {
  document.getElementById('userDetailModal').classList.remove('open');
};

// ============================================================
// Settings tab
// ============================================================
let settingsLoaded = false;

async function loadSettings() {
  try {
    const { data: plan, error } = await db.from('vip_plans')
      .select('*')
      .eq('id', 'chatbox_ai')
      .single();
    if (error) throw error;

    document.getElementById('settingPrice').value = plan.price_vnd;
    document.getElementById('settingDuration').value = plan.duration_days;
    document.getElementById('settingDailyLimit').value = plan.daily_ai_limit;
    document.getElementById('settingPrefix').value = plan.payment_prefix;
    document.getElementById('settingActive').checked = plan.active;

    settingsLoaded = true;
  } catch (err) {
    console.error('loadSettings error:', err);
    showSettingsMessage('Lỗi tải cài đặt: ' + (err.message || err), 'error');
  }
}

document.getElementById('vipSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const { data, error } = await db.rpc('admin_update_vip_plan', {
      p_plan_id: 'chatbox_ai',
      p_price_vnd: parseInt(f.price.value, 10),
      p_duration_days: parseInt(f.duration.value, 10),
      p_daily_ai_limit: parseInt(f.dailyLimit.value, 10),
      p_payment_prefix: f.prefix.value.toUpperCase(),
      p_active: f.active.checked
    });
    if (error) throw error;
    showSettingsMessage('Đã lưu cài đặt thành công!', 'success');
  } catch (err) {
    showSettingsMessage('Lỗi: ' + (err.message || err), 'error');
  }
});

function showSettingsMessage(text, type) {
  const el = document.getElementById('settingsMessage');
  el.textContent = text;
  el.className = 'form-message ' + type;
}

// ============================================================
// Helpers
// ============================================================
function formatVnd(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('vi-VN') + 'đ';
}

function paymentStatusLabel(status) {
  return {
    paid: 'Đã thanh toán',
    pending: 'Đang chờ',
    expired: 'Hết hạn',
    cancelled: 'Đã huỷ'
  }[status] || status;
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
