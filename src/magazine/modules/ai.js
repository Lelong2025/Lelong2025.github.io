import { state, saveToLocalStorage } from './state.js';
import { showToast } from './utils.js';
import { renderArticlesList, renderLivePreview } from './ui.js';

const STATUS_BASE = 'px-2 py-0.5 rounded-full text-[9px] font-bold';

export const METADATA_FIELDS = [
    { id: 'titleVn', inputId: 'input-title-vn', label: 'Tiêu đề tiếng Việt', target: 'target-titleVn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' },
    { id: 'titleEn', inputId: 'input-title-en', label: 'Tiêu đề tiếng Anh', target: 'target-titleEn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' },
    { id: 'abstractVn', inputId: 'input-abstract-vn', label: 'Tóm tắt tiếng Việt', target: 'target-abstractVn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' },
    { id: 'abstractEn', inputId: 'input-abstract-en', label: 'Abstract tiếng Anh', target: 'target-abstractEn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' },
    { id: 'keywordsVn', inputId: 'input-keywords-vn', label: 'Từ khóa tiếng Việt', target: 'target-keywordsVn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' },
    { id: 'keywordsEn', inputId: 'input-keywords-en', label: 'Keywords tiếng Anh', target: 'target-keywordsEn', rule: 'Chỉ dùng metadata, không chỉnh nội dung bài.' }
];

function setAiStatusBadge(statusBadge, text, className) {
    statusBadge.textContent = text;
    statusBadge.className = `${STATUS_BASE} ${className}`;
    statusBadge.classList.toggle('hidden', state.appState.reviewPanelTab === 'issue');
}

function setAiReviewBusy(busy, message = 'AI đang phân tích bài viết...') {
    const container = document.getElementById('ai-suggestions-container');
    const runButton = document.querySelector('button[onclick="runAiReview()"]');
    const modeSelect = document.getElementById('ai-review-mode');
    const applyButton = document.getElementById('apply-ai-btn');

    if (runButton) {
        runButton.disabled = busy;
        runButton.classList.toggle('cursor-not-allowed', busy);
        runButton.classList.toggle('opacity-60', busy);
        runButton.setAttribute('aria-busy', String(busy));
    }
    if (modeSelect) modeSelect.disabled = busy;
    if (applyButton) applyButton.disabled = busy || applyButton.disabled;
    if (!container) return;

    container.setAttribute('aria-busy', String(busy));
    if (busy) {
        container.innerHTML = `
            <div class="flex min-h-[280px] flex-col items-center justify-center px-5 text-center" role="status" aria-live="polite">
                <div class="relative mb-5 h-16 w-16">
                    <div class="absolute inset-0 rounded-full border-4 border-indigo-200/30 dark:border-indigo-900/50"></div>
                    <div class="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-indigo-500 border-r-rose-500"></div>
                    <i class="fa-solid fa-wand-magic-sparkles absolute inset-0 flex items-center justify-center text-xl text-indigo-400 animate-pulse"></i>
                </div>
                <p id="ai-loading-message" class="text-xs font-bold text-indigo-600 dark:text-indigo-300">${escapeHtml(message)}</p>
                <div class="mt-3 flex items-center gap-1.5" aria-hidden="true">
                    <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-400"></span>
                    <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:150ms]"></span>
                    <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:300ms]"></span>
                </div>
                <p class="mt-4 max-w-[260px] text-[10px] leading-relaxed text-slate-400">Vui lòng giữ trang này mở. Kết quả sẽ xuất hiện tự động khi hoàn tất.</p>
            </div>`;
    }
}

