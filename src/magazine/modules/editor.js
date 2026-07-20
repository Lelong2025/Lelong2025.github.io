import { state, saveToLocalStorage } from './state.js';
import { showToast } from './utils.js';
import { loadArticleIntoEditor, recalculateContinuousPages, renderArticlesList, renderLivePreview, updateIssueStatusText, syncArticlePageRangeInputs } from './ui.js';
import { openMediaLibrary } from './cloud.js';

export let quill = null;
export let quillArticleId = null;
export let loadingQuillContent = false;
export let savedQuillRange = null;

export function getQuillInstance() { return quill; }
export function getQuillArticleId() { return quillArticleId; }
export function setQuillArticleId(id) { quillArticleId = id; }
export function getLoadingQuillContent() { return loadingQuillContent; }
export function setLoadingQuillContent(val) { loadingQuillContent = val; }

export let savedEditorRange = null;
export let activeEditorTable = null;
export let activeEditorCell = null;
export let draftTable = null;
export let draftSelection = new Set();
export let draftDragStart = null;
export let draftDragging = false;
export let editorTableSelection = new Set();
export let editorDragStart = null;
export let editorDragging = false;
let activeTableEmbedNode = null;
let embeddedTableSyncTimer = null;
let activeFormulaNode = null;
let formulaToolbarDelegationBound = false;
let draggedFormula = null;
let formulaDropIndex = null;

// Register Quill Custom Table Blot
let QuillBlockEmbed;
if (window.Quill) {
    const Parchment = window.Quill.import('parchment');
    const FontSizeStyle = new Parchment.Attributor.Style('fontSize', 'font-size', {
        scope: Parchment.Scope.INLINE,
        whitelist: ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '32pt']
    });
    const LineHeightStyle = new Parchment.Attributor.Style('lineHeight', 'line-height', {
        scope: Parchment.Scope.BLOCK,
        whitelist: ['1', '1.15', '1.5', '2']
    });
    const TextIndentStyle = new Parchment.Attributor.Style('textIndent', 'text-indent', {
        scope: Parchment.Scope.BLOCK,
        whitelist: ['0.5cm', '1cm', '1.27cm', '1.5cm', '2cm']
    });
    window.Quill.register(FontSizeStyle, true);
    window.Quill.register(LineHeightStyle, true);
    window.Quill.register(TextIndentStyle, true);

    QuillBlockEmbed = window.Quill.import('blots/block/embed');
    class ScientificTableBlot extends QuillBlockEmbed {
        static create(value) {
            const node = super.create();
            node.setAttribute('contenteditable', 'false');
            node.innerHTML = String(value || '');
            node.querySelectorAll('td,th').forEach(cell => cell.setAttribute('contenteditable', 'false'));
            return node;
        }
        static value(node) { return node.innerHTML; }
    }
    ScientificTableBlot.blotName = 'scientificTable';
    ScientificTableBlot.tagName = 'div';
    ScientificTableBlot.className = 'scientific-table-embed';
    window.Quill.register(ScientificTableBlot);

    class MathFormulaBlot extends QuillBlockEmbed {
        static create(value) {
            const node = super.create();
            const latex = typeof value === 'object' ? value.latex : value;
            node.setAttribute('contenteditable', 'false');
            node.dataset.latex = String(latex || '');
            renderFormulaNode(node);
            return node;
        }
        static value(node) { return node.dataset.latex || node.textContent || ''; }
    }
    MathFormulaBlot.blotName = 'mathFormula';
    MathFormulaBlot.tagName = 'div';
    MathFormulaBlot.className = 'math-formula-embed';
    window.Quill.register(MathFormulaBlot);
}

export function initQuill() {
    if (!window.Quill) return;
    quill = new window.Quill('#rich-editor-field', {
        theme: 'snow',
        placeholder: 'Nhập nội dung chính bài viết tại đây...',
        modules: {
            toolbar: '#quill-toolbar',
            imageResize: { displaySize: true }
        }
    });
    const toolbar = quill.getModule('toolbar');
    if (toolbar) {
        toolbar.addHandler('image', () => {
            openMediaLibrary((url) => {
                const range = quill.getSelection(true) || savedQuillRange || { index: quill.getLength() - 1, length: 0 };
                quill.insertEmbed(range.index, 'image', url, 'user');
                quill.setSelection(range.index + 1, 0, 'silent');
                syncRichEditorToState();
            });
        });
    }

    quill.on('text-change', function (_delta, _oldDelta, source) {
        if (loadingQuillContent || source === 'silent') return;
        if (isEventInsideEmbeddedTable()) return;
        syncRichEditorToState();
    });
    quill.on('selection-change', function (range) {
        if (range) savedQuillRange = { index: range.index, length: range.length };
    });

    quill.root.addEventListener('keyup', rememberEditorSelection);
    quill.root.addEventListener('mouseup', rememberEditorSelection);
    quill.root.addEventListener('focusin', rememberEditorSelection);
    quill.root.addEventListener('paste', pasteGridIntoTable);
    quill.root.addEventListener('paste', pasteClipboardTablesIntoQuill, true);
    quill.root.addEventListener('click', handleTableClick);
    quill.root.addEventListener('click', handleFormulaClick);
    quill.root.addEventListener('dragstart', handleFormulaDragStart);
    quill.root.addEventListener('dragover', handleFormulaDragOver);
    quill.root.addEventListener('drop', handleFormulaDrop);
    quill.root.addEventListener('dragend', handleFormulaDragEnd);
    quill.root.addEventListener('input', handleEmbeddedTableInput);
    quill.root.addEventListener('keydown', handleEmbeddedTableKeyDown, true);
    quill.root.addEventListener('beforeinput', handleEmbeddedTableBeforeInput, true);
    quill.root.addEventListener('contextmenu', handleEditorTableContextMenu);
    quill.root.addEventListener('mousedown', handleEditorTableMouseDown);
    quill.root.addEventListener('mouseover', handleEditorTableMouseOver);
    document.addEventListener('click', event => {
        if (!event.target.closest?.('.change-case-menu')) {
            document.getElementById('change-case-options')?.classList.add('hidden');
        }
    });
    document.getElementById('formula-toolbar-button')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openFormulaDialog();
    }, true);
    bindFormulaToolbarDelegation();
    document.getElementById('formula-latex-input')?.addEventListener('input', updateFormulaPreview);
}

export function bindFormulaToolbarDelegation() {
    if (formulaToolbarDelegationBound) return;
    formulaToolbarDelegationBound = true;
    document.addEventListener('pointerdown', event => {
        if (!event.target.closest?.('#formula-toolbar-button')) return;
        event.preventDefault();
        event.stopPropagation();
        openFormulaDialog();
    }, true);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFormulaToolbarDelegation, { once: true });
} else {
    bindFormulaToolbarDelegation();
}

