import { initAuth, loadPublicConfig, publicDb } from './account.js'
import { escapeHTML, formatISSN } from './format.js'
import {
  getIframeLookupSources,
  loadLookupSources,
  renderLookupExternalLinks,
  renderLookupIntegrations,
  syncRenderedLookupFrames,
  updateLookupUrls
} from './lookup-sources.js'
function updateLoadingStatus(msg, success = false, error = false) {
      // Cập nhật trạng thái trên splash screen
      const splashStatus = document.getElementById("splashStatus");
      if (success) {
        if (splashStatus) { splashStatus.style.color = '#10b981'; }
      } else if (error) {
        if (splashStatus) { splashStatus.style.color = '#ef4444'; }
      } else {
        if (splashStatus) { splashStatus.style.color = ''; }
      }
      if (splashStatus) splashStatus.textContent = msg;
    }

function setSplashStep(stepId, state) {
      // state: 'active' | 'done' | 'error'
      const el = document.getElementById(stepId);
      if (!el) return;
      el.classList.remove('active', 'done', 'error');
      el.classList.add(state);
      if (state === 'done') {
        el.querySelector('.step-icon').innerHTML = '<i class="fas fa-check"></i>';
      } else if (state === 'active') {
        el.querySelector('.step-icon').innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
      } else if (state === 'error') {
        el.querySelector('.step-icon').innerHTML = '<i class="fas fa-exclamation"></i>';
      }
    }

function setSplashProgress(pct) {
      const fill = document.getElementById('splashProgressFill');
      const percent = document.getElementById('splashProgressPercent');
      const safePct = Math.max(0, Math.min(100, Math.round(pct)));
      if (fill) {
        fill.style.width = safePct + '%';
        fill.setAttribute('aria-valuenow', safePct);
      }
      if (percent) percent.textContent = safePct + '%';
    }

function hideSplash() {
      const splash = document.getElementById('loading-splash');
      if (splash) {
        splash.classList.add('hidden');
        // Xóa khỏi DOM sau khi transition kết thúc
        setTimeout(() => splash.remove(), 700);
      }
    }

export function updateIframeSources() {
      const iframeSources = getIframeLookupSources();
      syncRenderedLookupFrames();
      if (!iframeSources.length) {
        document.getElementById('iframeInlineSection').style.display = 'none';
        document.getElementById('iframeLinksSection').style.display = 'none';
        return;
      }
      if (window.innerWidth >= 1024) {
        document.getElementById('iframeInlineSection').style.display = 'block';
        document.getElementById('iframeLinksSection').style.display = 'none';
      } else {
        document.getElementById('iframeInlineSection').style.display = 'none';
        document.getElementById('iframeLinksSection').style.display = 'block';
      }
    }

window.addEventListener('resize', () => {
      if (!document.getElementById("iframeModal").classList.contains("open")) {
        updateIframeSources();
      }
    });