function updateAiLoadingMessage(message) {
    const element = document.getElementById('ai-loading-message');
    if (element) element.textContent = message;
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function currentAiMode() {
    const select = document.getElementById('ai-review-mode');
    return ['spelling', 'suggestion', 'full'].includes(select?.value) ? select.value : 'spelling';
}

export function syncAiModeControls(mode = currentAiMode()) {
    state.appState.aiReviewMode = ['spelling', 'suggestion', 'full'].includes(mode) ? mode : 'spelling';
    const select = document.getElementById('ai-review-mode');
    const label = document.getElementById('ai-run-button-label');
    if (select) select.value = state.appState.aiReviewMode;
    if (label) label.textContent = {
        spelling: 'Chạy kiểm chính tả',
        suggestion: 'Chạy gợi ý metadata',
        full: 'Chạy review toàn bài'
    }[state.appState.aiReviewMode];
}

export function switchAiReviewMode(mode) {
    syncAiModeControls(mode);
    const art = activeArticle();
    if (art) {
        art.aiReviewMode = state.appState.aiReviewMode;
        art.aiReviewSuggestions = null;
        saveToLocalStorage();
        renderAiReviewPanel(art);
    }
}

function activeArticle() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    return currentIssue?.articles.find(item => item.id === state.appState.currentArticleId) || null;
}

function metadataPayload(art) {
    return Object.fromEntries(METADATA_FIELDS.map(field => [field.id, art?.[field.id] || '']));
}