export function applyChangeCase(mode) {
    if (!quill || !mode) return;
    const range = quill.getSelection(true);
    if (!range || range.length === 0) {
        showToast('Hãy chọn đoạn chữ cần đổi kiểu.');
        return;
    }
    const original = quill.getText(range.index, range.length);
    const locale = 'vi-VN';
    const lower = value => value.toLocaleLowerCase(locale);
    const upper = value => value.toLocaleUpperCase(locale);
    const transformWord = (value, invert = false) => value.replace(/(^|[\s\-–—/([{])([\p{L}\p{N}])([\p{L}\p{N}]*)/gu,
        (_, separator, first, rest) => separator + (invert ? lower(first) + upper(rest) : upper(first) + lower(rest)));
    const transforms = {
        lower: value => lower(value),
        sentence: value => lower(value).replace(/(^\s*|[.!?]\s+)([\p{L}\p{N}])/gu,
            (_, prefix, character) => prefix + upper(character)),
        title: value => transformWord(value),
        upper: value => upper(value),
        inverseTitle: value => transformWord(value, true),
        toggle: value => value.replace(/[\p{L}]/gu, character =>
            character === upper(character) ? lower(character) : upper(character))
    };
    const nextText = (transforms[mode] || transforms.sentence)(original);
    const formats = quill.getFormat(range.index, Math.max(1, range.length));
    quill.deleteText(range.index, range.length, 'user');
    quill.insertText(range.index, nextText, formats, 'user');
    quill.setSelection(range.index, nextText.length, 'silent');
    syncRichEditorToState();
}

export function toggleChangeCaseMenu(event) {
    event?.preventDefault();
    event?.stopPropagation();
    const menu = document.getElementById('change-case-options');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

export function chooseChangeCase(mode) {
    const menu = document.getElementById('change-case-options');
    if (menu) menu.classList.add('hidden');
    applyChangeCase(mode);
}

export function normalizeClipboardTable(table, clipboardRoot) {
    const clone = table.cloneNode(true);
    const classRules = new Map();
    clipboardRoot.querySelectorAll('style').forEach(styleNode => {
        const css = styleNode.textContent || '';
        const rulePattern = /\.([\w-]+)\s*\{([^}]+)\}/g;
        let match;
        while ((match = rulePattern.exec(css))) classRules.set(match[1], match[2]);
    });
    [clone, ...clone.querySelectorAll('*')].forEach(element => {
        const inheritedDeclarations = [...element.classList].map(name => classRules.get(name)).filter(Boolean).join(';');
        if (inheritedDeclarations) element.style.cssText = `${inheritedDeclarations};${element.style.cssText}`;
        [...element.attributes].forEach(attribute => {
            if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        });
        element.removeAttribute('class');
        element.removeAttribute('id');
    });
    clone.style.borderCollapse = 'collapse';
    if (!clone.style.width) clone.style.width = '100%';
    clone.dataset.borderMode = 'custom';
    return clone;
}

export function renderFormulaNode(node) {
    if (!node) return;
    const latex = String(node.dataset.latex || '').trim();
    node.classList.add('math-formula-embed');
    node.setAttribute('contenteditable', 'false');
    const editableFormula = Boolean(node.closest?.('#rich-editor-field'));
    node.toggleAttribute('draggable', editableFormula);
    if (editableFormula) node.title = 'Kéo để di chuyển, bấm để sửa công thức';
    if (!latex) {
        node.textContent = 'Equation';
        return;
    }
    node.innerHTML = '';
    const handle = editableFormula ? document.createElement('span') : null;
    if (handle) {
        handle.className = 'formula-drag-handle';
        handle.textContent = '⋮⋮';
        handle.setAttribute('aria-hidden', 'true');
        handle.setAttribute('draggable', 'true');
        node.appendChild(handle);
    }
    const body = document.createElement('span');
    body.className = 'formula-render-body';
    node.appendChild(body);
    if (window.katex?.render) {
        try {
            window.katex.render(latex, body, { throwOnError: false, displayMode: true });
            return;
        } catch (_) {
            // Fallback to readable source below.
        }
    }
    body.textContent = latex;
}

export function renderMathFormulas(root = document) {
    root.querySelectorAll?.('.math-formula-embed').forEach(renderFormulaNode);
}

export function openFormulaDialog(latex = '') {
    const dialog = document.getElementById('formula-dialog');
    const input = document.getElementById('formula-latex-input');
    if (!dialog || !input) return;
    const workspace = document.getElementById('rich-text-workspace');
    if (workspace && !workspace.classList.contains('hidden') && dialog.parentElement !== workspace) {
        workspace.appendChild(dialog);
    }
    closeTableDialog();
    if (quill) {
        savedQuillRange = quill.getSelection(true) || savedQuillRange || { index: quill.getLength() - 1, length: 0 };
    }
    input.value = latex || activeFormulaNode?.dataset?.latex || '';
    dialog.classList.remove('hidden');
    dialog.classList.add('flex');
    updateFormulaPreview();
    setTimeout(() => input.focus(), 0);
}

export function closeFormulaDialog() {
    const dialog = document.getElementById('formula-dialog');
    if (dialog) {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
    }
    activeFormulaNode = null;
}

export function updateFormulaPreview() {
    const input = document.getElementById('formula-latex-input');
    const preview = document.getElementById('formula-preview');
    if (!input || !preview) return;
    preview.dataset.latex = input.value.trim();
    renderFormulaNode(preview);
}

export function insertFormulaSnippet(snippet) {
    const input = document.getElementById('formula-latex-input');
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(snippet, start, end, 'end');
    updateFormulaPreview();
    input.focus();
}

export function insertFormulaAtCursor() {
    if (!quill) return;
    const input = document.getElementById('formula-latex-input');
    const latex = input?.value.trim() || '';
    if (!latex) return showToast('Hay nhap cong thuc truoc khi chen.');
    if (activeFormulaNode) {
        activeFormulaNode.dataset.latex = latex;
        renderFormulaNode(activeFormulaNode);
        syncRichEditorToState();
        closeFormulaDialog();
        return;
    }
    const range = quill.getSelection(true) || savedQuillRange || { index: quill.getLength() - 1, length: 0 };
    let index = Math.max(0, Math.min(range.index, quill.getLength() - 1));
    if (range.length) quill.deleteText(index, range.length, 'user');
    quill.insertEmbed(index, 'mathFormula', latex, 'user');
    quill.insertText(index + 1, '\n', 'user');
    quill.setSelection(index + 2, 0, 'silent');
    savedQuillRange = { index: index + 2, length: 0 };
    syncRichEditorToState();
    closeFormulaDialog();
}

export function handleFormulaClick(event) {
    const formula = event.target.closest?.('#rich-editor-field .math-formula-embed');
    if (!formula) return;
    if (draggedFormula) return;
    event.preventDefault();
    event.stopPropagation();
    activeFormulaNode = formula;
    openFormulaDialog(formula.dataset.latex || formula.textContent || '');
}

export function handleFormulaDragStart(event) {
    const formula = event.target.closest?.('#rich-editor-field .math-formula-embed');
    if (!formula || !quill) return;
    const blot = window.Quill?.find(formula);
    const index = blot ? quill.getIndex(blot) : -1;
    if (index < 0) return;
    draggedFormula = {
        node: formula,
        latex: formula.dataset.latex || '',
        index
    };
    formula.classList.add('formula-dragging');
    quill.root.classList.add('formula-drop-active');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedFormula.latex);
}

export function handleFormulaDragOver(event) {
    if (!draggedFormula) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const formula = event.target.closest?.('#rich-editor-field .math-formula-embed');
    quill.root.querySelectorAll('.formula-drop-before, .formula-drop-after').forEach(node => {
        node.classList.remove('formula-drop-before', 'formula-drop-after');
    });
    if (formula && formula !== draggedFormula.node) {
        const rect = formula.getBoundingClientRect();
        formula.classList.add(event.clientY > rect.top + rect.height / 2 ? 'formula-drop-after' : 'formula-drop-before');
    }
    formulaDropIndex = quillIndexFromPoint(event.clientX, event.clientY);
}

export function handleFormulaDrop(event) {
    if (!draggedFormula || !quill) return;
    event.preventDefault();
    const targetFormula = event.target.closest?.('#rich-editor-field .math-formula-embed');
    let targetIndex = formulaDropIndex ?? quillIndexFromPoint(event.clientX, event.clientY) ?? quill.getLength() - 1;
    if (targetFormula) {
        const targetBlot = window.Quill?.find(targetFormula);
        if (targetBlot) {
            targetIndex = quill.getIndex(targetBlot);
            const rect = targetFormula.getBoundingClientRect();
            if (event.clientY > rect.top + rect.height / 2) targetIndex += 1;
        }
    }
    const sourceIndex = draggedFormula.index;
    const latex = draggedFormula.latex;
    quill.deleteText(sourceIndex, 1, 'user');
    if (sourceIndex < targetIndex) targetIndex -= 1;
    targetIndex = Math.max(0, Math.min(targetIndex, quill.getLength() - 1));
    quill.insertEmbed(targetIndex, 'mathFormula', latex, 'user');
    quill.insertText(targetIndex + 1, '\n', 'user');
    quill.setSelection(targetIndex + 2, 0, 'silent');
    handleFormulaDragEnd();
    syncRichEditorToState();
}

export function handleFormulaDragEnd() {
    quill?.root.classList.remove('formula-drop-active');
    quill?.root.querySelectorAll('.formula-dragging, .formula-drop-before, .formula-drop-after').forEach(node => {
        node.classList.remove('formula-dragging', 'formula-drop-before', 'formula-drop-after');
    });
    draggedFormula = null;
    formulaDropIndex = null;
}

export function quillIndexFromPoint(x, y) {
    if (!quill) return null;
    let range = null;
    if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y);
        if (position) {
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
        }
    }
    if (!range || !quill.root.contains(range.startContainer)) {
        return null;
    }

    let node = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    while (node && node !== quill.root && !window.Quill?.find(node)) {
        node = node.parentElement;
    }
    const blot = node ? window.Quill?.find(node) : null;
    if (!blot) return null;

    const baseIndex = quill.getIndex(blot);
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        return baseIndex + Math.max(0, range.startOffset || 0);
    }
    if (node?.classList?.contains('math-formula-embed') || node?.classList?.contains('scientific-table-embed')) {
        const rect = node.getBoundingClientRect();
        return baseIndex + (y > rect.top + rect.height / 2 ? 1 : 0);
    }
    return baseIndex;
}

function cellTextLength(cell) {
    return (cell.textContent || '').replace(/\s+/g, ' ').trim().length;
}

function hasVisibleTableBorders(table) {
    const borderAttr = parseFloat(table.getAttribute('border') || '0');
    if (borderAttr > 0) return true;
    return Array.from(table.querySelectorAll('td,th')).some(cell => {
        const style = cell.style;
        return ['Top', 'Right', 'Bottom', 'Left'].some(side => {
            const width = parseFloat(style[`border${side}Width`] || '0');
            const borderStyle = style[`border${side}Style`];
            return width > 0 && borderStyle && borderStyle !== 'none';
        });
    });
}

function isLikelyLayoutClipboardTable(table) {
    const cells = Array.from(table.querySelectorAll('td,th'));
    if (!cells.length) return true;
    if (hasVisibleTableBorders(table)) return false;

    const rows = Array.from(table.rows || []);
    const columnCounts = rows.map(row => Array.from(row.cells).reduce((sum, cell) => sum + (cell.colSpan || 1), 0));
    const maxColumns = Math.max(1, ...columnCounts);
    const longProseCells = cells.filter(cell => cellTextLength(cell) > 240).length;
    const paragraphLikeCells = cells.filter(cell => cell.querySelector('p,div,h1,h2,h3,ol,ul') || cellTextLength(cell) > 120).length;

    return longProseCells > 0 || (maxColumns <= 2 && paragraphLikeCells >= Math.max(1, Math.floor(cells.length / 2)));
}

function extractPasteableClipboardTables(root) {
    return Array.from(root.querySelectorAll('table'))
        .filter(table => !isLikelyLayoutClipboardTable(table))
        .map(table => normalizeClipboardTable(table, root));
}

