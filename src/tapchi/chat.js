import {
  accountState,
  apiFetch,
  hdgsnnData,
  isAdminAccount,
  loadPublicConfig,
  openUserModal,
  publicDb,
  refreshAccount,
  renderAccount
} from './account.js'
import { formatISSN } from './format.js'
    // ========== RULE-BASED CHATBOT (MIỄN PHÍ - KHÔNG CẦN API) ==========
    let chatHistory = [];
    let isChatOpen = false;

    // ---- Dữ liệu 28 ngành từ QĐ 26/HĐGSNN 2025 ----
    // Static chat helper data is loaded from /tapchi/chat-data.js before this script.
    const DMTC_2025 = window.tapchiChatData?.DMTC_2025 || [];
    const QUICK_QUESTIONS = window.tapchiChatData?.QUICK_QUESTIONS || [];

    // Normalize Vietnamese text
    function norm(s) {
      return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    }

export async function toggleChat() {
      // Luôn cho phép đóng ngay, kể cả khi phiên đăng nhập vừa hết hạn.
      if (isChatOpen) {
        isChatOpen = false;
        document.getElementById('ai-chat-panel').classList.remove('open');
        if (typeof gtag === 'function') {
          gtag('event', 'chat_toggle', { status: 'close' });
        }
        return;
      }

      if (!accountState.currentSession) {
        const trialDays = await loadPublicConfig();
        setAuthMode('register');
        openUserModal();
        document.getElementById('authHeading').textContent = 'Dùng thử Chatbox AI miễn phí';
        document.getElementById('authLead').textContent = `Tạo tài khoản để nhận ${trialDays} ngày dùng thử và bắt đầu trò chuyện cùng Trợ lý Tạp chí AI.`;
        setUserMessage(`Đăng ký miễn phí · ${trialDays} ngày dùng thử · Không cần thanh toán trước`, 'success');
        return;
      }
      const account = accountState.currentAccount || await refreshAccount();
      if (!account?.is_vip) {
        openUserModal(true);
        setUserMessage('Tài khoản chưa có VIP hoặc đã hết lượt. Bạn có thể thanh toán 25.000đ để mua thêm lượt AI.');
        return;
      }
      isChatOpen = true;
      document.getElementById('ai-chat-panel').classList.add('open');
      document.getElementById('ai-chat-badge').style.display = 'none';
      if (isChatOpen && chatHistory.length === 0) setTimeout(openSettings, 300);
      if (isChatOpen) setTimeout(() => document.getElementById('ai-chat-input').focus(), 400);

      // Google Analytics Chat Toggle Event
      if (typeof gtag === 'function') {
        gtag('event', 'chat_toggle', {
          status: isChatOpen ? 'open' : 'close'
        });
      }
    }

export function showWelcomeMsg() {
      if (chatHistory.length > 0) return;
      addMessage('ai',
        `Xin chào! 👋 Tôi là <strong>Trợ lý Tạp chí</strong>, chuyên gia giải đáp các câu hỏi liên quan đến tạp chí khoa học trong và ngoài nước.<br><br>` +
        `Tôi hỗ trợ bạn tra cứu:<br>` +
        `• 🇻🇳 Điểm số tạp chí trong danh mục <strong>HĐGSNN 2025</strong><br>` +
        `• 🌍 Chỉ số <strong>JCR Impact Factor, Phân hạng Q</strong><br>` +
        `• 📊 Trạng thái <strong>Scopus, Open Access, Nhà xuất bản</strong><br>` +
        `• 📄 Link đọc trực tiếp PDF của từng ngành<br><br>` +
        `Bạn có thể gõ câu hỏi hoặc nhập ISSN (ví dụ: <em>"Tạp chí khoa học lạc hồng issn 2525-2186"</em> hoặc <em>"Tạp chí Nature"</em>).`, true
      );
      addQuickReplies();
    }

function addQuickReplies() {
      const msgs = document.getElementById('ai-chat-messages');
      const d = document.createElement('div');
      d.id = 'quick-replies-container'; d.className = 'quick-replies';
      d.innerHTML = QUICK_QUESTIONS.map(q =>
        `<button class="quick-btn" data-quick-question="${q.replace(/"/g, '&quot;')}">${q}</button>`
      ).join('');
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }

export function quickSend(text) {
      document.getElementById('quick-replies-container')?.remove();
      document.getElementById('ai-chat-input').value = text;
      sendChatMessage();
    }

export function openSettings() { document.getElementById('ai-settings-modal').classList.add('open'); }
export function closeSettings() { document.getElementById('ai-settings-modal').classList.remove('open'); }

    // ---- Search Supabase database to provide context for AI ----