export async function initApp() {
      const totalTasks = 5;
      let completedTasks = 0;
      const finishTask = (message) => {
        completedTasks += 1;
        setSplashProgress((completedTasks / totalTasks) * 100);
        updateLoadingStatus(message);
      };

      setSplashProgress(0);
      updateLoadingStatus('Đang khôi phục phiên đăng nhập...');
      try {
        await initAuth();
      } catch (error) {
        updateLoadingStatus('Không thể khôi phục phiên, tiếp tục ở chế độ khách.', false, true);
      } finally {
        finishTask('Đang tải cấu hình hệ thống...');
      }

      await loadPublicConfig();
      finishTask('Đang kiểm tra các nguồn dữ liệu...');

      await loadLookupSources();
      renderLookupIntegrations();
      updateLookupUrls('');
      renderLookupExternalLinks();

      setSplashStep('step-jcr', 'active');
      setSplashStep('step-hdgsnn', 'active');
      setSplashStep('step-scopus', 'active');

      const dataTasks = [
        { table: 'jcr_data', step: 'step-jcr', label: 'JCR Impact Factor' },
        { table: 'hdgsnn_list', step: 'step-hdgsnn', label: 'HĐGSNN 2025' },
        { table: 'scopus_list', step: 'step-scopus', label: 'Scopus' }
      ];
      const results = await Promise.allSettled(dataTasks.map(async task => {
        try {
          const { error } = await publicDb.from(task.table).select('id').limit(1);
          if (error) throw error;
          setSplashStep(task.step, 'done');
        } catch (error) {
          setSplashStep(task.step, 'error');
          throw error;
        } finally {
          finishTask(`Đã xử lý ${task.label} (${completedTasks + 1}/${totalTasks} tác vụ)`);
        }
      }));

      const failedCount = results.filter(result => result.status === 'rejected').length;
      if (failedCount) {
        updateLoadingStatus(`Đã tải xong với ${failedCount} nguồn dữ liệu chưa kết nối được.`, false, true);
      } else {
        updateLoadingStatus('Hoàn tất! JCR · HĐGSNN · Scopus đã sẵn sàng.', true);
      }

      // Hoàn thành — tắt Splash Screen
      setSplashProgress(100);
      await new Promise(resolve => setTimeout(resolve, 400));
      hideSplash();

      updateIframeSources();


      // Hỗ trợ tự động tìm kiếm từ tham số URL (?q=...)
      const urlParams = new URLSearchParams(window.location.search);
      const queryParam = urlParams.get('q') || urlParams.get('query');
      if (queryParam) {
        const inputEl = document.getElementById("searchInput");
        if (inputEl) {
          inputEl.value = queryParam;
          search();
        }
      }

    }

export function cleanISSN(issn) {
      if (!issn) return "";
      return String(issn).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    }

export function normalizeStr(str) {
      if (!str) return "";
      return str.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .trim();
    }