export function tableFromClipboardText(text) {
    if (!text.includes('\t')) return null;
    const rows = text.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1);
    if (!rows.length) return null;
    const tabbedRows = rows.filter(line => line.includes('\t'));
    const consistentTabularRows = tabbedRows.filter(line => {
        const cells = line.split('\t').map(value => value.trim());
        return cells.length > 1 && cells.some(Boolean);
    });
    if (consistentTabularRows.length < 2 && rows.length > 1) return null;
    if (consistentTabularRows.length < rows.filter(line => line.trim()).length / 2) return null;
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    rows.forEach(line => {
        const row = document.createElement('tr');
        line.split('\t').forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            cell.style.border = '1px solid #000';
            cell.style.padding = '4px';
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
    table.appendChild(body);
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.dataset.borderMode = 'custom';
    return table;
}

export function pasteClipboardTablesIntoQuill(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const html = clipboard.getData('text/html');
    const root = document.createElement('div');
    if (html) root.innerHTML = html;
    const clipboardHadHtmlTables = Boolean(html && root.querySelector('table'));
    let tables = html ? extractPasteableClipboardTables(root) : [];
    if (!tables.length && !clipboardHadHtmlTables) {
        const textTable = tableFromClipboardText(clipboard.getData('text/plain') || '');
        if (textTable) tables = [textTable];
    }
    if (!tables.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const range = quill.getSelection() || savedQuillRange || { index: quill.getLength() - 1, length: 0 };
    let index = Math.max(0, Math.min(range.index, quill.getLength() - 1));
    if (range.length) quill.deleteText(index, range.length, 'user');
    tables.forEach(table => {
        quill.insertEmbed(index, 'scientificTable', table.outerHTML, 'user');
        quill.insertText(index + 1, '\n', 'user');
        index += 2;
    });
    quill.setSelection(index, 0, 'silent');
    savedQuillRange = { index, length: 0 };
    syncRichEditorToState();
    showToast(`Đã dán ${tables.length} bảng và giữ định dạng.`);
}

export function openRichTextWorkspace() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || !state.appState.currentArticleId) {
        showToast("Vui lòng chọn bài báo trước!");
        return;
    }

    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (!art) return;

    document.getElementById('workspace-article-title').innerHTML = `<i class="fa-solid fa-file-word mr-1.5 text-blue-500"></i> ${art.titleVn || 'Bài viết chưa đặt tên'}`;
    loadingQuillContent = true;
    if (art.bodyContent) quill.clipboard.dangerouslyPasteHTML(art.bodyContent, 'silent');
    else quill.setText('', 'silent');
    quillArticleId = art.id;
    loadingQuillContent = false;
    quill.root.querySelectorAll('.scientific-table-embed').forEach(embed => embed.setAttribute('contenteditable', 'false'));
    quill.root.querySelectorAll('table').forEach(ensureTableResizeHandles);
    renderMathFormulas(quill.root);

    const workspace = document.getElementById('rich-text-workspace');
    if (workspace) {
        workspace.classList.remove('hidden');
        workspace.classList.add('flex');
    }

    syncWorkspacePreview();
}

export function closeRichTextWorkspace() {
    closeTableDialog();
    syncRichEditorToState();
    const workspace = document.getElementById('rich-text-workspace');
    if (workspace) {
        workspace.classList.add('hidden');
        workspace.classList.remove('flex');
    }

    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (art) {
        loadArticleIntoEditor(art.id);
        refreshPaginationAfterEditorClose(art);
    }
    showToast("Đã lưu và đồng bộ hóa nội dung chính bài báo!");
}

function refreshPaginationAfterEditorClose(art) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(async () => {
        if (document.fonts?.ready) await document.fonts.ready;

        const previewImages = Array.from(document.querySelectorAll('#a4-container img'));
        await Promise.all(previewImages.map(image => {
            if (image.complete) return Promise.resolve();
            return new Promise(resolve => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
            });
        }));

        const currentArticle = state.appState.issues[state.appState.currentIssueId]
            ?.articles.find(item => item.id === art.id);
        if (!currentArticle || state.appState.currentArticleId !== art.id) return;

        renderLivePreview(currentArticle);
        recalculateContinuousPages();
        renderArticlesList();
        saveToLocalStorage();
    }));
}

export function formatDoc(cmd, value = null) {
    const range = quill.getSelection(true);
    if (!range) return;
    const commandMap = {
        bold: ['bold', true], italic: ['italic', true], underline: ['underline', true],
        justifyLeft: ['align', false], justifyCenter: ['align', 'center'],
        justifyRight: ['align', 'right'], justifyFull: ['align', 'justify']
    };
    if (cmd === 'formatBlock') quill.formatLine(range.index, range.length || 1, 'header', /^H([1-3])$/.test(value) ? Number(value.slice(1)) : false, 'user');
    else if (commandMap[cmd]) quill.format(commandMap[cmd][0], commandMap[cmd][1], 'user');
}

export function getCleanRichEditorHtml() {
    const clone = quill.root.cloneNode(true);
    const sourceTables = Array.from(quill.root.querySelectorAll('.scientific-table-embed table'));
    const clonedTables = Array.from(clone.querySelectorAll('.scientific-table-embed table'));
    clonedTables.forEach((table, index) => {
        if (sourceTables[index]) normalizeTableColumnRatios(sourceTables[index], table);
    });
    clone.querySelectorAll('.table-col-resizer, .table-row-resizer').forEach(node => node.remove());
    clone.querySelectorAll('.editor-cell-selected, .draft-cell-selected').forEach(node => {
        node.classList.remove('editor-cell-selected', 'draft-cell-selected');
    });
    clone.querySelectorAll('.scientific-table-embed, td, th').forEach(node => {
        node.removeAttribute('contenteditable');
        node.removeAttribute('data-resize-bound');
    });
    return clone.innerHTML;
}

function cleanTableClone(table, editable = false) {
    const clone = table.cloneNode(true);
    if (!editable) normalizeTableColumnRatios(table, clone);
    clone.querySelectorAll('.table-col-resizer, .table-row-resizer').forEach(node => node.remove());
    clone.querySelectorAll('.editor-cell-selected, .draft-cell-selected').forEach(node => {
        node.classList.remove('editor-cell-selected', 'draft-cell-selected');
    });
    clone.querySelectorAll('td,th').forEach(cell => {
        cell.contentEditable = editable ? 'true' : 'false';
        cell.removeAttribute('data-resize-bound');
    });
    clone.removeAttribute('data-resize-ready');
    return clone;
}

function normalizeTableColumnRatios(sourceTable, targetTable) {
    const columnCount = tableColumnCount(sourceTable);
    if (!columnCount) return;
    const fallbackWidth = sourceTable.getBoundingClientRect().width / columnCount || 1;
    const widths = Array.from({ length: columnCount }, (_, index) => {
        const cells = getCellsInVisualColumn(sourceTable, index).filter(cell => (cell.colSpan || 1) === 1);
        const measured = cells
            .map(cell => cell.getBoundingClientRect().width || parseFloat(cell.style.width) || parseFloat(cell.style.minWidth) || 0)
            .filter(Boolean);
        return measured.length ? Math.max(...measured) : fallbackWidth;
    });
    const total = widths.reduce((sum, width) => sum + width, 0) || columnCount;
    targetTable.querySelector(':scope > colgroup')?.remove();
    const colgroup = document.createElement('colgroup');
    widths.forEach(width => {
        const col = document.createElement('col');
        col.style.width = `${(width / total * 100).toFixed(4)}%`;
        colgroup.appendChild(col);
    });
    targetTable.prepend(colgroup);
    targetTable.querySelectorAll('td,th').forEach(cell => {
        cell.style.width = '';
        cell.style.minWidth = '';
    });
    targetTable.style.width = '100%';
    targetTable.style.tableLayout = 'fixed';
    targetTable.dataset.autofit = 'fixed';
}

function syncTableColgroupToPixels(table) {
    const columnCount = tableColumnCount(table);
    if (!columnCount) return null;
    table.querySelector(':scope > colgroup')?.remove();
    const colgroup = document.createElement('colgroup');
    for (let index = 0; index < columnCount; index += 1) {
        const cells = getCellsInVisualColumn(table, index).filter(cell => (cell.colSpan || 1) === 1);
        const measured = cells
            .map(cell => cell.getBoundingClientRect().width || parseFloat(cell.style.width) || parseFloat(cell.style.minWidth) || 0)
            .filter(Boolean);
        const col = document.createElement('col');
        col.style.width = `${Math.max(32, measured.length ? Math.max(...measured) : table.getBoundingClientRect().width / columnCount || 80)}px`;
        colgroup.appendChild(col);
    }
    table.prepend(colgroup);
    table.style.width = '100%';
    table.style.tableLayout = 'fixed';
    table.dataset.autofit = 'fixed';
    return colgroup;
}

export function syncRichEditorToState() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || !state.appState.currentArticleId) return;

    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (art) {
        art.bodyContent = getCleanRichEditorHtml();
        saveToLocalStorage();
        syncWorkspacePreview();
    }
}

export function syncWorkspacePreview() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (!art) return;

    renderLivePreview(art);

    const originalA4 = document.getElementById('a4-container').innerHTML;
    const targetContainer = document.getElementById('workspace-a4-preview-container');
    if (targetContainer) targetContainer.innerHTML = originalA4;
}

export function rememberEditorSelection() {
    const selection = window.getSelection();
    const editor = quill.root;
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
        savedEditorRange = selection.getRangeAt(0).cloneRange();
        activeEditorTable = selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode.closest?.('table')
            : selection.anchorNode.parentElement?.closest('table');
        activeEditorCell = selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode.closest?.('td, th')
            : selection.anchorNode.parentElement?.closest('td, th');
    }
}

export function restoreEditorSelection() {
    const rangeToRestore = savedEditorRange?.cloneRange();
    quill.focus();
    if (!rangeToRestore) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(rangeToRestore);
    savedEditorRange = rangeToRestore.cloneRange();
}

export function openTableDialog() {
    closeFormulaDialog();
    rememberEditorSelection();
    activeTableEmbedNode = null;
    const dialog = document.getElementById('table-dialog');
    const workspace = document.getElementById('rich-text-workspace');
    if (dialog && workspace && !workspace.classList.contains('hidden') && dialog.parentElement !== workspace) {
        workspace.appendChild(dialog);
    }
    if (dialog) {
        dialog.classList.remove('hidden');
        dialog.classList.add('flex');
    }
    draftTable = null;
    draftSelection.clear();
    const builder = document.getElementById('table-builder-workspace');
    const canvas = document.getElementById('table-draft-canvas');
    const confirmBtn = document.getElementById('confirm-draft-table');
    const rowsInput = document.getElementById('table-row-count');

    if (builder) builder.classList.add('hidden');
    if (canvas) canvas.innerHTML = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (rowsInput) rowsInput.focus();
}