async function searchLocalDatabase(queryText) {
      const cleanISSN = (issn) => issn ? String(issn).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "";
      const normalizeStr = (str) => {
        if (!str) return "";
        return str.toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .trim();
      };

      const issnMatch = queryText.match(/\b\d{4}-\d{3}[\dX]\b/i) || queryText.match(/\b\d{8}\b/);
      let cleanedQuery = "";
      if (issnMatch) {
        cleanedQuery = cleanISSN(issnMatch[0]);
      }

      let nameQuery = queryText.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
        .replace(/tim|tra cuu|xem|cho toi|biet|ve|thong tin|tap chi|issn|eissn|diem|cua/g, "")
        .trim();

      const normQuery = normalizeStr(nameQuery).replace(/[%,()]/g, '').slice(0, 150);

      try {
        const isIssnSearch = cleanedQuery.length >= 7;
        const [hdgsnnRes, jcrRes, scopusRes] = await Promise.all([
          isIssnSearch
            ? publicDb.from('hdgsnn_list').select('*').eq('issn', cleanedQuery).limit(10)
            : (normQuery.length > 3 ? publicDb.from('hdgsnn_list').select('*').ilike('ten_norm', `%${normQuery}%`).limit(10) : Promise.resolve({ data: [] })),
          isIssnSearch
            ? publicDb.from('jcr_data').select('*').or(`issn.eq.${cleanedQuery},eissn.eq.${cleanedQuery}`).limit(10)
            : (normQuery.length > 3 ? publicDb.from('jcr_data').select('*').ilike('journal_norm', `%${normQuery}%`).limit(10) : Promise.resolve({ data: [] })),
          isIssnSearch
            ? publicDb.from('scopus_list').select('*').or(`issn.eq.${cleanedQuery},eissn.eq.${cleanedQuery}`).limit(10)
            : (normQuery.length > 3 ? publicDb.from('scopus_list').select('*').ilike('source_title_norm', `%${normQuery}%`).limit(10) : Promise.resolve({ data: [] })),
        ]);

        // Map Supabase fields → format cho chatbot Worker
        const hdgsnnMatches = (hdgsnnRes.data || []).map(r => ({
          "Tên Tạp chí": r.ten_tap_chi, "ISSN": formatISSN(r.issn), "Điểm HDDGSNN": r.diem_hdgsnn
        }));
        const jcrMatches = (jcrRes.data || []).map(r => ({
          "journal_name": r.journal_name, "issn": formatISSN(r.issn), "eissn": formatISSN(r.eissn),
          "category": r.category, "2024_JCR": r.jcr_2024, "2025_JCR": r.jcr_2025, "JIF Quartile": r.jif_quartile
        }));
        const scopusMatches = (scopusRes.data || []).map(r => ({
          "Source Title": r.source_title, "ISSN": formatISSN(r.issn), "EISSN": formatISSN(r.eissn),
          "Publisher": r.publisher, "Coverage": r.coverage, "Source Type": r.source_type,
          "Active or Inactive": r.active_or_inactive,
          "Titles Discontinued by Scopus": r.discontinued, "Open Access Status": r.open_access_status
        }));

        // Bổ sung inline hdgsnnData (điểm khung quy định) cho chatbot
        if (typeof hdgsnnData !== "undefined" && hdgsnnData.length > 0) {
          hdgsnnData.filter(row => {
            const name = normalizeStr(row["Tên tạp chí"] || "");
            const issn = cleanISSN(row["Chỉ số ISSN"] || "");
            if (cleanedQuery.length >= 7 && issn === cleanedQuery) return true;
            return normQuery.length > 3 && name.includes(normQuery);
          }).forEach(item => {
            const exists = hdgsnnMatches.some(m => cleanISSN(m["ISSN"]) === cleanISSN(item["Chỉ số ISSN"]));
            if (!exists) hdgsnnMatches.push({
              "Tên Tạp chí": item["Tên tạp chí"], "ISSN": item["Chỉ số ISSN"] || "N/A",
              "Điểm HDDGSNN": item["Khung điểm quy định"] || "N/A"
            });
          });
        }
        return { hdgsnnMatches, jcrMatches, scopusMatches };
      } catch (e) {
        console.warn('searchLocalDatabase error:', e.message);
        return { hdgsnnMatches: [], jcrMatches: [], scopusMatches: [] };
      }
    }

