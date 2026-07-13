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

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function currentAiMode() {
    const select = document.getElementById('ai-review-mode');
    return select?.value === 'suggestion' ? 'suggestion' : 'spelling';
}

export function syncAiModeControls(mode = currentAiMode()) {
    state.appState.aiReviewMode = mode === 'suggestion' ? 'suggestion' : 'spelling';
    const select = document.getElementById('ai-review-mode');
    const label = document.getElementById('ai-run-button-label');
    if (select) select.value = state.appState.aiReviewMode;
    if (label) label.textContent = state.appState.aiReviewMode === 'spelling' ? 'Chạy kiểm chính tả' : 'Chạy gợi ý metadata';
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
        suggestions.mode === 'spelling' ? 'Đã kiểm' : 'Đã gợi ý',
        'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 animate-pulse'
    );
    applyBtn.disabled = false;
    container.innerHTML = '';

    if (suggestions.mode === 'spelling') {
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
        <label class="space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-[10.5px] dark:border-slate-700 dark:bg-slate-800">
            <span class="flex items-center gap-2"><input type="radio" name="${name}" value="custom" ${correction.selected === 'custom' ? 'checked' : ''}> Tự nhập từ đúng</span>
            <input type="text" value="${escapeHtml(correction.custom || '')}" class="spell-custom-input w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-700">
        </label>
    `;
    card.querySelectorAll(`input[name="${name}"]`).forEach(input => {
        input.addEventListener('change', () => {
            correction.selected = input.value;
            saveToLocalStorage();
        });
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

export async function callLlamaAI(userPrompt, timeoutMs = 75000) {
    const { apiFetch } = await import('../../shared/utils/api.js');
    const invocation = apiFetch('/api/magazine/review', {
        method: 'POST',
        body: JSON.stringify({ prompt: userPrompt })
    });
    const timeout = new Promise((_, reject) => setTimeout(() => {
        const error = new Error(`Quá thời gian chờ ${Math.round(timeoutMs / 1000)} giây.`);
        error.code = 408;
        reject(error);
    }, timeoutMs));
    const data = await Promise.race([invocation, timeout]);
    if (typeof data?.content !== 'string' || !data.content.trim()) {
        throw new Error('AI không trả về nội dung hợp lệ.');
    }
    return data.content;
}

export function buildReviewPrompt(art, mode = currentAiMode()) {
    const metadata = metadataPayload(art);
    if (mode === 'spelling') {
        return `Bạn là biên tập viên kiểm chính tả cho tạp chí khoa học. Chỉ kiểm các trường metadata trong ARTICLE_METADATA. Giữ nguyên văn bản, không viết lại câu, không đổi thuật ngữ học thuật nếu không chắc chắn. Chỉ trả JSON hợp lệ, không Markdown.

Schema bắt buộc:
{"mode":"spelling","corrections":[{"field":"titleVn|titleEn|abstractVn|abstractEn|keywordsVn|keywordsEn","original":"từ/cụm từ sai","suggestion":"từ/cụm từ đúng","context":"câu hoặc đoạn ngắn chứa lỗi"}]}

Nếu không có lỗi, corrections là mảng rỗng. Không kiểm bodyContent.

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

export function parseAiReviewResult(raw, mode = currentAiMode()) {
    const parsed = parseJsonObject(raw);
    if (mode === 'spelling') {
        return {
            mode: 'spelling',
            corrections: Array.isArray(parsed.corrections) ? parsed.corrections.map(item => ({
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

export async function runAiReview() {
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
    showToast(mode === 'spelling' ? 'Đang kiểm chính tả metadata...' : 'Đang gợi ý metadata...');

    try {
        const rawResult = await callLlamaAI(buildReviewPrompt(art, mode));
        art.aiReviewSuggestions = parseAiReviewResult(rawResult, mode);
        saveToLocalStorage();
        renderAiReviewPanel(art);
        showToast(mode === 'spelling' ? 'Đã kiểm chính tả metadata.' : 'Đã tạo gợi ý metadata.');
        return true;
    } catch (error) {
        console.error(error);
        if (statusBadge) setAiStatusBadge(statusBadge, 'Lỗi AI', 'bg-red-100 text-red-700');
        showToast(error.message || 'Không thể hoàn tất AI Review.');
        return false;
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