export function openExistingTableEditor(table) {
    if (!table) return;
    closeFormulaDialog();
    const dialog = document.getElementById('table-dialog');
    const workspace = document.getElementById('rich-text-workspace');
    if (dialog && workspace && !workspace.classList.contains('hidden') && dialog.parentElement !== workspace) {
        workspace.appendChild(dialog);
    }
    activeTableEmbedNode = table.closest('.scientific-table-embed');
    activeEditorTable = table;
    draftTable = cleanTableClone(table, true);
    normalizeTableColumnRatios(table, draftTable);
    draftSelection.clear();
    const canvas = document.getElementById('table-draft-canvas');
    const builder = document.getElementById('table-builder-workspace');
    const confirmBtn = document.getElementById('confirm-draft-table');
    const rowsInput = document.getElementById('table-row-count');
    const columnsInput = document.getElementById('table-column-count');
    const autofitInput = document.getElementById('table-autofit');
    if (canvas) canvas.replaceChildren(draftTable);
    if (builder) builder.classList.remove('hidden');
    switchTableBuilderTab('structure');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i>Cập nhật bảng';
    }
    if (rowsInput) rowsInput.value = String(draftTable.rows.length || 1);
    if (columnsInput) columnsInput.value = String(tableColumnCount(draftTable));
    if (autofitInput) autofitInput.value = draftTable.dataset.autofit || 'window';
    ensureTableResizeHandles(draftTable);
    setTableMenuMode('draft');
    if (dialog) {
        dialog.classList.remove('hidden');
        dialog.classList.add('flex');
    }
    bindDraftTableEvents();
    showToast('Đang chỉnh bảng. Bấm Cập nhật bảng để lưu lại vào nội dung.');
}

export function closeTableDialog() {
    const dialog = document.getElementById('table-dialog');
    if (dialog) {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
    }
    const borderMenu = document.getElementById('table-border-menu');
    if (borderMenu) borderMenu.classList.add('hidden');
    activeTableEmbedNode = null;
    const confirmBtn = document.getElementById('confirm-draft-table');
    if (confirmBtn) confirmBtn.innerHTML = '<i class="fa-solid fa-plus mr-1"></i>Thêm vào nội dung';
}

export function switchTableBuilderTab(tabName = 'structure') {
    const workspace = document.getElementById('table-builder-workspace');
    if (!workspace) return;
    workspace.querySelectorAll('[data-table-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.tableTab === tabName);
    });
    workspace.querySelectorAll('[data-table-panel]').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.tablePanel === tabName);
    });
}

function placeTableBorderMenu(mode) {
    const menu = document.getElementById('table-border-menu');
    if (!menu) return null;
    menu.dataset.mode = mode;
    if (mode === 'editor') {
        const workspace = document.getElementById('rich-text-workspace');
        if (workspace && menu.parentElement !== workspace) workspace.appendChild(menu);
    } else {
        const dialog = document.getElementById('table-dialog');
        if (dialog && menu.parentElement !== dialog) dialog.appendChild(menu);
    }
    return menu;
}

export function buildDraftTable() {
    if (draftTable && draftTable.textContent.trim() && !window.confirm('Dựng lại bảng sẽ thay bảng nháp hiện tại bằng bảng trắng. Bạn muốn tiếp tục?')) {
        return;
    }
    const rowCount = Math.min(50, Math.max(1, parseInt(document.getElementById('table-row-count').value, 10) || 1));
    const columnCount = Math.min(20, Math.max(1, parseInt(document.getElementById('table-column-count').value, 10) || 1));
    const table = document.createElement('table');
    table.dataset.borderMode = 'custom';
    applyTableLayout(table, document.getElementById('table-autofit').value);
    const body = document.createElement('tbody');
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const row = document.createElement('tr');
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const cell = createEmptyTableCell();
            cell.contentEditable = 'true';
            row.appendChild(cell);
        }
        body.appendChild(row);
    }
    table.appendChild(body);
    draftTable = table;
    draftSelection.clear();
    const canvas = document.getElementById('table-draft-canvas');
    if (canvas) canvas.replaceChildren(table);
    const builder = document.getElementById('table-builder-workspace');
    const confirmBtn = document.getElementById('confirm-draft-table');
    if (builder) builder.classList.remove('hidden');
    if (confirmBtn) confirmBtn.disabled = false;
    switchTableBuilderTab('structure');
    ensureTableResizeHandles(draftTable);
    setTableMenuMode('draft');
    bindDraftTableEvents();
}

export function draftCellPosition(cell) {
    return getLogicalTableCells(cell.closest('table')).positions.get(cell) || { row: cell.parentElement.rowIndex, column: cell.cellIndex };
}

function tableCellBounds(table, cell) {
    const position = getLogicalTableCells(table).positions.get(cell) || { row: cell.parentElement.rowIndex, column: cell.cellIndex };
    return {
        minRow: position.row,
        maxRow: position.row + Math.max(1, cell.rowSpan || 1) - 1,
        minColumn: position.column,
        maxColumn: position.column + Math.max(1, cell.colSpan || 1) - 1
    };
}

export function selectDraftRectangle(startCell, endCell) {
    if (!startCell || !endCell || startCell.closest('table') !== endCell.closest('table')) return;
    const table = startCell.closest('table');
    const start = draftCellPosition(startCell);
    const end = draftCellPosition(endCell);
    const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column), maxColumn = Math.max(start.column, end.column);
    draftSelection.clear();
    const grid = getLogicalTableCells(table).occupied;
    for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
        for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
            const cell = grid[rowIndex]?.[columnIndex];
            if (cell) draftSelection.add(cell);
        }
    }
    table.querySelectorAll('td,th').forEach(cell => cell.classList.toggle('draft-cell-selected', draftSelection.has(cell)));
}

export function bindDraftTableEvents() {
    draftTable.addEventListener('mousedown', event => {
        if (event.target.closest('.table-col-resizer, .table-row-resizer')) return;
        const cell = event.target.closest('td,th');
        if (!cell || event.button !== 0) return;
        draftDragStart = cell;
        draftDragging = true;
        selectDraftRectangle(cell, cell);
        document.addEventListener('mouseup', () => { draftDragging = false; }, { once: true });
    });
    draftTable.addEventListener('mouseover', event => {
        const cell = event.target.closest('td,th');
        if (draftDragging && cell) selectDraftRectangle(draftDragStart, cell);
    });
    draftTable.addEventListener('contextmenu', event => {
        if (event.target.closest('.table-col-resizer, .table-row-resizer')) return;
        const cell = event.target.closest('td,th');
        if (!cell) return;
        event.preventDefault();
        if (!draftSelection.has(cell)) selectDraftRectangle(cell, cell);
        const menu = placeTableBorderMenu('draft');
        if (menu) {
            menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
            menu.style.top = `${Math.min(event.clientY, window.innerHeight - 230)}px`;
            menu.classList.remove('hidden');
        }
    });
    draftTable.addEventListener('paste', pasteGridIntoDraftTable);
}

export function selectedDraftBounds() {
    if (!draftSelection.size) return null;
    const bounds = [...draftSelection].map(cell => tableCellBounds(draftTable, cell));
    return {
        minRow: Math.min(...bounds.map(item => item.minRow)),
        maxRow: Math.max(...bounds.map(item => item.maxRow)),
        minColumn: Math.min(...bounds.map(item => item.minColumn)),
        maxColumn: Math.max(...bounds.map(item => item.maxColumn))
    };
}

export function mergeDraftSelection() {
    const bounds = selectedDraftBounds();
    if (!bounds || draftSelection.size < 2) return showToast('Hãy kéo chọn ít nhất hai ô liền nhau.');
    const expected = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxColumn - bounds.minColumn + 1);
    if (draftSelection.size !== expected || [...draftSelection].some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) return showToast('Chỉ có thể merge một vùng chữ nhật chưa gộp.');
    const anchor = getLogicalTableCells(draftTable).occupied[bounds.minRow]?.[bounds.minColumn];
    if (!anchor) return;
    const contents = [...draftSelection].filter(cell => cell !== anchor).map(cell => cell.textContent.trim()).filter(Boolean);
    anchor.colSpan = bounds.maxColumn - bounds.minColumn + 1;
    anchor.rowSpan = bounds.maxRow - bounds.minRow + 1;
    if (contents.length) anchor.innerHTML = [anchor.textContent.trim(), ...contents].filter(Boolean).join('<br>');
    [...draftSelection].forEach(cell => { if (cell !== anchor) cell.remove(); });
    draftSelection.clear();
    draftSelection.add(anchor);
    anchor.classList.add('draft-cell-selected');
    ensureTableResizeHandles(draftTable);
}

export function splitDraftCell() {
    if (draftSelection.size !== 1) return showToast('Hãy chọn một ô đã merge để tách.');
    const cell = [...draftSelection][0];
    activeEditorCell = cell;
    activeEditorTable = draftTable;
    splitActiveCell();
    selectDraftRectangle(cell, cell);
    activeEditorTable = null;
    activeEditorCell = null;
    ensureTableResizeHandles(draftTable);
}

export function formatDraftSelection(type, value) {
    if (!draftSelection.size) return showToast('Hãy chọn ô cần định dạng.');
    draftSelection.forEach(cell => {
        if (type === 'align') cell.style.textAlign = value;
        if (type === 'verticalAlign') applyDraftCellVerticalAlign(cell, value);
        if (type === 'fontFamily' && value) cell.style.fontFamily = value;
        if (type === 'fontSize' && value) cell.style.fontSize = value;
        if (type === 'color' && value) cell.style.color = value;
        if (type === 'backgroundColor' && value) cell.style.backgroundColor = value;
        if (type === 'bold') cell.style.fontWeight = cell.style.fontWeight === 'bold' ? 'normal' : 'bold';
        if (type === 'italic') cell.style.fontStyle = cell.style.fontStyle === 'italic' ? 'normal' : 'italic';
        if (type === 'underline') toggleCellDecoration(cell, 'underline');
        if (type === 'strike') toggleCellDecoration(cell, 'line-through');
        if (type === 'case') cell.innerHTML = transformHtmlTextCase(cell.innerHTML, value);
        if (type === 'clear') clearDraftCellFormatting(cell);
    });
}

function applyDraftCellVerticalAlign(cell, value) {
    cell.style.verticalAlign = value;
    cell.style.alignContent = value === 'top' ? 'start' : value === 'bottom' ? 'end' : 'center';
}

function toggleCellDecoration(cell, decoration) {
    const decorations = new Set((cell.style.textDecoration || '').split(/\s+/).filter(Boolean));
    decorations.has(decoration) ? decorations.delete(decoration) : decorations.add(decoration);
    cell.style.textDecoration = [...decorations].join(' ');
}

function clearDraftCellFormatting(cell) {
    const textAlign = cell.style.textAlign;
    const verticalAlign = cell.style.verticalAlign;
    ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration'].forEach(prop => {
        cell.style[prop] = '';
    });
    cell.style.textAlign = textAlign;
    cell.style.verticalAlign = verticalAlign;
}