export async function sendChatMessage() {
      const input = document.getElementById('ai-chat-input');
      const userText = input.value.trim();
      if (!userText) return;
      if (userText.length > 2000) {
        input.setCustomValidity('Tin nhắn không được vượt quá 2.000 ký tự.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');

      document.getElementById('quick-replies-container')?.remove();
      addMessage('user', userText, false);

      // Đưa lịch sử trò chuyện theo định dạng OpenAI
      chatHistory.push({ role: 'user', content: userText });
      input.value = '';
      input.style.height = 'auto';

      // Google Analytics Chat Message Sent Event
      if (typeof gtag === 'function') {
        gtag('event', 'chat_message_sent', {
          message_length: userText.length
        });
      }

      const tid = showTyping();
      document.getElementById('ai-send-btn').disabled = true;

      try {
        // Tra cứu dữ liệu cục bộ làm ngữ cảnh hỗ trợ
        const contextData = await searchLocalDatabase(userText);

        // Gọi Cloudflare Worker bằng session mới nhất; apiFetch tự làm mới token
        // và thử lại một lần nếu máy chủ trả về 401.
        const data = await apiFetch('/api/chat', {
          method: "POST",
          body: JSON.stringify({
            messages: chatHistory.slice(-12),
            contextData: contextData
          })
        });

        removeTyping(tid);
        const replyText = data.result || "Không có phản hồi từ Trợ lý AI.";

        if (data.usage && accountState.currentAccount) {
          accountState.currentAccount.usage_today = data.usage.usage_today ?? data.usage.used ?? accountState.currentAccount.usage_today;
          if (typeof data.usage.remaining_credits !== 'undefined') {
            accountState.currentAccount.remaining_credits = data.usage.remaining_credits;
            accountState.currentAccount.subscription = accountState.currentAccount.subscription || {};
            accountState.currentAccount.subscription.ai_credits_remaining = data.usage.remaining_credits;
          }
          if (typeof data.usage.wallet_balance_vnd !== 'undefined') {
            accountState.currentAccount.wallet_balance_vnd = data.usage.wallet_balance_vnd;
            accountState.currentAccount.subscription = accountState.currentAccount.subscription || {};
            accountState.currentAccount.subscription.wallet_balance_vnd = data.usage.wallet_balance_vnd;
          }
          if (typeof data.usage.remaining_credits !== 'undefined' || typeof data.usage.wallet_balance_vnd !== 'undefined') {
            const renewPrice = Number(data.usage.wallet_renew_price_vnd || accountState.currentAccount.subscription?.vip_plans?.price_vnd || 0);
            accountState.currentAccount.is_vip = isAdminAccount() || accountState.currentAccount.is_trial
              || Number(accountState.currentAccount.remaining_credits || 0) > 0
              || Number(accountState.currentAccount.wallet_balance_vnd || 0) >= renewPrice;
          }
          renderAccount(accountState.currentAccount);
        }

        addMessage('ai', replyText, false);
        chatHistory.push({ role: 'assistant', content: replyText });

      } catch (err) {
        if (err.status === 403) accountState.currentAccount = null;
        removeTyping(tid);
        const message = err.data?.error === 'vip_required'
          ? 'Tài khoản chưa có VIP hoặc đã hết lượt.'
          : err.data?.error === 'credits_exhausted'
            ? 'Bạn đã dùng hết lượt VIP và số dư không đủ để tự gia hạn gói. Vui lòng mua thêm lượt hoặc nạp số dư.'
            : err.data?.error === 'daily_limit'
            ? 'Bạn đã dùng hết lượt AI hôm nay.'
            : err.status === 401
              ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
              : err.message;
        addMessage('ai', `⚠️ Đã xảy ra lỗi: ${message}. Vui lòng thử lại sau.`, false);
      } finally {
        document.getElementById('ai-send-btn').disabled = false;
      }
    }

function addMessage(role, text, isHTML) {
      const msgs = document.getElementById('ai-chat-messages');
      const div = document.createElement('div');
      div.className = `chat-msg ${role}`;
      const avatar = role === 'ai'
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.906 1.408 5.506 3.623 7.237L4.5 22l4.388-1.49C10.1 21.155 11.033 21.486 12 21.486c5.523 0 10-4.145 10-9.243S17.523 2 12 2Z" fill="white"/><circle cx="8" cy="11" r="1.2" fill="#10a37f"/><circle cx="12" cy="11" r="1.2" fill="#10a37f"/><circle cx="16" cy="11" r="1.2" fill="#10a37f"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="white"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;

      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const msgContent = isHTML ? text : formatMessage(text);
      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      div.innerHTML = `
        <div class="msg-avatar">${avatar}</div>
        <div class="msg-wrap">
          <div class="msg-bubble" id="${msgId}">${msgContent}</div>
          <div class="msg-meta">
            <span class="msg-time">${timeStr}</span>
            ${role === 'ai' ? `<button class="msg-copy" data-copy-msg="${msgId}" title="Sao chép"><i class="fas fa-copy"></i></button>` : ''}
          </div>
        </div>`;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

export function copyMsg(id, btn) {
      const el = document.getElementById(id);
      const text = el ? el.innerText : '';
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; btn.classList.remove('copied'); }, 1800);
      }).catch(() => { });
    }

