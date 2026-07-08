import { state, saveToLocalStorage } from './state.js';
import { showToast } from './utils.js';
import { renderArticlesList, renderLivePreview } from './ui.js';

export const ARTICLE_REVIEW_CRITERIA = `Bạn là chuyên gia biên tập tạp chí khoa học.

Hãy kiểm tra bài báo theo tiêu chuẩn:
1. Tiêu đề: Viết hoa chữ cái đầu, không trùng từ khóa.
2. Tóm tắt: Khoảng 150 đến 250 từ, có vấn đề, mục tiêu, phương pháp, kết quả, ý nghĩa.
3. Abstract EN: Dịch sát nghĩa, dùng thì hiện tại đơn cho kết quả.
4. Từ khóa: Từ 4 đến 6 cụm, không trùng tiêu đề.
5. Nội dung: Kiểm tra cấu trúc IMRAD và trích dẫn chuẩn.`;

function setAiStatusBadge(statusBadge, text, className) {
    statusBadge.textContent = text;
    statusBadge.className = className;
    statusBadge.classList.toggle('hidden', state.appState.reviewPanelTab === 'issue');
}

export function renderAiReviewPanel(art) {
    const container = document.getElementById('ai-suggestions-container');
    const applyBtn = document.getElementById('apply-ai-btn');
    const statusBadge = document.getElementById('ai-status-badge');

    if (!container || !applyBtn || !statusBadge) return;

    if (!art.aiReviewSuggestions) {
        setAiStatusBadge(statusBadge, "Chưa Check", "px-2 py-0.5 bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 rounded-full text-[9px] font-bold");
        applyBtn.disabled = true;

        container.innerHTML = `
            <div class="text-center py-12 text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-wand-magic-sparkles text-3xl mb-3 text-indigo-400"></i>
                <p class="text-xs font-semibold">Nhấn "Chạy AI Review Toàn diện" ở thanh tiêu đề để bắt đầu đánh giá học thuật tự động.</p>
            </div>
        `;
        clearPreviewHighlights();
        return;
    }

    setAiStatusBadge(statusBadge, "Đã Review", "px-2 py-0.5 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 rounded-full text-[9px] font-bold animate-pulse");
    applyBtn.disabled = false;

    container.innerHTML = '';
    const suggestions = art.aiReviewSuggestions;

    const metaKeys = [
        { id: "titleVn", label: "Tiêu đề tiếng Việt", target: "target-titleVn", rule: "1. Tiêu đề: Viết hoa chữ cái đầu, không trùng từ khóa." },
        { id: "titleEn", label: "Tiêu đề tiếng Anh", target: "target-titleEn", rule: "2. Article Title EN: Capitalize properly, academic tone." },
        { id: "abstractVn", label: "Tóm tắt tiếng Việt", target: "target-abstractVn", rule: "3. Tóm tắt có bối cảnh, mục tiêu, kết quả (150-250 từ)." },
        { id: "abstractEn", label: "Abstract tiếng Anh", target: "target-abstractEn", rule: "4. English Abstract: Correct grammar, matches VN meaning." },
        { id: "keywordsVn", label: "Từ khóa tiếng Việt", target: "target-keywordsVn", rule: "5. Từ khóa VN: cách nhau bằng dấu phẩy, 3-5 thuật ngữ." },
        { id: "keywordsEn", label: "Từ khóa tiếng Anh", target: "target-keywordsEn", rule: "6. Keywords EN: Match VN list, scientific index." }
    ];

    metaKeys.forEach(meta => {
        if (suggestions[meta.id]) {
            const suggData = suggestions[meta.id];
            container.appendChild(createSuggestionCard(meta.id, meta.label, meta.rule, suggData, meta.target));
        }
    });

    if (suggestions.sections && suggestions.sections.length > 0) {
        suggestions.sections.forEach((sect, idx) => {
            const cleanId = sect.heading.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 15);
            const targetId = `target-section-${cleanId}`;
            const label = `Đề mục: ${sect.heading}`;
            const rule = `Căn chỉnh nội dung & bố cục khoa học cho mục "${sect.heading}"`;
            container.appendChild(createSuggestionCard(`section-${idx}`, label, rule, sect, targetId));
        });
    }

    highlightPreviewTargets();
}