function transformHtmlTextCase(html, mode) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    let firstTextDone = false;
    const convert = text => {
        if (!mode) return text;
        if (mode === 'lower') return text.toLocaleLowerCase('vi-VN');
        if (mode === 'upper') return text.toLocaleUpperCase('vi-VN');
        if (mode === 'title') {
            return text.toLocaleLowerCase('vi-VN').replace(/(^|[\s\-\/([{])([\p{L}\p{N}])/gu,
                (_, separator, character) => separator + character.toLocaleUpperCase('vi-VN'));
        }
        if (mode === 'inverseTitle') {
            return text.replace(/(^|[\s\-\/([{])([\p{L}\p{N}])([\p{L}\p{N}]*)/gu,
                (_, separator, first, rest) => separator + first.toLocaleLowerCase('vi-VN') + rest.toLocaleUpperCase('vi-VN'));
        }
        if (mode === 'toggle') {
            return Array.from(text).map(character =>
                character === character.toLocaleUpperCase('vi-VN') ? character.toLocaleLowerCase('vi-VN') : character.toLocaleUpperCase('vi-VN')).join('');
        }
        if (mode === 'sentence') {
            const lower = text.toLocaleLowerCase('vi-VN');
            if (firstTextDone) return lower;
            return lower.replace(/([\p{L}\p{N}])/u, match => {
                firstTextDone = true;
                return match.toLocaleUpperCase('vi-VN');
            });
        }
        return text;
    };
    const walk = node => {
        if (node.nodeType === Node.TEXT_NODE) {
            node.nodeValue = convert(node.nodeValue);
            return;
        }
        Array.from(node.childNodes).forEach(walk);
    };
    walk(wrapper);
    return wrapper.innerHTML;
}

function currentDraftBorderStyle() {
    const width = document.getElementById('table-border-width')?.value || '1px';
    const color = document.getElementById('table-border-color')?.value || '#000000';
    return `${width} solid ${color}`;
}

export function applyDraftBorder(mode) {
    const menu = document.getElementById('table-border-menu');
    if (!document.getElementById('table-builder-workspace')?.classList.contains('hidden')) {
        setTableMenuMode('draft');
        if (!draftSelection.size) useDraftTableContext();
    }
    if (menu && !menu.dataset.mode && activeEditorTable) menu.dataset.mode = 'editor';
    if (menu?.dataset.mode !== 'draft' && !editorTableSelection.size && activeEditorCell) {
        selectEditorRectangle(activeEditorCell, activeEditorCell);
    }
    const useEditorSelection = menu?.dataset.mode === 'editor' && editorTableSelection.size > 0;
    const bounds = useEditorSelection ? selectedEditorBounds() : selectedDraftBounds();
    if (!bounds) return;
    const cells = useEditorSelection ? [...editorTableSelection] : [...draftSelection];
    const borderStyle = currentDraftBorderStyle();
    if (mode === 'none') cells.forEach(cell => cell.style.border = '0 solid #000');
    else cells.forEach(cell => {
        const position = useEditorSelection ? editorCellPosition(cell) : draftCellPosition(cell);
        const set = side => cell.style[`border${side}`] = borderStyle;
        if (mode === 'all') cell.style.border = borderStyle;
        if (mode === 'top' && position.row === bounds.minRow) set('Top');
        if (mode === 'bottom' && position.row === bounds.maxRow) set('Bottom');
        if (mode === 'left' && position.column === bounds.minColumn) set('Left');
        if (mode === 'right' && position.column === bounds.maxColumn) set('Right');
        if (mode === 'insideH' && position.row < bounds.maxRow) set('Bottom');
        if (mode === 'insideV' && position.column < bounds.maxColumn) set('Right');
    });
    if (menu) menu.classList.add('hidden');
    if (useEditorSelection) finishTableCellEdit();
}

export function pasteGridIntoDraftTable(event) {
    const startCell = event.target.closest('td,th');
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!startCell || (!text.includes('\t') && !/[\r\n]/.test(text))) return;
    event.preventDefault();
    const grid = text.replace(/\r/g, '').split('\n').filter(Boolean).map(line => line.split('\t'));
    const start = draftCellPosition(startCell);
    grid.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
        const target = draftTable.rows[start.row + rowOffset]?.cells[start.column + columnOffset];
        if (target) target.textContent = value;
    }));
}

export function insertDraftTableAtCursor() {
    if (!draftTable) return;
    const table = cleanTableClone(draftTable, false);
    const targetEmbed = activeTableEmbedNode;
    const tableHtml = table.outerHTML;
    if (targetEmbed && quill.root.contains(targetEmbed)) {
        const blot = window.Quill?.find(targetEmbed);
        const embedIndex = blot ? quill.getIndex(blot) : -1;
        if (embedIndex >= 0) {
            quill.deleteText(embedIndex, 1, 'user');
            quill.insertEmbed(embedIndex, 'scientificTable', tableHtml, 'user');
            quill.setSelection(embedIndex + 1, 0, 'silent');
            closeTableDialog();
            activeEditorTable = null;
            activeEditorCell = null;
            syncRichEditorToState();
            showToast('Đã cập nhật bảng.');
            return;
        }
    }
    const insertionIndex = Math.max(0, Math.min(savedQuillRange?.index ?? (quill.getLength() - 1), quill.getLength() - 1));
    closeTableDialog();
    quill.focus();
    if (savedQuillRange?.length) quill.deleteText(insertionIndex, savedQuillRange.length, 'user');
    quill.insertEmbed(insertionIndex, 'scientificTable', tableHtml, 'user');
    quill.insertText(insertionIndex + 1, '\n', 'user');
    quill.setSelection(insertionIndex + 2, 0, 'silent');
    const tableEmbeds = quill.root.querySelectorAll('.scientific-table-embed table');
    activeEditorTable = tableEmbeds[tableEmbeds.length - 1] || null;
    activeEditorCell = null;
    syncRichEditorToState();
}

export function applyTableLayout(table, mode) {
    table.dataset.autofit = mode;
    table.style.tableLayout = mode === 'fixed' ? 'fixed' : 'auto';
    table.style.width = mode === 'content' ? 'auto' : '100%';
    if (mode === 'fixed' && !table.querySelector('colgroup')) {
        const columnCount = Math.max(1, ...Array.from(table.rows).map(row => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
        const colgroup = document.createElement('colgroup');
        for (let i = 0; i < columnCount; i += 1) {
            const col = document.createElement('col');
            col.style.width = `${100 / columnCount}%`;
            colgroup.appendChild(col);
        }
        table.prepend(colgroup);
    }
}


export function deleteSelectedTable() {
    if (!activeEditorTable || !quill.root.contains(activeEditorTable)) {
        showToast('Hãy đặt con trỏ vào bảng cần xóa.');
        return;
    }
    const table = activeEditorTable;
    const next = table.nextElementSibling;
    table.remove();
    if (next?.tagName === 'P' && !next.textContent.trim() && !next.querySelector('img, table, br')) {
        next.remove();
    }
    activeEditorTable = null;
    activeEditorCell = null;
    savedEditorRange = null;
    closeTableDialog();
    syncRichEditorToState();
    quill.focus();
    showToast('Đã xóa bảng.');
}

export function finishTableCellEdit(message) {
    if (activeEditorTable) {
        activeEditorTable.dataset.borderMode = 'custom';
        ensureTableResizeHandles(activeEditorTable);
        syncRichEditorToState();
    }
    if (message) showToast(message);
}

export function createEmptyTableCell(sourceCell = null) {
    const cell = document.createElement('td');
    cell.innerHTML = '<br>';
    if (!sourceCell || sourceCell.isContentEditable || sourceCell.getAttribute('contenteditable') === 'true') {
        cell.contentEditable = 'true';
    }
    if (sourceCell) {
        if (sourceCell.style.textAlign) cell.style.textAlign = sourceCell.style.textAlign;
        if (sourceCell.style.verticalAlign) cell.style.verticalAlign = sourceCell.style.verticalAlign;
        if (sourceCell.style.fontFamily) cell.style.fontFamily = sourceCell.style.fontFamily;
        if (sourceCell.style.fontSize) cell.style.fontSize = sourceCell.style.fontSize;
        if (sourceCell.style.color) cell.style.color = sourceCell.style.color;
        if (sourceCell.style.backgroundColor) cell.style.backgroundColor = sourceCell.style.backgroundColor;
        if (sourceCell.style.textDecoration) cell.style.textDecoration = sourceCell.style.textDecoration;
        if (sourceCell.style.fontWeight) cell.style.fontWeight = sourceCell.style.fontWeight;
        if (sourceCell.style.fontStyle) cell.style.fontStyle = sourceCell.style.fontStyle;
        const borderStyles = [
            'border', 'borderWidth', 'borderStyle', 'borderColor',
            'borderTop', 'borderTopWidth', 'borderTopStyle', 'borderTopColor',
            'borderBottom', 'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor',
            'borderLeft', 'borderLeftWidth', 'borderLeftStyle', 'borderLeftColor',
            'borderRight', 'borderRightWidth', 'borderRightStyle', 'borderRightColor'
        ];
        borderStyles.forEach(prop => {
            if (sourceCell.style[prop]) {
                cell.style[prop] = sourceCell.style[prop];
            }
        });
    }
    return cell;
}

export function getLogicalTableCells(table) {
    const occupied = [];
    const positions = new Map();
    Array.from(table.rows).forEach((row, rowIndex) => {
        occupied[rowIndex] ||= [];
        let columnIndex = 0;
        Array.from(row.cells).forEach(cell => {
            while (occupied[rowIndex][columnIndex]) columnIndex += 1;
            positions.set(cell, { row: rowIndex, column: columnIndex });
            for (let y = 0; y < cell.rowSpan; y += 1) {
                occupied[rowIndex + y] ||= [];
                for (let x = 0; x < cell.colSpan; x += 1) occupied[rowIndex + y][columnIndex + x] = cell;
            }
            columnIndex += cell.colSpan;
        });
    });
    return { occupied, positions };
}

export function mergeCellRight() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào ô cần gộp.');
    const next = activeEditorCell.nextElementSibling;
    if (!next || !/^(TD|TH)$/.test(next.tagName)) return showToast('Không còn ô bên phải để gộp.');
    if (next.rowSpan !== activeEditorCell.rowSpan) return showToast('Hai ô phải có cùng chiều cao trước khi gộp.');
    const extra = next.innerHTML.replace(/^<br>$/i, '').trim();
    if (extra) activeEditorCell.innerHTML = `${activeEditorCell.innerHTML.replace(/<br>$/i, '')}<br>${extra}`;
    activeEditorCell.colSpan += next.colSpan;
    next.remove();
    finishTableCellEdit('Đã gộp ô sang phải.');
}

export function mergeCellDown() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào ô cần gộp.');
    const grid = getLogicalTableCells(activeEditorTable);
    const position = grid.positions.get(activeEditorCell);
    const targetRowIndex = position.row + activeEditorCell.rowSpan;
    const target = grid.occupied[targetRowIndex]?.[position.column];
    if (!target || target.colSpan !== activeEditorCell.colSpan) return showToast('Ô bên dưới không tương thích để gộp.');
    const extra = target.innerHTML.replace(/^<br>$/i, '').trim();
    if (extra) activeEditorCell.innerHTML = `${activeEditorCell.innerHTML.replace(/<br>$/i, '')}<br>${extra}`;
    activeEditorCell.rowSpan += target.rowSpan;
    target.remove();
    finishTableCellEdit('Đã gộp ô xuống dưới.');
}

export function splitActiveCell() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào ô cần tách.');
    const columnSpan = activeEditorCell.colSpan;
    const rowSpan = activeEditorCell.rowSpan;
    const cellIndex = visualColumnIndex(activeEditorTable, activeEditorCell);
    const sourceCell = activeEditorCell;
    activeEditorCell.colSpan = 1;
    activeEditorCell.rowSpan = 1;
    for (let index = 1; index < columnSpan; index += 1) activeEditorCell.after(createEmptyTableCell(sourceCell));
    let row = activeEditorCell.parentElement;
    for (let rowOffset = 1; rowOffset < rowSpan; rowOffset += 1) {
        row = row.nextElementSibling;
        if (!row) break;
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
            const grid = getLogicalTableCells(activeEditorTable);
            const beforeCell = Array.from(row.cells).find(cell => (grid.positions.get(cell)?.column ?? Infinity) >= cellIndex + columnOffset);
            row.insertBefore(createEmptyTableCell(sourceCell), beforeCell || null);
        }
    }
    finishTableCellEdit('Đã tách ô.');
}