export function confirmClearHistory() {
      document.getElementById('clear-confirm-box')?.remove();
      const box = document.createElement('div');
      box.className = 'clear-confirm';
      box.id = 'clear-confirm-box';
      box.innerHTML = `
        <span>🗑️ Xóa toàn bộ lịch sử chat?</span>
        <div style="display:flex;gap:8px;">
          <button class="clear-yes" data-action="clear-chat-history">Xóa</button>
          <button class="clear-no" data-action="cancel-clear-chat-history">Hủy</button>
        </div>`;
      document.getElementById('ai-chat-panel').appendChild(box);
    }

export function clearHistory() {
      document.getElementById('clear-confirm-box')?.remove();
      document.getElementById('ai-chat-messages').innerHTML = '';
      chatHistory = [];
      showWelcomeMsg();
    }

    function formatMessage(text) {
      // Escape HTML
      let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Bold **text**
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Italic *text*
      html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
      // Inline code `code`
      html = html.replace(/`(.+?)`/g, '<code style="background:rgba(128,128,128,0.2);padding:2px 4px;border-radius:4px;font-family:monospace;">$1</code>');

      // Convert list items: start of line with "- " or "* " or "• "
      html = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
          return `<li style="margin-left: 20px; list-style-type: disc;">${trimmed.substring(2)}</li>`;
        }
        return line;
      }).join('\n');

      // Replace newlines with <br>
      html = html.replace(/\n/g, '<br>');

      return html;
    }

    function showTyping() {
      const msgs = document.getElementById('ai-chat-messages');
      const id = 'typing_' + Date.now();
      const d = document.createElement('div');
      d.className = 'chat-msg ai'; d.id = id;
      d.innerHTML = `<div class="msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.906 1.408 5.506 3.623 7.237L4.5 22l4.388-1.49C10.1 21.155 11.033 21.486 12 21.486c5.523 0 10-4.145 10-9.243S17.523 2 12 2Z" fill="white"/><circle cx="8" cy="11" r="1.2" fill="#10a37f"/><circle cx="12" cy="11" r="1.2" fill="#10a37f"/><circle cx="16" cy="11" r="1.2" fill="#10a37f"/></svg></div><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
      msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
      return id;
    }

    function removeTyping(id) { document.getElementById(id)?.remove(); }

export function handleChatKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    }

export function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    setTimeout(() => {
      if (!isChatOpen) document.getElementById('ai-chat-badge').style.display = 'flex';
    }, 3000);
export function initChatEvents() {
  document.addEventListener('click', event => {
    const quickButton = event.target.closest('[data-quick-question]')
    if (quickButton) {
      quickSend(quickButton.dataset.quickQuestion || '')
      return
    }

    const copyButton = event.target.closest('[data-copy-msg]')
    if (copyButton) {
      copyMsg(copyButton.dataset.copyMsg, copyButton)
      return
    }

    const clearAction = event.target.closest('[data-action="clear-chat-history"], [data-action="cancel-clear-chat-history"]')
    if (clearAction?.dataset.action === 'clear-chat-history') clearHistory()
    if (clearAction?.dataset.action === 'cancel-clear-chat-history') document.getElementById('clear-confirm-box')?.remove()
  })

  document.getElementById('ai-chat-btn')?.addEventListener('click', toggleChat)
  document.getElementById('ai-chat-close')?.addEventListener('click', toggleChat)
  document.getElementById('ai-send-btn')?.addEventListener('click', sendChatMessage)
  document.getElementById('ai-chat-input')?.addEventListener('keydown', handleChatKey)
  document.getElementById('ai-chat-input')?.addEventListener('input', event => autoResize(event.currentTarget))
  document.getElementById('ai-settings-start')?.addEventListener('click', () => { closeSettings(); showWelcomeMsg() })
  document.getElementById('ai-clear-history')?.addEventListener('click', confirmClearHistory)
  document.getElementById('ai-open-settings')?.addEventListener('click', openSettings)
}