export function renderAiReviewPanel(art) {
    const container = document.getElementById('ai-suggestions-container');
    const applyBtn = document.getElementById('apply-ai-btn');
    const statusBadge = document.getElementById('ai-status-badge');
    if (!container || !applyBtn || !statusBadge) return;

    syncAiModeControls(art?.aiReviewMode || state.appState.aiReviewMode || 'spelling');

    if (!art?.aiReviewSuggestions) {
        setAiStatusBadge(statusBadge, 'Chưa check', 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300');
        applyBtn.disabled = true;
        container.innerHTML = `
            <div class="text-center py-12 text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-wand-magic-sparkles text-3xl mb-3 text-indigo-400"></i>
                <p class="text-xs font-semibold">Chọn mode rồi chạy AI cho tiêu đề, tóm tắt và từ khóa.</p>
            </div>
        `;
        clearPreviewHighlights();
        return;
    }

    const suggestions = art.aiReviewSuggestions;
    syncAiModeControls(suggestions.mode || 'spelling');
    setAiStatusBadge(
        statusBadge,
        suggestions.mode === 'spelling' ? 'Đã kiểm' : suggestions.mode === 'full' ? 'Đã review' : 'Đã gợi ý',
        'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 animate-pulse'
    );
    applyBtn.disabled = false;
    container.innerHTML = '';

    if (suggestions.mode === 'full') {
        applyBtn.disabled = true;
        renderFullReview(container, suggestions);
    } else if (suggestions.mode === 'spelling') {
        if (!suggestions.corrections?.length) {
            container.innerHTML = '<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">AI chưa phát hiện lỗi chính tả trong metadata.</div>';
        } else {
            suggestions.corrections.forEach((correction, index) => {
                container.appendChild(createSpellingCard(correction, index));
            });
        }
    } else {
        METADATA_FIELDS.forEach(field => {
            const item = suggestions[field.id];
            if (item) container.appendChild(createSuggestionCard(field.id, field.label, field.rule, item, field.target));
        });
    }
    highlightPreviewTargets();
}

function bindCardHighlight(card, targetDomId) {
    card.addEventListener('mouseenter', () => {
        const target = document.getElementById(targetDomId);
        if (target) {
            target.classList.add('ai-highlight-active');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    card.addEventListener('mouseleave', () => {
        document.getElementById(targetDomId)?.classList.remove('ai-highlight-active');
    });
}

export function createSpellingCard(correction, index) {
    const field = METADATA_FIELDS.find(item => item.id === correction.field) || METADATA_FIELDS[0];
    const card = document.createElement('div');
    card.className = 'border border-amber-300 dark:border-amber-900/60 rounded-xl bg-amber-50/50 dark:bg-amber-950/15 p-3 space-y-2.5 transition-all';
    bindCardHighlight(card, field.target);

    const name = `spell-${index}`;
    correction.selected = correction.selected || 'suggestion';
    card.innerHTML = `
        <div>
            <h4 class="text-xs font-bold text-amber-800 dark:text-amber-300">${escapeHtml(field.label)}</h4>
            <p class="mt-1 text-[10px] text-slate-500">Từ nghi vấn: <strong>${escapeHtml(correction.original)}</strong></p>
            ${correction.context ? `<p class="mt-1 rounded bg-white/70 p-2 text-[10px] text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">${escapeHtml(correction.context)}</p>` : ''}
        </div>
        <label class="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] dark:border-slate-700 dark:bg-slate-800">
            <input type="radio" name="${name}" value="suggestion" class="mt-0.5" ${correction.selected === 'suggestion' ? 'checked' : ''}>
            <span>Sửa thành <strong class="text-blue-600 dark:text-blue-400">${escapeHtml(correction.suggestion)}</strong></span>
        </label>
        <label class="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] dark:border-slate-700 dark:bg-slate-800">
            <input type="radio" name="${name}" value="keep" class="mt-0.5" ${correction.selected === 'keep' ? 'checked' : ''}>
            <span>Giữ nguyên</span>
        </label>
        <div class="spell-custom-option rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] dark:border-slate-700 dark:bg-slate-800">
            <label class="spell-custom-label">
                <input type="radio" name="${name}" value="custom" class="spell-custom-radio" ${correction.selected === 'custom' ? 'checked' : ''}>
                <span class="spell-custom-text">Tự nhập từ đúng</span>
                <input type="text" value="${escapeHtml(correction.custom || '')}" class="spell-custom-input rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-700">
            </label>
        </div>
    `;
    card.querySelectorAll(`input[name="${name}"]`).forEach(input => {
        input.addEventListener('change', () => {
            correction.selected = input.value;
            saveToLocalStorage();
        });
    });
    card.querySelector('.spell-custom-input')?.addEventListener('focus', () => {
        correction.selected = 'custom';
        card.querySelector(`input[name="${name}"][value="custom"]`).checked = true;
        saveToLocalStorage();
    });
    card.querySelector('.spell-custom-input')?.addEventListener('input', event => {
        correction.custom = event.target.value;
        correction.selected = 'custom';
        card.querySelector(`input[name="${name}"][value="custom"]`).checked = true;
        saveToLocalStorage();
    });
    return card;
}

export function createSuggestionCard(fieldId, label, rule, data, targetDomId) {
    const card = document.createElement('div');
    card.className = 'border border-rose-300 dark:border-rose-900/60 rounded-xl bg-rose-50/40 dark:bg-rose-950/15 p-3 space-y-2.5 transition-all';
    bindCardHighlight(card, targetDomId);

    const options = Array.isArray(data.options) ? data.options : [];
    data.selected = data.selected || 'keep';
    card.innerHTML = `
        <div>
            <h4 class="text-xs font-bold text-rose-800 dark:text-rose-300">${escapeHtml(label)}</h4>
            <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(rule)}</p>
            ${data.feedback ? `<p class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">${escapeHtml(data.feedback)}</p>` : ''}
        </div>
        <div class="space-y-1.5">
            ${options.map((option, index) => `
                <label class="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] dark:border-slate-700 dark:bg-slate-800">
                    <input type="radio" name="radio-group-${fieldId}" value="${index}" class="mt-0.5" ${data.selected === option ? 'checked' : ''}>
                    <span><strong class="text-blue-600 dark:text-blue-400">Phương án ${index + 1}: </strong>${escapeHtml(option)}</span>
                </label>
            `).join('')}
            <label class="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 p-2 text-[10.5px] font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <input type="radio" name="radio-group-${fieldId}" value="keep" class="mt-0.5" ${data.selected === 'keep' ? 'checked' : ''}>
                <span>Giữ nguyên nội dung hiện tại</span>
            </label>
        </div>
    `;
    card.querySelectorAll(`input[name="radio-group-${fieldId}"]`).forEach(input => {
        input.addEventListener('change', () => {
            data.selected = input.value === 'keep' ? 'keep' : options[Number(input.value)];
            saveToLocalStorage();
        });
    });
    return card;
}

export function highlightPreviewTargets() {
    document.querySelectorAll('.ai-highlight-target').forEach(target => {
        target.style.borderWidth = '1.5px';
        target.style.borderStyle = 'dashed';
        target.style.borderColor = '#f43f5e';
    });
}

export function clearPreviewHighlights() {
    document.querySelectorAll('.ai-highlight-target').forEach(target => {
        target.style.borderWidth = '0px';
        target.style.borderStyle = 'none';
        target.style.borderColor = 'transparent';
    });
}

export async function callLlamaAI(userPrompt, timeoutMs = 75000, usageReservationId = null) {
    const { apiFetch } = await import('../../shared/utils/api.js');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const data = await apiFetch('/api/magazine/review', {
            method: 'POST',
            body: JSON.stringify({ prompt: userPrompt, usage_reservation_id: usageReservationId || undefined }),
            signal: controller.signal
        });
        if (typeof data?.content !== 'string' || !data.content.trim()) {
            throw new Error('AI không trả về nội dung hợp lệ.');
        }
        return data.content;
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = new Error(`Quá thời gian chờ ${Math.round(timeoutMs / 1000)} giây.`);
            timeoutError.code = 408;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function articlePlainText(art) {
    const holder = document.createElement('div');
    holder.innerHTML = String(art?.bodyContent || '');
    holder.querySelectorAll('script, style, img, svg').forEach(node => node.remove());
    return (holder.innerText || holder.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function splitArticleText(text, maxChars = 11000) {
    const paragraphs = String(text || '').split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const paragraph of paragraphs) {
        if (current && current.length + paragraph.length + 2 > maxChars) {
            chunks.push(current);
            current = '';
        }
        if (paragraph.length <= maxChars) {
            current += `${current ? '\n\n' : ''}${paragraph}`;
        } else {
            if (current) chunks.push(current);
            for (let start = 0; start < paragraph.length; start += maxChars) {
                chunks.push(paragraph.slice(start, start + maxChars));
            }
            current = '';
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function buildArticleContextPrompt(art, bodyText) {
    return `Bạn đang tạo bộ nhớ nội bộ để các lượt review sau hiểu toàn bộ bài báo. Chưa nhận xét hoặc sửa bài. Giữ chính xác số liệu và không suy diễn. Chỉ trả JSON hợp lệ, không Markdown.

Schema: {"topic":"...","objectives":["..."],"methods":["..."],"main_results":["..."],"conclusions":["..."],"important_terms":["..."],"important_numbers":["..."],"consistency_checks":["..."]}

METADATA: ${JSON.stringify(metadataPayload(art))}
ARTICLE_BODY:
${bodyText}`;
}

function buildSectionReviewPrompt(context, sectionText, index, total) {
    return `Bạn là phản biện kiêm biên tập viên bài báo khoa học. Review phần ${index + 1}/${total} trong quan hệ với hồ sơ toàn bài. Mỗi vấn đề phải kèm một gợi ý xử lý cụ thể; nếu phù hợp, đưa ra câu hoặc đoạn thay thế ngắn nhưng không được bịa dữ liệu. Không viết lại toàn bộ nội dung. Chỉ nêu vấn đề có căn cứ. Chỉ trả JSON hợp lệ, không Markdown.

Schema: {"section_label":"...","summary":"...","issues":[{"category":"logic|method|result|consistency|clarity|citation|language","severity":"high|medium|low","quote":"trích đoạn ngắn hoặc để trống","feedback":"vấn đề được phát hiện và lý do","suggestion":"cách xử lý cụ thể hoặc câu thay thế ngắn"}]}

Quy tắc gợi ý:
- Với lỗi logic/phương pháp/kết quả: nêu thông tin cần bổ sung hoặc cách đối chiếu, không tự tạo số liệu.
- Với lỗi diễn đạt/ngôn ngữ: có thể đề xuất câu thay thế hoàn chỉnh, giữ nguyên ý và thuật ngữ khoa học.
- Với trích dẫn: chỉ yêu cầu kiểm tra/bổ sung nguồn; không bịa tên tài liệu, DOI hoặc tác giả.
- Nếu chưa đủ căn cứ để viết câu thay thế, suggestion phải là một hành động kiểm tra cụ thể.

ARTICLE_CONTEXT: ${JSON.stringify(context)}
SECTION_CONTENT:
${sectionText}`;
}

async function runFullArticleReview(art, updateProgress, usageReservationId = null) {
    const bodyText = articlePlainText(art);
    if (bodyText.length < 100) throw new Error('Nội dung bài quá ngắn để review toàn bài.');
    if (bodyText.length > 44000) {
        throw new Error('Bản thử hiện hỗ trợ tối đa khoảng 44.000 ký tự nội dung thuần.');
    }
    updateProgress('Đang tạo hồ sơ toàn bài...');
    const context = parseJsonObject(await callLlamaAI(buildArticleContextPrompt(art, bodyText), 90000, usageReservationId));
    const chunks = splitArticleText(bodyText);
    const sections = [];
    for (let index = 0; index < chunks.length; index += 1) {
        updateProgress(`Đang review phần ${index + 1}/${chunks.length}...`);
        sections.push(parseJsonObject(await callLlamaAI(
            buildSectionReviewPrompt(context, chunks[index], index, chunks.length),
            90000,
            usageReservationId
        )));
    }
    return { mode: 'full', context, sections, reviewedAt: new Date().toISOString() };
}

function renderFullReview(container, suggestions) {
    const issues = (suggestions.sections || []).flatMap(section =>
        (Array.isArray(section.issues) ? section.issues : []).map(issue => ({ ...issue, section: section.section_label }))
    );
    const severityClass = {
        high: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300',
        medium: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300',
        low: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300'
    };
    container.innerHTML = `
        <div class="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-300">
            <strong>AI đã đọc toàn bài:</strong> ${escapeHtml(suggestions.context?.topic || 'Đã tạo hồ sơ nội bộ')} · ${issues.length} nhận xét
        </div>
        ${issues.length ? issues.map(issue => `
            <article class="rounded-lg border p-3 text-xs ${severityClass[issue.severity] || severityClass.low}">
                <div class="mb-1 font-bold">${escapeHtml(issue.section || 'Nội dung')} · ${escapeHtml(issue.category || 'review')}</div>
                ${issue.quote ? `<blockquote class="mb-2 border-l-2 border-current pl-2 opacity-80">${escapeHtml(issue.quote)}</blockquote>` : ''}
                <p>${escapeHtml(issue.feedback)}</p>
                ${issue.suggestion ? `<div class="mt-2 rounded-md border border-current/20 bg-white/60 p-2 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200"><strong>Gợi ý xử lý:</strong> ${escapeHtml(issue.suggestion)}</div>` : ''}
            </article>
        `).join('') : '<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">AI chưa phát hiện vấn đề đáng kể.</div>'}
    `;
}

export function buildReviewPrompt(art, mode = currentAiMode()) {
    const metadata = metadataPayload(art);
    if (mode === 'spelling') {
        return `Bạn là biên tập viên kiểm chính tả cho tạp chí khoa học. Chỉ kiểm các trường metadata trong ARTICLE_METADATA. Giữ nguyên văn bản, không viết lại câu, không đổi thuật ngữ học thuật nếu không chắc chắn. Chỉ trả JSON hợp lệ, không Markdown.

Schema bắt buộc:
{"mode":"spelling","corrections":[{"field":"titleVn|titleEn|abstractVn|abstractEn|keywordsVn|keywordsEn","original":"từ/cụm từ sai","suggestion":"từ/cụm từ đúng","context":"câu hoặc đoạn ngắn chứa lỗi"}]}

Nếu không có lỗi, corrections là mảng rỗng. Không kiểm bodyContent.

Strict token-level rules:
- Read each full metadata field first to understand the sentence context, then report each wrong token as a separate correction.
- Report obvious spelling-token problems: abbreviation/informal shortened word, missing Vietnamese diacritics on one word, wrong keyboard typo, missing/extra/swapped letter inside a word, wrong casing inside a word, or clearly misspelled English word.
- A token that is a valid word by itself can still be wrong if the full sentence makes the intended word obvious. Example: in "YẾU TỐ ẢH HƯNG NHU CẦU HỌC TIẾNG ANH SINH VIn DU LỊCH", report ẢH -> ẢNH, HƯNG -> HƯỞNG, VIn -> VIÊN as three separate corrections.
- Do not report phrase-level rewrites, style improvements, grammar suggestions, terminology changes, capitalization preferences, punctuation preferences, keyword quality, or semantic improvements.
- Do not replace a whole phrase if only one word is wrong. The "original" value must be the exact suspicious token from the text, usually one word.
- The "suggestion" value must preserve the surrounding text style/casing when obvious. For all-caps Vietnamese titles, suggest all-caps tokens with correct diacritics.
- Use a short phrase only when the typo itself spans a fixed compound term.
- If the intended token is not clear from the full field context, ignore it.

<ARTICLE_METADATA>${JSON.stringify(metadata)}</ARTICLE_METADATA>`;
    }
    return `Bạn là biên tập viên tạp chí khoa học. Chỉ gợi ý cải thiện metadata trong ARTICLE_METADATA, không review hoặc sửa nội dung bài/bodyContent. Không bịa dữ liệu, tác giả, kết quả hoặc trích dẫn. Chỉ trả JSON hợp lệ, không Markdown.

Schema bắt buộc:
{"mode":"suggestion","titleVn":{"feedback":"...","options":["...","...","..."]},"titleEn":{"feedback":"...","options":["...","...","..."]},"abstractVn":{"feedback":"...","options":["...","...","..."]},"abstractEn":{"feedback":"...","options":["...","...","..."]},"keywordsVn":{"feedback":"...","options":["...","...","..."]},"keywordsEn":{"feedback":"...","options":["...","...","..."]}}

Mỗi options có đúng 3 chuỗi hoàn chỉnh. Nếu một trường trống, feedback nói rõ còn thiếu và options dựa trên ngữ cảnh hiện có.

<ARTICLE_METADATA>${JSON.stringify(metadata)}</ARTICLE_METADATA>`;
}

function parseJsonObject(raw) {
    const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI không trả về JSON hợp lệ.');
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch (error) {
        console.warn('AI JSON parse failed:', error, cleaned.slice(start, Math.min(end + 1, start + 2000)));
        throw new Error('AI trả về JSON bị lỗi định dạng. Vui lòng chạy lại.');
    }
}

function isTokenLevelCorrection(item) {
    const original = String(item?.original || '').trim();
    const suggestion = String(item?.suggestion || '').trim();
    if (!original || !suggestion) return false;
    if (/\s/.test(original) || /\s/.test(suggestion)) return false;
    return original.length <= 40 && suggestion.length <= 40;
}

export function parseAiReviewResult(raw, mode = currentAiMode()) {
    const parsed = parseJsonObject(raw);
    if (mode === 'spelling') {
        return {
            mode: 'spelling',
            corrections: Array.isArray(parsed.corrections) ? parsed.corrections.filter(isTokenLevelCorrection).map(item => ({
                field: METADATA_FIELDS.some(field => field.id === item.field) ? item.field : 'titleVn',
                original: String(item.original || '').trim(),
                suggestion: String(item.suggestion || '').trim(),
                context: String(item.context || '').trim(),
                selected: 'suggestion',
                custom: ''
            })).filter(item => item.original && item.suggestion) : []
        };
    }

    const result = { mode: 'suggestion' };
    METADATA_FIELDS.forEach(field => {
        const item = parsed[field.id];
        if (!item || typeof item.feedback !== 'string' || !Array.isArray(item.options)) {
            throw new Error(`AI trả thiếu dữ liệu cho ${field.label}.`);
        }
        const options = item.options.slice(0, 3).map(value => String(value || '').trim()).filter(Boolean);
        if (options.length !== 3) throw new Error(`AI chưa trả đủ 3 phương án cho ${field.label}.`);
        result[field.id] = { feedback: item.feedback, options, selected: 'keep' };
    });
    return result;
}

export async function runAiReview(usageReservation = null) {
    const art = activeArticle();
    if (!art) {
        showToast('Vui lòng chọn bài viết trước khi chạy AI.');
        return false;
    }

    const mode = currentAiMode();
    art.aiReviewMode = mode;
    const statusBadge = document.getElementById('ai-status-badge');
    if (statusBadge) {
        setAiStatusBadge(statusBadge, 'Đang chạy...', 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 animate-bounce');
    }
    setAiReviewBusy(true, mode === 'full' ? 'Đang đọc và lập hồ sơ toàn bài...' : 'AI đang phân tích metadata...');
    showToast(mode === 'spelling' ? 'Đang kiểm chính tả metadata...' : mode === 'full' ? 'Đang tạo hồ sơ toàn bài...' : 'Đang gợi ý metadata...');

    try {
        if (mode === 'full') {
            art.aiReviewSuggestions = await runFullArticleReview(art, text => {
                if (statusBadge) setAiStatusBadge(statusBadge, text, 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 animate-pulse');
                updateAiLoadingMessage(text);
            }, usageReservation?.reservation_id);
        } else {
            const rawResult = await callLlamaAI(buildReviewPrompt(art, mode), 75000, usageReservation?.reservation_id);
            art.aiReviewSuggestions = parseAiReviewResult(rawResult, mode);
        }
        saveToLocalStorage();
        renderAiReviewPanel(art);
        showToast(mode === 'spelling' ? 'Đã kiểm chính tả metadata.' : mode === 'full' ? 'Đã review toàn bài.' : 'Đã tạo gợi ý metadata.');
        return true;
    } catch (error) {
        console.error(error);
        if (statusBadge) setAiStatusBadge(statusBadge, 'Lỗi AI', 'bg-red-100 text-red-700');
        const container = document.getElementById('ai-suggestions-container');
        if (container) container.innerHTML = `<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300"><i class="fa-solid fa-circle-exclamation mb-2 block text-xl"></i>${escapeHtml(error.message || 'Không thể hoàn tất AI Review.')}</div>`;
        showToast(error.message || 'Không thể hoàn tất AI Review.');
        return false;
    } finally {
        setAiReviewBusy(false);
    }
}

function replaceFirst(value, search, replacement) {
    const index = String(value || '').indexOf(search);
    if (index < 0) return value;
    return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function setArticleField(art, fieldId, value) {
    art[fieldId] = value;
    const inputId = METADATA_FIELDS.find(field => field.id === fieldId)?.inputId;
    const input = inputId ? document.getElementById(inputId) : null;
    if (input) input.value = value;
}

export function applySelectedSuggestions() {
    const art = activeArticle();
    const suggestions = art?.aiReviewSuggestions;
    if (!art || !suggestions) return;

    let changesMadeCount = 0;
    let missingCustomCount = 0;

    if (suggestions.mode === 'spelling') {
        suggestions.corrections?.forEach(correction => {
            if (correction.selected === 'keep') return;
            const replacement = correction.selected === 'custom'
                ? String(correction.custom || '').trim()
                : correction.suggestion;
            if (!replacement) {
                missingCustomCount += 1;
                return;
            }
            const currentValue = String(art[correction.field] || '');
            const nextValue = replaceFirst(currentValue, correction.original, replacement);
            if (nextValue !== currentValue) {
                setArticleField(art, correction.field, nextValue);
                changesMadeCount += 1;
            }
        });
    } else {
        METADATA_FIELDS.forEach(field => {
            const item = suggestions[field.id];
            if (item?.selected && item.selected !== 'keep') {
                setArticleField(art, field.id, item.selected);
                changesMadeCount += 1;
            }
        });
    }

    if (missingCustomCount) showToast('Vui lòng điền từ muốn sửa chính tả cho lựa chọn tự nhập.');
    art.aiReviewSuggestions = null;
    saveToLocalStorage();
    renderLivePreview(art);
    renderArticlesList();
    renderAiReviewPanel(art);
    showToast(changesMadeCount ? `Đã áp dụng ${changesMadeCount} thay đổi.` : 'Không có thay đổi mới nào được chọn.');
}

export function clearSelectedRadioState(suggestions) {
    if (!suggestions) return;
    if (suggestions.mode === 'spelling') {
        suggestions.corrections?.forEach(item => {
            item.selected = 'keep';
        });
        return;
    }
    METADATA_FIELDS.forEach(field => {
        if (suggestions[field.id]) suggestions[field.id].selected = 'keep';
    });
}