function tableMenuMode() {
    return document.getElementById('table-border-menu')?.dataset.mode || 'editor';
}

function selectedDraftCell() {
    return draftSelection.size ? [...draftSelection][0] : null;
}

function setTableMenuMode(mode) {
    const menu = document.getElementById('table-border-menu');
    if (menu) menu.dataset.mode = mode;
}

function useDraftTableContext() {
    setTableMenuMode('draft');
    if (!draftTable) {
        showToast('Hay mo hoac tao bang truoc.');
        return false;
    }
    if (!draftSelection.size) {
        const firstCell = draftTable.rows[0]?.cells[0];
        if (firstCell) selectDraftRectangle(firstCell, firstCell);
    }
    return true;
}

function activeTableContext() {
    if (tableMenuMode() === 'draft') {
        return { table: draftTable, cell: selectedDraftCell(), mode: 'draft' };
    }
    return { table: activeEditorTable, cell: activeEditorCell, mode: 'editor' };
}

function tableColumnCount(table) {
    return Math.max(...Array.from(table.rows).map(item =>
        Array.from(item.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
}

function visualColumnIndex(table, cell, side = 'left') {
    const grid = getLogicalTableCells(table);
    const position = grid.positions.get(cell);
    if (!position) return cell.cellIndex;
    return position.column + (side === 'right' ? Math.max(1, cell.colSpan || 1) : 0);
}

function insertVisualTableColumn(table, index, sourceCell) {
    const grid = getLogicalTableCells(table);
    Array.from(table.rows).forEach((row, rowIndex) => {
        const spanningCell = grid.occupied[rowIndex]?.[index];
        const spanningPosition = spanningCell ? grid.positions.get(spanningCell) : null;
        if (spanningCell && spanningPosition?.column < index) {
            spanningCell.colSpan += 1;
            return;
        }
        const newCell = createEmptyTableCell(sourceCell);
        newCell.contentEditable = 'true';
        const beforeCell = Array.from(row.cells).find(cell => (grid.positions.get(cell)?.column ?? Infinity) >= index);
        row.insertBefore(newCell, beforeCell || null);
    });
}

function deleteVisualTableColumn(table, index) {
    const grid = getLogicalTableCells(table);
    const touched = new Set();
    Array.from(table.rows).forEach((row, rowIndex) => {
        const cell = grid.occupied[rowIndex]?.[index];
        if (!cell || touched.has(cell)) return;
        touched.add(cell);
        if ((cell.colSpan || 1) > 1) cell.colSpan -= 1;
        else cell.remove();
    });
}

function finishTableStructureEdit(message, mode) {
    const menu = document.getElementById('table-border-menu');
    if (menu) menu.classList.add('hidden');
    if (mode === 'draft') {
        normalizeTableColumnRatios(draftTable, draftTable);
        ensureTableResizeHandles(draftTable);
        return;
    }
    if (activeEditorTable) normalizeTableColumnRatios(activeEditorTable, activeEditorTable);
    finishTableCellEdit(message);
}

function insertVisualTableRow(table, targetIndex, sourceCell) {
    const columnCount = tableColumnCount(table);
    const grid = getLogicalTableCells(table);
    const newRow = table.insertRow(Math.max(0, Math.min(targetIndex, table.rows.length)));
    const expandedSpans = new Set();
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const spanningCell = grid.occupied[targetIndex]?.[columnIndex];
        const spanningPosition = spanningCell ? grid.positions.get(spanningCell) : null;
        if (spanningCell && spanningPosition?.row < targetIndex) {
            if (!expandedSpans.has(spanningCell)) {
                spanningCell.rowSpan += 1;
                expandedSpans.add(spanningCell);
            }
            continue;
        }
        const newCell = createEmptyTableCell(sourceCell);
        newCell.contentEditable = 'true';
        newRow.appendChild(newCell);
    }
    return newRow;
}

function deleteVisualTableRow(table, rowIndex) {
    const grid = getLogicalTableCells(table);
    const row = table.rows[rowIndex];
    if (!row) return false;
    const coveringCells = new Set((grid.occupied[rowIndex] || []).filter(Boolean));
    const unsafeOrigin = [...coveringCells].find(cell => {
        const position = grid.positions.get(cell);
        return position?.row === rowIndex && (cell.rowSpan || 1) > 1;
    });
    if (unsafeOrigin) {
        showToast('Hay tach o merge doc truoc khi xoa hang nay.');
        return false;
    }
    coveringCells.forEach(cell => {
        const position = grid.positions.get(cell);
        if (position?.row < rowIndex && (cell.rowSpan || 1) > 1) {
            cell.rowSpan -= 1;
        }
    });
    table.deleteRow(rowIndex);
    return true;
}

export function insertDraftRowAbove() {
    if (!useDraftTableContext()) return;
    insertTableRowAbove();
}

export function insertDraftRowBelow() {
    if (!useDraftTableContext()) return;
    insertTableRowBelow();
}

export function insertDraftColumnLeft() {
    if (!useDraftTableContext()) return;
    insertTableColumnLeft();
}

export function insertDraftColumnRight() {
    if (!useDraftTableContext()) return;
    insertTableColumnRight();
}

export function deleteDraftRow() {
    if (!useDraftTableContext()) return;
    deleteTableRow();
    ensureTableResizeHandles(draftTable);
}

export function deleteDraftColumn() {
    if (!useDraftTableContext()) return;
    deleteTableColumn();
    ensureTableResizeHandles(draftTable);
}

export function distributeDraftColumns() {
    if (!useDraftTableContext()) return;
    const columnCount = tableColumnCount(draftTable);
    draftTable.querySelector(':scope > colgroup')?.remove();
    const colgroup = document.createElement('colgroup');
    for (let index = 0; index < columnCount; index += 1) {
        const col = document.createElement('col');
        col.style.width = `${100 / columnCount}%`;
        colgroup.appendChild(col);
    }
    draftTable.prepend(colgroup);
    draftTable.style.width = '100%';
    draftTable.style.tableLayout = 'fixed';
    draftTable.dataset.autofit = 'fixed';
    draftTable.querySelectorAll('td,th').forEach(cell => {
        cell.style.width = '';
        cell.style.minWidth = '';
    });
    ensureTableResizeHandles(draftTable);
    showToast('Da chia deu cot.');
}

export function distributeDraftRows() {
    if (!useDraftTableContext()) return;
    const rows = Array.from(draftTable.rows);
    const height = Math.max(34, ...rows.map(row => row.getBoundingClientRect().height || parseFloat(row.style.height) || 34));
    rows.forEach(row => {
        row.style.height = `${height}px`;
    });
    ensureTableResizeHandles(draftTable);
    showToast('Da chia deu hang.');
}

export function deleteDraftTableFromArticle() {
    if (!window.confirm('Xóa bảng này khỏi nội dung?')) return;
    if (activeTableEmbedNode && quill?.root.contains(activeTableEmbedNode)) {
        const blot = window.Quill?.find(activeTableEmbedNode);
        const embedIndex = blot ? quill.getIndex(blot) : -1;
        if (embedIndex >= 0) {
            quill.deleteText(embedIndex, 1, 'user');
            closeTableDialog();
            activeTableEmbedNode = null;
            activeEditorTable = null;
            activeEditorCell = null;
            syncRichEditorToState();
            showToast('Da xoa bang.');
            return;
        }
    }
    draftTable = null;
    draftSelection.clear();
    document.getElementById('table-draft-canvas')?.replaceChildren();
    closeTableDialog();
}

export function insertTableRow(position = 'below') {
    const { table, cell, mode } = activeTableContext();
    if (!table || !cell) return showToast('Hay chon mot o trong bang.');
    const rowIndex = cell.parentElement.rowIndex;
    const targetIndex = position === 'above' ? rowIndex : rowIndex + 1;
    const newRow = insertVisualTableRow(table, targetIndex, cell);
    if (mode === 'draft' && newRow.cells[0]) selectDraftRectangle(newRow.cells[0], newRow.cells[0]);
    finishTableStructureEdit(position === 'above' ? 'Da them hang tren.' : 'Da them hang duoi.', mode);
}

export function insertTableRowAbove() {
    insertTableRow('above');
}

export function insertTableRowBelow() {
    insertTableRow('below');
}

export function addTableRow() {
    return insertTableRowBelow();
}

export function deleteTableRow() {
    if (tableMenuMode() === 'draft') {
        const cell = selectedDraftCell();
        if (!draftTable || !cell) return showToast('Hay chon hang can xoa.');
        if (draftTable.rows.length <= 1) return showToast('Bang can it nhat mot hang.');
        const rowIndex = cell.parentElement.rowIndex;
        if (!deleteVisualTableRow(draftTable, rowIndex)) return;
        draftSelection.clear();
        const nextCell = draftTable.rows[Math.min(rowIndex, draftTable.rows.length - 1)]?.cells[0];
        if (nextCell) selectDraftRectangle(nextCell, nextCell);
        normalizeTableColumnRatios(draftTable, draftTable);
        ensureTableResizeHandles(draftTable);
        document.getElementById('table-border-menu')?.classList.add('hidden');
        return;
    }
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào hàng cần xóa.');
    if (activeEditorTable.rows.length === 1) return deleteSelectedTable();
    const rowIndex = activeEditorCell.parentElement.rowIndex;
    if (!deleteVisualTableRow(activeEditorTable, rowIndex)) return;
    activeEditorCell = null;
    finishTableCellEdit('Đã xóa hàng.');
}

export function insertTableColumn(position = 'right') {
    const { table, cell, mode } = activeTableContext();
    if (!table || !cell) return showToast('Hay chon mot o trong bang.');
    const rowIndex = cell.parentElement.rowIndex;
    const insertIndex = visualColumnIndex(table, cell, position);
    insertVisualTableColumn(table, insertIndex, cell);
    if (mode === 'draft') {
        const grid = getLogicalTableCells(table);
        const selected = grid.occupied[rowIndex]?.[insertIndex] || table.rows[rowIndex]?.cells[Math.min(insertIndex, table.rows[rowIndex].cells.length - 1)];
        if (selected) selectDraftRectangle(selected, selected);
    }
    finishTableStructureEdit(position === 'left' ? 'Da them cot trai.' : 'Da them cot phai.', mode);
}

export function insertTableColumnLeft() {
    insertTableColumn('left');
}

export function insertTableColumnRight() {
    insertTableColumn('right');
}

export function addTableColumn() {
    return insertTableColumnRight();
}

export function deleteTableColumn() {
    if (tableMenuMode() === 'draft') {
        const cell = selectedDraftCell();
        if (!draftTable || !cell) return showToast('Hay chon cot can xoa.');
        const columnIndex = visualColumnIndex(draftTable, cell);
        const maxColumns = tableColumnCount(draftTable);
        if (maxColumns <= 1) return showToast('Bang can it nhat mot cot.');
        deleteVisualTableColumn(draftTable, columnIndex);
        draftSelection.clear();
        const nextCell = draftTable.rows[0]?.cells[Math.min(columnIndex, draftTable.rows[0].cells.length - 1)];
        if (nextCell) selectDraftRectangle(nextCell, nextCell);
        normalizeTableColumnRatios(draftTable, draftTable);
        ensureTableResizeHandles(draftTable);
        document.getElementById('table-border-menu')?.classList.add('hidden');
        return;
    }
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào cột cần xóa.');
    const index = visualColumnIndex(activeEditorTable, activeEditorCell);
    deleteVisualTableColumn(activeEditorTable, index);
    activeEditorCell = null;
    finishTableCellEdit('Đã xóa cột.');
}

export function formatActiveCell(type, value) {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào ô cần định dạng.');
    if (type === 'align') activeEditorCell.style.textAlign = value;
    if (type === 'bold') activeEditorCell.style.fontWeight = activeEditorCell.style.fontWeight === 'bold' ? 'normal' : 'bold';
    if (type === 'italic') activeEditorCell.style.fontStyle = activeEditorCell.style.fontStyle === 'italic' ? 'normal' : 'italic';
    finishTableCellEdit();
}

export function toggleActiveCellBorder(side) {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào ô cần định dạng.');
    const property = `border${side[0].toUpperCase()}${side.slice(1)}`;
    activeEditorCell.style[property] = activeEditorCell.style[property]?.includes('1px') ? '0 solid #000' : '1px solid #000';
    finishTableCellEdit();
}

export function clearEditorTableSelection() {
    editorTableSelection.forEach(cell => cell.classList.remove('editor-cell-selected'));
    editorTableSelection.clear();
}

function editorCellPosition(cell) {
    return getLogicalTableCells(cell.closest('table')).positions.get(cell) || { row: cell.parentElement.rowIndex, column: cell.cellIndex };
}

export function selectEditorRectangle(startCell, endCell) {
    if (!startCell || !endCell || startCell.closest('table') !== endCell.closest('table')) return;
    const table = startCell.closest('table');
    const start = editorCellPosition(startCell);
    const end = editorCellPosition(endCell);
    const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column), maxColumn = Math.max(start.column, end.column);
    clearEditorTableSelection();
    const grid = getLogicalTableCells(table).occupied;
    for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
        for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
            const cell = grid[rowIndex]?.[columnIndex];
            if (cell) editorTableSelection.add(cell);
        }
    }
    editorTableSelection.forEach(cell => cell.classList.add('editor-cell-selected'));
    activeEditorTable = table;
    activeEditorCell = startCell;
}