export async function search() {
      const input = document.getElementById("searchInput");
      const query = input.value.trim();
      if (!query) return;
      if (query.length > 150) {
        input.setCustomValidity('Từ khóa không được vượt quá 150 ký tự.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');

      const normQuery = normalizeStr(query).replace(/[%,()]/g, '');
      const cleanedQuery = cleanISSN(query);
      const isIssnSearch = cleanedQuery.length >= 7;

      const excelInfoDiv = document.getElementById("excelInfo");
      excelInfoDiv.style.display = "block";
      excelInfoDiv.innerHTML = `<p style="text-align:center;color:#94a3b8;padding:30px;font-size:16px;"><i class="fas fa-circle-notch fa-spin"></i> Đang tìm kiếm...</p>`;

      try {
        const [jcrRes, hdgsnnRes, scopusRes] = await Promise.all([
          isIssnSearch
            ? publicDb.from('jcr_data').select('*').or(`issn.eq.${cleanedQuery},eissn.eq.${cleanedQuery}`).limit(50)
            : publicDb.from('jcr_data').select('*').ilike('journal_norm', `%${normQuery}%`).limit(50),
          isIssnSearch
            ? publicDb.from('hdgsnn_list').select('*').eq('issn', cleanedQuery)
            : publicDb.from('hdgsnn_list').select('*').ilike('ten_norm', `%${normQuery}%`),
          isIssnSearch
            ? publicDb.from('scopus_list').select('*').or(`issn.eq.${cleanedQuery},eissn.eq.${cleanedQuery}`).limit(50)
            : publicDb.from('scopus_list').select('*').ilike('source_title_norm', `%${normQuery}%`).limit(50),
        ]);

        const jcrMatches = jcrRes.data || [];
        const hdgsnnMatches = hdgsnnRes.data || [];
        const scopusMatches = scopusRes.data || [];

        if (hdgsnnMatches.length === 0 && scopusMatches.length === 0 && jcrMatches.length === 0) {
          excelInfoDiv.innerHTML = `<p style="color: #ef4444; font-weight: bold; text-align: center; font-size: 18px; padding: 20px;">
            <i class="fas fa-exclamation-triangle"></i> Không tìm thấy kết quả phù hợp trong danh mục HDGSNN, JCR và Scopus.
          </p>`;
          const encoded = encodeURIComponent(query);
          document.getElementById('externalLinks').style.display = 'block';
          document.getElementById('clarivateLink').href = `https://mjl.clarivate.com/search-results?issn=${encoded}`;
          document.getElementById('scopusLink').href = `https://www.scopus.com/sources.uri`;
          document.getElementById('scimagoLink').href = `https://www.scimagojr.com/journalsearch.php?q=${encoded}`;
          updateLookupUrls(query);
          renderLookupExternalLinks();
          updateIframeSources();

          if (typeof gtag === 'function') gtag('event', 'search', { search_term: query, results_count: 0 });
          return;
        }

        // HTML HDGSNN
        let hdgsnnHTML = `<div class="result-section">
          <h4><i class="fas fa-university"></i> Danh mục HDGSNN (${hdgsnnMatches.length})</h4>`;
        if (hdgsnnMatches.length === 0) {
          hdgsnnHTML += `<p style="color: #94a3b8; font-style: italic;">Không tìm thấy tạp chí nào trong danh mục HĐGSNN.</p>`;
        } else {
          hdgsnnHTML += `<ul class="result-list">`;
          hdgsnnMatches.forEach(item => {
            hdgsnnHTML += `
              <li class="result-item">
                <div class="result-item-title">${escapeHTML(item.ten_tap_chi || "N/A")}</div>
                <div class="result-item-detail"><b>ISSN:</b> <span>${escapeHTML(formatISSN(item.issn))}</span></div>
                <div class="result-item-detail"><b>Điểm HĐGSNN:</b> <span class="badge badge-points">${escapeHTML(item.diem_hdgsnn !== null ? item.diem_hdgsnn : "N/A")}</span></div>
              </li>`;
          });
          hdgsnnHTML += `</ul>`;
        }
        hdgsnnHTML += `</div>`;

        // HTML JCR
        let jcrHTML = `<div class="result-section">
          <h4><i class="fas fa-chart-line"></i> Chỉ số JCR (Impact Factor) (${jcrMatches.length})</h4>`;
        if (jcrMatches.length === 0) {
          jcrHTML += `<p style="color: #94a3b8; font-style: italic;">Không tìm thấy tạp chí nào trong dữ liệu JCR.</p>`;
        } else {
          jcrHTML += `<ul class="result-list">`;
          jcrMatches.forEach(item => {
            jcrHTML += `
              <li class="result-item">
                <div class="result-item-title">${escapeHTML(item.journal_name || "N/A")}</div>
                <div class="result-item-detail"><b>ISSN:</b> <span>${escapeHTML(formatISSN(item.issn))}</span></div>
                <div class="result-item-detail"><b>eISSN:</b> <span>${escapeHTML(formatISSN(item.eissn))}</span></div>
                <div class="result-item-detail"><b>Ngành:</b> <span>${escapeHTML(item.category || "N/A")}</span></div>
                <div class="result-item-detail"><b>Impact Factor 2023:</b> <span class="badge badge-points">${escapeHTML(item.jcr_2024 || 'N/A')}</span></div>
                <div class="result-item-detail"><b>Impact Factor 2024:</b> <span class="badge badge-points">${escapeHTML(item.jcr_2025 || 'N/A')}</span></div>
                <div class="result-item-detail"><b>Phân hạng Q:</b> <span class="badge badge-oa">${escapeHTML(item.jif_quartile || 'N/A')}</span></div>
              </li>`;
          });
          jcrHTML += `</ul>`;
        }
        jcrHTML += `</div>`;

        // HTML Scopus
        let scopusHTML = `<div class="result-section">
          <h4><i class="fas fa-globe"></i> Danh mục Scopus (May 2026) (${scopusMatches.length})</h4>`;
        if (scopusMatches.length === 0) {
          scopusHTML += `<p style="color: #94a3b8; font-style: italic;">Không tìm thấy tạp chí nào trong danh mục Scopus.</p>`;
        } else {
          scopusHTML += `<ul class="result-list">`;
          scopusMatches.forEach(item => {
            const isDiscontinued = !!item.discontinued;
            const isActive = String(item.active_or_inactive || "").trim().toLowerCase() === "active" && !isDiscontinued;
            const activeBadge = isActive
              ? `<span class="badge badge-active">Active</span>`
              : `<span class="badge badge-inactive">Inactive</span>`;
            const oaStatus = item.open_access_status ? `<span class="badge badge-oa">${escapeHTML(item.open_access_status)}</span>` : "";
            const discontinued = item.discontinued ? `<span class="badge badge-discontinued">Discontinued</span>` : "";

            scopusHTML += `
              <li class="result-item">
                <div class="result-item-title">${escapeHTML(item.source_title || "N/A")}</div>
                <div class="result-item-detail"><b>ISSN:</b> <span>${escapeHTML(formatISSN(item.issn))}</span></div>
                <div class="result-item-detail"><b>EISSN:</b> <span>${escapeHTML(formatISSN(item.eissn))}</span></div>
                <div class="result-item-detail"><b>Publisher:</b> <span>${escapeHTML(item.publisher || "N/A")}</span></div>
                <div class="result-item-detail"><b>Coverage:</b> <span>${escapeHTML(item.coverage || "N/A")}</span></div>
                <div class="result-item-detail"><b>Source Type:</b> <span>${escapeHTML(item.source_type || "N/A")}</span></div>
                <div class="result-item-detail"><b>Trạng thái:</b> <span>${activeBadge} ${discontinued} ${oaStatus}</span></div>
              </li>`;
          });
          scopusHTML += `</ul>`;
        }
        scopusHTML += `</div>`;

        // Đưa HTML vào giao diện
        excelInfoDiv.innerHTML = `
          <h3><i class="fas fa-info-circle"></i> Kết quả tìm kiếm cho: "${escapeHTML(query)}"</h3>
          <div class="search-results-grid">
            ${hdgsnnHTML}
            ${jcrHTML}
            ${scopusHTML}
          </div>`;

        const firstMatch = scopusMatches[0] || jcrMatches[0] || hdgsnnMatches[0];
        const firstMatchName = firstMatch ? (firstMatch.source_title || firstMatch.journal_name || firstMatch.ten_tap_chi || query) : query;
        const firstMatchIssnRaw = firstMatch ? (firstMatch.issn || '') : '';
        const firstMatchIssn = formatISSN(firstMatchIssnRaw) !== 'N/A' ? formatISSN(firstMatchIssnRaw) : query;
        const encodedName = encodeURIComponent(firstMatchName);
        const encodedIssn = encodeURIComponent(firstMatchIssn);

        document.getElementById('externalLinks').style.display = 'block';
        document.getElementById('clarivateLink').href = `https://mjl.clarivate.com/search-results?issn=${encodedIssn}`;
        document.getElementById('scopusLink').href = `https://www.scopus.com/sources.uri`;
        document.getElementById('scimagoLink').href = `https://www.scimagojr.com/journalsearch.php?q=${encodedIssn}`;
        updateLookupUrls(firstMatchIssnRaw || firstMatchName || query);
        renderLookupExternalLinks();
        updateIframeSources();

        if (typeof gtag === 'function') gtag('event', 'search', { search_term: query, results_count: hdgsnnMatches.length + jcrMatches.length + scopusMatches.length });

      } catch (err) {
        excelInfoDiv.innerHTML = `<p style="color: #ef4444; text-align: center; font-size: 16px; padding: 20px;"><i class="fas fa-exclamation-triangle"></i> Lỗi kết nối: ${escapeHTML(err.message)}</p>`;
      }
    }
export function initSearchEvents() {
  document.getElementById("searchInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") search();
  });
  document.getElementById('searchButton')?.addEventListener('click', search);
}