export function createSuggestionCard(fieldId, label, rule, data, targetDomId) {
    const card = document.createElement('div');
    card.id = `card-${fieldId}`;
    card.className = "border border-rose-300 dark:border-rose-900/60 rounded-xl bg-rose-50/40 dark:bg-rose-950/15 p-3 space-y-2.5 transition-all";

    card.addEventListener('mouseenter', () => {
        const target = document.getElementById(targetDomId);
        if (target) {
            target.classList.add('ai-highlight-active');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    card.addEventListener('mouseleave', () => {
        const target = document.getElementById(targetDomId);
        if (target) {
            target.classList.remove('ai-highlight-active');
        }
    });

    const header = document.createElement('div');
    header.className = "flex justify-between items-start cursor-pointer";
    header.onclick = () => {
        const body = document.getElementById(`card-body-${fieldId}`);
        const chevron = document.getElementById(`chevron-${fieldId}`);
        if (body) body.classList.toggle('hidden');
        if (chevron) {
            chevron.classList.toggle('fa-chevron-down');
            chevron.classList.toggle('fa-chevron-up');
        }
    };

    header.innerHTML = `
        <div class="flex-1 min-w-0 pr-2">
            <h4 class="text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center">
                <span class="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1.5 shrink-0"></span>
                ${label}
            </h4>
            <p class="text-[9px] text-slate-500 mt-0.5 leading-relaxed font-sans">${rule}</p>
        </div>
        <div class="text-slate-400 hover:text-slate-600 p-0.5 shrink-0">
            <i id="chevron-${fieldId}" class="fa-solid fa-chevron-up text-[10px]"></i>
        </div>
    `;

    const cardBody = document.createElement('div');
    cardBody.id = `card-body-${fieldId}`;
    cardBody.className = "space-y-2 pt-1 font-sans text-xs text-slate-700 dark:text-slate-300";

    if (data.feedback) {
        const fbBox = document.createElement('div');
        fbBox.className = "p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg text-[10px] text-amber-800 dark:text-amber-300 flex items-start space-x-1";
        fbBox.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation mt-0.5 text-amber-500 shrink-0"></i>
            <span>${data.feedback}</span>
        `;
        cardBody.appendChild(fbBox);
    }

    const optionBox = document.createElement('div');
    optionBox.className = "space-y-1.5";

    if (data.options && data.options.length > 0) {
        data.options.forEach((optText, index) => {
            const uniqueId = `opt-${fieldId}-${index}`;
            const optWrapper = document.createElement('label');
            optWrapper.htmlFor = uniqueId;
            optWrapper.className = "flex items-start space-x-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-slate-50/50 dark:hover:bg-slate-700/50 cursor-pointer transition-all";

            const radio = document.createElement('input');
            radio.type = "radio";
            radio.name = `radio-group-${fieldId}`;
            radio.id = uniqueId;
            radio.value = optText;
            radio.className = "mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-300";
            if (data.selected === optText) {
                radio.checked = true;
            }

            radio.onchange = () => {
                data.selected = optText;
                saveToLocalStorage();
            };

            const labelSpan = document.createElement('span');
            labelSpan.className = "text-[10.5px] leading-relaxed text-slate-700 dark:text-slate-300";
            labelSpan.innerHTML = `<strong class="text-blue-600 dark:text-blue-400">Phương án ${index + 1}:</strong> ${optText}`;

            optWrapper.appendChild(radio);
            optWrapper.appendChild(labelSpan);
            optionBox.appendChild(optWrapper);
        });
    }

    const keepUniqueId = `opt-${fieldId}-keep`;
    const keepWrapper = document.createElement('label');
    keepWrapper.htmlFor = keepUniqueId;
    keepWrapper.className = "flex items-start space-x-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-750 border border-slate-300 dark:border-slate-600 hover:border-blue-400 cursor-pointer transition-all";

    const keepRadio = document.createElement('input');
    keepRadio.type = "radio";
    keepRadio.name = `radio-group-${fieldId}`;
    keepRadio.id = keepUniqueId;
    keepRadio.value = "keep";
    keepRadio.className = "mt-0.5 text-blue-600 focus:ring-blue-500";
    if (!data.selected || data.selected === "keep") {
        keepRadio.checked = true;
        data.selected = "keep";
    }

    keepRadio.onchange = () => {
        data.selected = "keep";
        saveToLocalStorage();
    };

    const keepSpan = document.createElement('span');
    keepSpan.className = "text-[10.5px] font-semibold text-slate-600 dark:text-slate-300";
    keepSpan.textContent = "Giữ nguyên nội dung hiện tại";

    keepWrapper.appendChild(keepRadio);
    keepWrapper.appendChild(keepSpan);
    optionBox.appendChild(keepWrapper);

    cardBody.appendChild(optionBox);
    card.appendChild(header);
    card.appendChild(cardBody);

    return card;
}

export function highlightPreviewTargets() {
    const targets = document.querySelectorAll('.ai-highlight-target');
    targets.forEach(t => {
        t.style.borderWidth = '1.5px';
        t.style.borderStyle = 'dashed';
        t.style.borderColor = '#f43f5e';
    });
}

export function clearPreviewHighlights() {
    const targets = document.querySelectorAll('.ai-highlight-target');
    targets.forEach(t => {
        t.style.borderWidth = '0px';
        t.style.borderStyle = 'none';
        t.style.borderColor = 'transparent';
    });
}

export async function callLlamaAI(userPrompt, timeoutMs = 75000) {
    const { apiFetch } = await import('../../shared/utils/api.js');
    const invocation = apiFetch('/api/magazine/review', {
        method: 'POST',
        body: JSON.stringify({ prompt: userPrompt })
    });
    const timeout = new Promise((_, reject) => setTimeout(() => {
        const error = new Error(`Quá thời gian chờ ${Math.round(timeoutMs / 1000)} giây (Supabase AI).`);
        error.code = 408;
        reject(error);
    }, timeoutMs));
    const data = await Promise.race([invocation, timeout]);
    if (typeof data?.content !== 'string' || !data.content.trim()) {
        throw new Error('Supabase AI không trả về nội dung hợp lệ.');
    }
    return data.content;
}

export function buildReviewPrompt(art) {
    return `${ARTICLE_REVIEW_CRITERIA}

Hãy review toàn bộ dữ liệu bài báo dưới đây. Không bịa số liệu, kết quả, tác giả hoặc trích dẫn. Nếu một trường đang rỗng, vẫn phải nhận xét rõ là còn thiếu và đưa đúng 3 phương án phù hợp dựa trên ngữ cảnh hiện có. Ba phương án Việt/Anh cùng chỉ số phải tương ứng về nghĩa.

Chỉ trả về một JSON hợp lệ, không Markdown, đúng cấu trúc:
{"titleVn":{"feedback":"...","options":["...","...","..."]},"titleEn":{"feedback":"...","options":["...","...","..."]},"abstractVn":{"feedback":"...","options":["...","...","..."]},"abstractEn":{"feedback":"...","options":["...","...","..."]},"keywordsVn":{"feedback":"...","options":["...","...","..."]},"keywordsEn":{"feedback":"...","options":["...","...","..."]},"sections":[{"heading":"Tên đề mục đúng như bài gốc","feedback":"Nhận xét theo IMRAD và trích dẫn","options":["...","...","..."]}]}

Mỗi options phải có đúng 3 chuỗi hoàn chỉnh. Với sections, chỉ nhận xét các đề mục thực sự xuất hiện; nếu nội dung chưa có đề mục thì dùng heading "Nội dung chính".

<ARTICLE_DATA>${JSON.stringify({
        titleVn: art.titleVn || '', titleEn: art.titleEn || '',
        abstractVn: art.abstractVn || '', abstractEn: art.abstractEn || '',
        keywordsVn: art.keywordsVn || '', keywordsEn: art.keywordsEn || '',
        bodyContent: art.bodyContent || ''
    })}</ARTICLE_DATA>`;
}

export function parseAiReviewResult(raw) {
    const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI không trả về JSON hợp lệ.');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const fields = ['titleVn', 'titleEn', 'abstractVn', 'abstractEn', 'keywordsVn', 'keywordsEn'];
    fields.forEach(field => {
        const item = parsed[field];
        if (!item || typeof item.feedback !== 'string' || !Array.isArray(item.options)) {
            throw new Error(`AI trả thiếu dữ liệu review cho ${field}.`);
        }
        item.options = item.options.slice(0, 3).map(value => String(value || '').trim());
        if (item.options.length !== 3 || item.options.some(value => !value)) {
            throw new Error(`AI chưa trả đủ 3 phương án cho ${field}.`);
        }
        item.selected = 'keep';
    });
    parsed.sections = Array.isArray(parsed.sections) ? parsed.sections.map(section => ({
        heading: String(section.heading || 'Nội dung chính').trim(),
        feedback: String(section.feedback || '').trim(),
        options: Array.isArray(section.options) ? section.options.slice(0, 3).map(String) : [],
        selected: 'keep'
    })).filter(section => section.feedback && section.options.length === 3) : [];
    return parsed;
}

export async function runAiReview() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || !state.appState.currentArticleId) {
        showToast("Vui lòng chọn bài viết trước khi phân tích!");
        return false;
    }

    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (!art) return false;

    showToast("Đang kết nối OpenAI để đánh giá bài viết...");
    const statusBadge = document.getElementById('ai-status-badge');
    if (statusBadge) {
        setAiStatusBadge(statusBadge, "Đang chạy...", "px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 rounded-full text-[9px] font-bold animate-bounce");
    }

    try {
        const rawResult = await callLlamaAI(buildReviewPrompt(art));
        art.aiReviewSuggestions = parseAiReviewResult(rawResult);
        saveToLocalStorage();
        renderAiReviewPanel(art);
        showToast("AI Review hoàn tất phân tích cấu trúc bài viết!");
        return true;
    } catch (error) {
        console.error(error);
        if (statusBadge) {
            setAiStatusBadge(statusBadge, "Lỗi AI", "px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[9px] font-bold");
        }
        showToast(error.message || "Không thể hoàn tất AI Review.");
        return false;
    }
}

export function applySelectedSuggestions() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || !state.appState.currentArticleId) return;

    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (!art || !art.aiReviewSuggestions) return;

    const suggestions = art.aiReviewSuggestions;
    let changesMadeCount = 0;

    if (suggestions.titleVn && suggestions.titleVn.selected && suggestions.titleVn.selected !== "keep") {
        const input = document.getElementById('input-title-vn');
        if (input) input.value = suggestions.titleVn.selected;
        art.titleVn = suggestions.titleVn.selected;
        changesMadeCount++;
    }
    if (suggestions.titleEn && suggestions.titleEn.selected && suggestions.titleEn.selected !== "keep") {
        const input = document.getElementById('input-title-en');
        if (input) input.value = suggestions.titleEn.selected;
        art.titleEn = suggestions.titleEn.selected;
        changesMadeCount++;
    }
    if (suggestions.abstractVn && suggestions.abstractVn.selected && suggestions.abstractVn.selected !== "keep") {
        const input = document.getElementById('input-abstract-vn');
        if (input) input.value = suggestions.abstractVn.selected;
        art.abstractVn = suggestions.abstractVn.selected;
        changesMadeCount++;
    }
    if (suggestions.abstractEn && suggestions.abstractEn.selected && suggestions.abstractEn.selected !== "keep") {
        const input = document.getElementById('input-abstract-en');
        if (input) input.value = suggestions.abstractEn.selected;
        art.abstractEn = suggestions.abstractEn.selected;
        changesMadeCount++;
    }
    if (suggestions.keywordsVn && suggestions.keywordsVn.selected && suggestions.keywordsVn.selected !== "keep") {
        const input = document.getElementById('input-keywords-vn');
        if (input) input.value = suggestions.keywordsVn.selected;
        art.keywordsVn = suggestions.keywordsVn.selected;
        changesMadeCount++;
    }
    if (suggestions.keywordsEn && suggestions.keywordsEn.selected && suggestions.keywordsEn.selected !== "keep") {
        const input = document.getElementById('input-keywords-en');
        if (input) input.value = suggestions.keywordsEn.selected;
        art.keywordsEn = suggestions.keywordsEn.selected;
        changesMadeCount++;
    }

    if (suggestions.sections && suggestions.sections.length > 0) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = art.bodyContent || '';
        const hElements = tempDiv.querySelectorAll('h1, h2, h3, table');

        suggestions.sections.forEach((sect, idx) => {
            if (sect.selected && sect.selected !== "keep" && hElements[idx]) {
                const pReplacement = document.createElement('p');
                pReplacement.textContent = sect.selected;
                hElements[idx].insertAdjacentElement('afterend', pReplacement);
                changesMadeCount++;
            }
        });
        art.bodyContent = tempDiv.innerHTML;
    }

    if (changesMadeCount > 0) {
        clearSelectedRadioState(suggestions);
        saveToLocalStorage();
        
        renderLivePreview(art);
        renderArticlesList();
        renderAiReviewPanel(art);

        showToast(`Đã áp dụng thành công ${changesMadeCount} thay đổi học thuật!`);
    } else {
        showToast("Không có thay đổi mới nào được chọn.");
    }
}

export function clearSelectedRadioState(suggestions) {
    if (suggestions.titleVn) suggestions.titleVn.selected = "keep";
    if (suggestions.titleEn) suggestions.titleEn.selected = "keep";
    if (suggestions.abstractVn) suggestions.abstractVn.selected = "keep";
    if (suggestions.abstractEn) suggestions.abstractEn.selected = "keep";
    if (suggestions.keywordsVn) suggestions.keywordsVn.selected = "keep";
    if (suggestions.keywordsEn) suggestions.keywordsEn.selected = "keep";
    if (suggestions.sections) {
        suggestions.sections.forEach(s => s.selected = "keep");
    }
}