export function selectedEditorBounds() {
    if (!editorTableSelection.size) return null;
    const positions = [...editorTableSelection].map(cell => tableCellBounds(activeEditorTable || cell.closest('table'), cell));
    return {
        minRow: Math.min(...positions.map(item => item.minRow)),
        maxRow: Math.max(...positions.map(item => item.maxRow)),
        minColumn: Math.min(...positions.map(item => item.minColumn)),
        maxColumn: Math.max(...positions.map(item => item.maxColumn))
    };
}

export function handleEmbeddedTableInput(event) {
    const table = event.target.closest?.('#rich-editor-field table');
    if (!table) return;
    event.stopPropagation();
    activeEditorTable = table;
    activeEditorCell = event.target.closest('td, th') || activeEditorCell;
    ensureTableResizeHandles(table);
    scheduleEmbeddedTableSync();
}

export function isEventInsideEmbeddedTable() {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest?.('#rich-editor-field .scientific-table-embed table'));
}

export function scheduleEmbeddedTableSync() {
    window.clearTimeout(embeddedTableSyncTimer);
    embeddedTableSyncTimer = window.setTimeout(() => {
        if (activeEditorTable) {
            ensureTableResizeHandles(activeEditorTable);
            syncRichEditorToState();
        }
    }, 180);
}

export function handleEmbeddedTableKeyDown(event) {
    const cell = event.target.closest?.('#rich-editor-field td, #rich-editor-field th');
    if (!cell || event.target.closest('.table-col-resizer, .table-row-resizer')) return;
    activeEditorTable = cell.closest('table');
    activeEditorCell = cell;
    event.stopPropagation();
}

export function handleEmbeddedTableBeforeInput(event) {
    const cell = event.target.closest?.('#rich-editor-field td, #rich-editor-field th');
    if (!cell) return;
    activeEditorTable = cell.closest('table');
    activeEditorCell = cell;
    event.stopPropagation();
}

export function handleEditorTableMouseDown(event) {
    const cell = event.target.closest?.('#rich-editor-field td, #rich-editor-field th');
    if (!cell || event.button !== 0 || event.target.closest('.table-col-resizer, .table-row-resizer')) return;
    activeEditorTable = cell.closest('table');
    activeEditorCell = cell;
    ensureTableResizeHandles(activeEditorTable);
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        editorDragStart = cell;
        editorDragging = true;
        selectEditorRectangle(cell, cell);
        document.addEventListener('mouseup', () => { editorDragging = false; }, { once: true });
    } else {
        clearEditorTableSelection();
    }
}

export function handleEditorTableMouseOver(event) {
    const cell = event.target.closest?.('#rich-editor-field td, #rich-editor-field th');
    if (editorDragging && editorDragStart && cell) selectEditorRectangle(editorDragStart, cell);
}

export function handleEditorTableContextMenu(event) {
    const cell = event.target.closest?.('#rich-editor-field td, #rich-editor-field th');
    if (!cell) return;
    event.preventDefault();
    activeEditorTable = cell.closest('table');
    activeEditorCell = cell;
    ensureTableResizeHandles(activeEditorTable);
    if (!editorTableSelection.has(cell)) selectEditorRectangle(cell, cell);
    const menu = placeTableBorderMenu('editor');
    if (menu) {
        menu.style.left = `${Math.min(event.clientX, window.innerWidth - 230)}px`;
        menu.style.top = `${Math.min(event.clientY, window.innerHeight - 280)}px`;
        menu.classList.remove('hidden');
    }
}

export function mergeSelectedTableCells() {
    const menu = document.getElementById('table-border-menu');
    if (menu?.dataset.mode === 'draft') return mergeDraftSelection();
    const bounds = selectedEditorBounds();
    if (!activeEditorTable || !bounds || editorTableSelection.size < 2) return showToast('Hay chon it nhat hai o can merge.');
    const expected = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxColumn - bounds.minColumn + 1);
    if (editorTableSelection.size !== expected || [...editorTableSelection].some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) {
        return showToast('Chi co the merge mot vung chu nhat chua gop.');
    }
    const anchor = activeEditorTable.rows[bounds.minRow]?.cells[bounds.minColumn];
    if (!anchor || !editorTableSelection.has(anchor)) return;
    const contents = [...editorTableSelection].filter(cell => cell !== anchor).map(cell => cell.textContent.trim()).filter(Boolean);
    anchor.colSpan = bounds.maxColumn - bounds.minColumn + 1;
    anchor.rowSpan = bounds.maxRow - bounds.minRow + 1;
    if (contents.length) anchor.innerHTML = [anchor.textContent.trim(), ...contents].filter(Boolean).join('<br>');
    [...editorTableSelection].forEach(cell => { if (cell !== anchor) cell.remove(); });
    clearEditorTableSelection();
    editorTableSelection.add(anchor);
    anchor.classList.add('editor-cell-selected');
    activeEditorCell = anchor;
    if (menu) menu.classList.add('hidden');
    finishTableCellEdit('Da merge o.');
}

export function splitSelectedTableCell() {
    const menu = document.getElementById('table-border-menu');
    if (menu?.dataset.mode === 'draft') return splitDraftCell();
    const cell = editorTableSelection.size === 1 ? [...editorTableSelection][0] : activeEditorCell;
    if (!cell) return showToast('Hay chon mot o da merge de tach.');
    activeEditorCell = cell;
    activeEditorTable = cell.closest('table');
    splitActiveCell();
    clearEditorTableSelection();
    editorTableSelection.add(cell);
    cell.classList.add('editor-cell-selected');
    if (menu) menu.classList.add('hidden');
}

export function handleTableClick(event) {
    const table = event.target.closest?.('#rich-editor-field table');
    if (!table) {
        return;
    }
    if (!event.target.closest('.table-col-resizer, .table-row-resizer')) {
        event.preventDefault();
        event.stopPropagation();
        openExistingTableEditor(table);
        return;
    }
    activeEditorTable = table;
    activeEditorCell = event.target.closest('td, th');
    ensureTableResizeHandles(table);
}

export function getCellVisualColumnIndex(table, cell) {
    const numRows = table.rows.length;
    const grid = [];
    for (let r = 0; r < numRows; r++) grid[r] = [];

    for (let r = 0; r < numRows; r++) {
        const row = table.rows[r];
        let cVisual = 0;
        for (let c = 0; c < row.cells.length; c++) {
            const curCell = row.cells[c];
            while (grid[r][cVisual] !== undefined) {
                cVisual++;
            }
            const colSpan = curCell.colSpan || 1;
            const rowSpan = curCell.rowSpan || 1;
            for (let rs = 0; rs < rowSpan; rs++) {
                for (let cs = 0; cs < colSpan; cs++) {
                    if (r + rs < numRows) {
                        grid[r + rs][cVisual + cs] = curCell;
                    }
                }
            }
            if (curCell === cell) {
                return cVisual + colSpan - 1;
            }
            cVisual += colSpan;
        }
    }
    return -1;
}

export function getCellsInVisualColumn(table, colIndex) {
    const cells = [];
    const grid = [];
    const numRows = table.rows.length;
    for (let r = 0; r < numRows; r++) grid[r] = [];

    for (let r = 0; r < numRows; r++) {
        const row = table.rows[r];
        let cVisual = 0;
        for (let c = 0; c < row.cells.length; c++) {
            const cell = row.cells[c];
            while (grid[r][cVisual] !== undefined) {
                cVisual++;
            }
            const colSpan = cell.colSpan || 1;
            const rowSpan = cell.rowSpan || 1;
            for (let rs = 0; rs < rowSpan; rs++) {
                for (let cs = 0; cs < colSpan; cs++) {
                    if (r + rs < numRows) {
                        grid[r + rs][cVisual + cs] = cell;
                    }
                }
            }
            cVisual += colSpan;
        }
    }

    for (let r = 0; r < numRows; r++) {
        const cell = grid[r][colIndex];
        if (cell && !cells.includes(cell)) {
            cells.push(cell);
        }
    }
    return cells;
}

export function ensureTableResizeHandles(table) {
    if (!table) return;
    const isDraftTable = Boolean(table.closest('#table-draft-canvas'));
    table.dataset.resizeReady = 'true';
    table.style.position = table.style.position || 'relative';
    table.closest('.scientific-table-embed')?.setAttribute('contenteditable', 'false');
    Array.from(table.rows).forEach(row => {
        if (!row.style.height) row.style.height = `${Math.max(34, row.getBoundingClientRect().height || 34)}px`;
        Array.from(row.cells).forEach(cell => {
            cell.style.position = 'relative';
            cell.contentEditable = isDraftTable ? 'true' : 'false';
            if (isDraftTable && cell.style.verticalAlign) {
                cell.style.alignContent = cell.style.verticalAlign === 'top' ? 'start' : cell.style.verticalAlign === 'bottom' ? 'end' : 'center';
            }
            let colHandle = cell.querySelector(':scope > .table-col-resizer');
            if (!colHandle) {
                colHandle = document.createElement('span');
                colHandle.className = 'table-col-resizer';
                cell.appendChild(colHandle);
            }
            colHandle.contentEditable = 'false';
            colHandle.setAttribute('draggable', 'false');
            cell.appendChild(colHandle);
            if (colHandle.dataset.resizeBound !== 'true') {
                colHandle.dataset.resizeBound = 'true';
                colHandle.addEventListener('dragstart', event => event.preventDefault());
                colHandle.addEventListener('mousedown', event => startColumnResize(event, table, cell));
            }

            let rowHandle = cell.querySelector(':scope > .table-row-resizer');
            if (!rowHandle) {
                rowHandle = document.createElement('span');
                rowHandle.className = 'table-row-resizer';
                cell.appendChild(rowHandle);
            }
            rowHandle.contentEditable = 'false';
            rowHandle.setAttribute('draggable', 'false');
            cell.appendChild(rowHandle);
            if (rowHandle.dataset.resizeBound !== 'true') {
                rowHandle.dataset.resizeBound = 'true';
                rowHandle.addEventListener('dragstart', event => event.preventDefault());
                rowHandle.addEventListener('mousedown', event => startRowResize(event, table, cell.parentElement));
            }
        });
    });
}

export function startColumnResize(event, table, cell) {
    event.preventDefault();
    event.stopPropagation();
    const isDraftTable = Boolean(table.closest('#table-draft-canvas'));
    table.classList.add('table-resizing');
    table.style.tableLayout = 'fixed';
    const colgroup = syncTableColgroupToPixels(table);
    const startX = event.clientX;
    const vColIndex = getCellVisualColumnIndex(table, cell);
    if (vColIndex === -1) {
        table.classList.remove('table-resizing');
        return;
    }

    const colCells = getCellsInVisualColumn(table, vColIndex);
    const colSpan1Cells = colCells.filter(c => (c.colSpan || 1) === 1);
    const referenceCell = colSpan1Cells.includes(cell) ? cell : (colSpan1Cells[0] || cell);
    const startWidth = referenceCell.getBoundingClientRect().width;
    const col = colgroup?.children?.[vColIndex] || null;
    const neighborIndex = vColIndex < (colgroup?.children.length || 0) - 1 ? vColIndex + 1 : vColIndex - 1;
    const neighbor = neighborIndex >= 0 ? colgroup?.children?.[neighborIndex] || null : null;
    const neighborStartWidth = neighbor ? parseFloat(neighbor.style.width) || 0 : 0;

    const move = (moveEvent) => {
        moveEvent.preventDefault();
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(32, startWidth + delta);
        const nextNeighborWidth = neighbor ? Math.max(32, neighborStartWidth - delta) : 0;
        if (col) col.style.width = `${nextWidth}px`;
        if (neighbor) neighbor.style.width = `${nextNeighborWidth}px`;
        colSpan1Cells.forEach(target => {
            target.style.width = `${nextWidth}px`;
            target.style.minWidth = `${nextWidth}px`;
        });
        if (neighbor) {
            getCellsInVisualColumn(table, neighborIndex).filter(c => (c.colSpan || 1) === 1).forEach(target => {
                target.style.width = `${nextNeighborWidth}px`;
                target.style.minWidth = `${nextNeighborWidth}px`;
            });
        }
        if (colSpan1Cells.length === 0) {
            cell.style.width = `${nextWidth}px`;
            cell.style.minWidth = `${nextWidth}px`;
        }
    };
    const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        table.classList.remove('table-resizing');
        if (!isDraftTable) syncRichEditorToState();
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
}

export function startRowResize(event, _table, row) {
    event.preventDefault();
    event.stopPropagation();
    const table = row.closest('table');
    const isDraftTable = Boolean(table?.closest('#table-draft-canvas'));
    table?.classList.add('table-resizing');
    const startY = event.clientY;
    const startHeight = row.getBoundingClientRect().height;
    const move = (moveEvent) => {
        moveEvent.preventDefault();
        row.style.height = `${Math.max(24, startHeight + moveEvent.clientY - startY)}px`;
    };
    const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        table?.classList.remove('table-resizing');
        if (!isDraftTable) syncRichEditorToState();
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
}

export function pasteGridIntoTable(event) {
    const cell = event.target.closest?.('td, th');
    if (!cell) return;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n') && !text.includes('\r')) return;
    const grid = text.replace(/\r/g, '').split('\n').filter((line, index, lines) => line || index < lines.length - 1)
        .map(line => line.split('\t'));
    if (!grid.length) return;
    event.preventDefault();
    const table = cell.closest('table');
    const startRow = cell.parentElement.rowIndex;
    const startColumn = cell.cellIndex;
    grid.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
        const targetCell = table.rows[startRow + rowOffset]?.cells[startColumn + columnOffset];
        if (targetCell) targetCell.textContent = value;
    }));
    activeEditorTable = table;
    syncRichEditorToState();
}

export function updateCurrentArticlePages(val) {
    const pageBudget = parseInt(val) || 1;
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || !state.appState.currentArticleId) return;

    const art = currentIssue.articles.find(a => a.id === state.appState.currentArticleId);
    if (art) {
        art.pageCount = pageBudget;
        recalculateContinuousPages();
        renderArticlesList();
        renderLivePreview(art);
        syncArticlePageRangeInputs(art);
        saveToLocalStorage();

        const calcText = document.getElementById('form-calculated-pages');
        if (calcText) updateIssueStatusText();
        updateIssueStatusText();
        const headerMeta = document.getElementById('preview-header-meta');
        if (headerMeta) headerMeta.textContent = 'Tạp chí Khoa học Lạc Hồng, 2025, 20, 001-005';
    }
}
