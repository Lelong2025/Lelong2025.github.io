import { state, saveToLocalStorage } from './state.js';
import { showToast } from './utils.js';
import { loadArticleIntoEditor, recalculateContinuousPages, renderArticlesList, renderLivePreview, updateIssueStatusText } from './ui.js';
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
let embeddedTableSyncTimer = null;
export const tableBorderIds = ['top', 'bottom', 'left', 'right', 'inside-h', 'inside-v', 'header'];

// Register Quill Custom Table Blot
let QuillBlockEmbed;
if (window.Quill) {
    const Parchment = window.Quill.import('parchment');
    const TextIndentStyle = new Parchment.Attributor.Style('textIndent', 'text-indent', {
        scope: Parchment.Scope.BLOCK,
        whitelist: ['0.5cm', '1cm', '1.27cm', '1.5cm', '2cm']
    });
    window.Quill.register(TextIndentStyle, true);

    QuillBlockEmbed = window.Quill.import('blots/block/embed');
    class ScientificTableBlot extends QuillBlockEmbed {
        static create(value) {
            const node = super.create();
            node.setAttribute('contenteditable', 'true');
            node.innerHTML = String(value || '');
            node.querySelectorAll('td,th').forEach(cell => cell.setAttribute('contenteditable', 'true'));
            return node;
        }
        static value(node) { return node.innerHTML; }
    }
    ScientificTableBlot.blotName = 'scientificTable';
    ScientificTableBlot.tagName = 'div';
    ScientificTableBlot.className = 'scientific-table-embed';
    window.Quill.register(ScientificTableBlot);
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
    quill.root.addEventListener('input', handleEmbeddedTableInput);
    quill.root.addEventListener('keydown', handleEmbeddedTableKeyDown, true);
    quill.root.addEventListener('beforeinput', handleEmbeddedTableBeforeInput, true);
    quill.root.addEventListener('contextmenu', handleEditorTableContextMenu);
    quill.root.addEventListener('mousedown', handleEditorTableMouseDown);
    quill.root.addEventListener('mouseover', handleEditorTableMouseOver);
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

export function tableFromClipboardText(text) {
    if (!text.includes('\t')) return null;
    const rows = text.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1);
    if (!rows.length) return null;
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
    let tables = html ? Array.from(root.querySelectorAll('table')).map(table => normalizeClipboardTable(table, root)) : [];
    if (!tables.length) {
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
    quill.root.querySelectorAll('.scientific-table-embed').forEach(embed => embed.setAttribute('contenteditable', 'true'));
    quill.root.querySelectorAll('table').forEach(ensureTableResizeHandles);

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
    rememberEditorSelection();
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

export function closeTableDialog() {
    const dialog = document.getElementById('table-dialog');
    if (dialog) {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
    }
    const borderMenu = document.getElementById('table-border-menu');
    if (borderMenu) borderMenu.classList.add('hidden');
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
    bindDraftTableEvents();
}

export function draftCellPosition(cell) {
    return { row: cell.parentElement.rowIndex, column: cell.cellIndex };
}

export function selectDraftRectangle(startCell, endCell) {
    const start = draftCellPosition(startCell);
    const end = draftCellPosition(endCell);
    const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column), maxColumn = Math.max(start.column, end.column);
    draftSelection.clear();
    Array.from(draftTable.rows).forEach((row, rowIndex) => Array.from(row.cells).forEach((cell, columnIndex) => {
        if (rowIndex >= minRow && rowIndex <= maxRow && columnIndex >= minColumn && columnIndex <= maxColumn) draftSelection.add(cell);
    }));
    draftTable.querySelectorAll('td,th').forEach(cell => cell.classList.toggle('draft-cell-selected', draftSelection.has(cell)));
}

export function bindDraftTableEvents() {
    draftTable.addEventListener('mousedown', event => {
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
    const positions = [...draftSelection].map(draftCellPosition);
    return { minRow: Math.min(...positions.map(item => item.row)), maxRow: Math.max(...positions.map(item => item.row)), minColumn: Math.min(...positions.map(item => item.column)), maxColumn: Math.max(...positions.map(item => item.column)) };
}

export function mergeDraftSelection() {
    const bounds = selectedDraftBounds();
    if (!bounds || draftSelection.size < 2) return showToast('Hãy kéo chọn ít nhất hai ô liền nhau.');
    const expected = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxColumn - bounds.minColumn + 1);
    if (draftSelection.size !== expected || [...draftSelection].some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) return showToast('Chỉ có thể merge một vùng chữ nhật chưa gộp.');
    const anchor = draftTable.rows[bounds.minRow].cells[bounds.minColumn];
    const contents = [...draftSelection].filter(cell => cell !== anchor).map(cell => cell.textContent.trim()).filter(Boolean);
    anchor.colSpan = bounds.maxColumn - bounds.minColumn + 1;
    anchor.rowSpan = bounds.maxRow - bounds.minRow + 1;
    if (contents.length) anchor.innerHTML = [anchor.textContent.trim(), ...contents].filter(Boolean).join('<br>');
    [...draftSelection].forEach(cell => { if (cell !== anchor) cell.remove(); });
    draftSelection.clear();
    draftSelection.add(anchor);
    anchor.classList.add('draft-cell-selected');
}

export function splitDraftCell() {
    if (draftSelection.size !== 1) return showToast('Hãy chọn một ô đã merge để tách.');
    const cell = [...draftSelection][0];
    activeEditorCell = cell;
    activeEditorTable = draftTable;
    splitActiveCell();
    selectDraftRectangle(cell, cell);
}

export function formatDraftSelection(type, value) {
    if (!draftSelection.size) return showToast('Hãy chọn ô cần định dạng.');
    draftSelection.forEach(cell => {
        if (type === 'align') cell.style.textAlign = value;
        if (type === 'bold') cell.style.fontWeight = cell.style.fontWeight === 'bold' ? 'normal' : 'bold';
        if (type === 'italic') cell.style.fontStyle = cell.style.fontStyle === 'italic' ? 'normal' : 'italic';
    });
}

export function applyDraftBorder(mode) {
    const menu = document.getElementById('table-border-menu');
    const useEditorSelection = menu?.dataset.mode === 'editor' && editorTableSelection.size > 0;
    const bounds = useEditorSelection ? selectedEditorBounds() : selectedDraftBounds();
    if (!bounds) return;
    const cells = useEditorSelection ? [...editorTableSelection] : [...draftSelection];
    if (mode === 'none') cells.forEach(cell => cell.style.border = '0 solid #000');
    else cells.forEach(cell => {
        const position = useEditorSelection ? editorCellPosition(cell) : draftCellPosition(cell);
        const set = side => cell.style[`border${side}`] = '1px solid #000';
        if (mode === 'all') cell.style.border = '1px solid #000';
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
    const table = draftTable.cloneNode(true);
    table.querySelectorAll('td,th').forEach(cell => { cell.contentEditable = 'true'; cell.classList.remove('draft-cell-selected'); });
    ensureTableResizeHandles(table);
    const insertionIndex = Math.max(0, Math.min(savedQuillRange?.index ?? (quill.getLength() - 1), quill.getLength() - 1));
    closeTableDialog();
    quill.focus();
    if (savedQuillRange?.length) quill.deleteText(insertionIndex, savedQuillRange.length, 'user');
    quill.insertEmbed(insertionIndex, 'scientificTable', table.outerHTML, 'user');
    quill.insertText(insertionIndex + 1, '\n', 'user');
    quill.setSelection(insertionIndex + 2, 0, 'silent');
    const tableEmbeds = quill.root.querySelectorAll('.scientific-table-embed table');
    activeEditorTable = tableEmbeds[tableEmbeds.length - 1] || null;
    activeEditorCell = null;
    syncRichEditorToState();
}

export function insertCustomTable() {
    const rows = Math.min(50, Math.max(1, parseInt(document.getElementById('table-row-count').value, 10) || 1));
    const columns = Math.min(20, Math.max(1, parseInt(document.getElementById('table-column-count').value, 10) || 1));
    closeTableDialog();
    restoreEditorSelection();
    const table = document.createElement('table');
    table.dataset.borderMode = document.getElementById('table-border-preset').value;
    const tbody = document.createElement('tbody');
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        const row = document.createElement('tr');
        for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
            const cell = document.createElement('td');
            cell.innerHTML = '<br>';
            row.appendChild(cell);
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    applyTableLayout(table, document.getElementById('table-autofit').value);
    applyBordersToTable(table, readTableBorderControls());
    const editor = quill.root;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rangeInsideEditor = range && editor.contains(range.commonAncestorContainer);
    if (rangeInsideEditor) {
        range.deleteContents();
        range.insertNode(table);
        const spacer = document.createElement('p');
        spacer.innerHTML = '<br>';
        table.after(spacer);
    } else {
        editor.append(table, document.createElement('p'));
    }
    activeEditorTable = table;
    const firstCell = table.querySelector('td');
    if (firstCell) {
        activeEditorCell = firstCell;
        const cellRange = document.createRange();
        cellRange.selectNodeContents(firstCell);
        selection.removeAllRanges();
        selection.addRange(cellRange);
    }
    syncRichEditorToState();
}

export function setTableBorderPreset(preset) {
    const presets = {
        apa: { top: true, bottom: true, header: true },
        all: { top: true, bottom: true, left: true, right: true, insideH: true, insideV: true },
        outer: { top: true, bottom: true, left: true, right: true },
        horizontal: { top: true, bottom: true, insideH: true },
        none: {}
    };
    if (preset === 'custom') return;
    const config = presets[preset] || presets.apa;
    tableBorderIds.forEach(id => {
        const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const input = document.getElementById(`border-${id}`);
        if (input) input.checked = Boolean(config[key]);
    });
}

export function readTableBorderControls() {
    const config = {};
    tableBorderIds.forEach(id => {
        const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const input = document.getElementById(`border-${id}`);
        config[key] = input ? input.checked : false;
    });
    return config;
}

export function loadTableBorderControls(table) {
    const autofit = document.getElementById('table-autofit');
    if (autofit) autofit.value = table.dataset.autofit || 'window';
    const hasSavedBorderConfig = tableBorderIds.some(id => {
        const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return key in table.dataset;
    });
    if (!hasSavedBorderConfig) {
        const legacyPreset = table.dataset.borderMode || 'all';
        const presetInput = document.getElementById('table-border-preset');
        if (presetInput) presetInput.value = legacyPreset;
        setTableBorderPreset(legacyPreset);
        return;
    }
    const presetInput = document.getElementById('table-border-preset');
    if (presetInput) presetInput.value = table.dataset.borderMode || 'custom';
    tableBorderIds.forEach(id => {
        const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const input = document.getElementById(`border-${id}`);
        if (input) input.checked = table.dataset[key] === 'true';
    });
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

export function applyBordersToTable(table, config) {
    if (!table) return;
    const rows = Array.from(table.rows);
    const rowCount = rows.length;
    const columnCount = Math.max(0, ...rows.map(row => row.cells.length));
    rows.forEach((row, rowIndex) => Array.from(row.cells).forEach((cell, columnIndex) => {
        cell.style.border = '0 solid #000';
        if (config.top && rowIndex === 0) cell.style.borderTop = '1px solid #000';
        if (config.bottom && rowIndex === rowCount - 1) cell.style.borderBottom = '1px solid #000';
        if (config.left && columnIndex === 0) cell.style.borderLeft = '1px solid #000';
        if (config.right && columnIndex === columnCount - 1) cell.style.borderRight = '1px solid #000';
        if (config.insideH && rowIndex < rowCount - 1) cell.style.borderBottom = '1px solid #000';
        if (config.insideV && columnIndex < columnCount - 1) cell.style.borderRight = '1px solid #000';
        if (config.header && rowIndex === 0) cell.style.borderBottom = '1px solid #000';
    }));
    Object.entries(config).forEach(([key, value]) => table.dataset[key] = String(Boolean(value)));
}

export function formatSelectedTable() {
    if (!activeEditorTable) {
        showToast('Hãy đặt con trỏ vào bảng cần định dạng.');
        return;
    }
    activeEditorTable.dataset.borderMode = document.getElementById('table-border-preset').value;
    applyTableLayout(activeEditorTable, document.getElementById('table-autofit').value);
    applyBordersToTable(activeEditorTable, readTableBorderControls());
    closeTableDialog();
    syncRichEditorToState();
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
    const cellIndex = activeEditorCell.cellIndex;
    const sourceCell = activeEditorCell;
    activeEditorCell.colSpan = 1;
    activeEditorCell.rowSpan = 1;
    for (let index = 1; index < columnSpan; index += 1) activeEditorCell.after(createEmptyTableCell(sourceCell));
    let row = activeEditorCell.parentElement;
    for (let rowOffset = 1; rowOffset < rowSpan; rowOffset += 1) {
        row = row.nextElementSibling;
        if (!row) break;
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
            row.insertBefore(createEmptyTableCell(sourceCell), row.cells[Math.min(cellIndex + columnOffset, row.cells.length)] || null);
        }
    }
    finishTableCellEdit('Đã tách ô.');
}

export function addTableRow() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào bảng.');
    const row = activeEditorCell.parentElement;
    const columnCount = Math.max(...Array.from(activeEditorTable.rows).map(item =>
        Array.from(item.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
    const newRow = activeEditorTable.insertRow(row.rowIndex + 1);
    for (let index = 0; index < columnCount; index += 1) newRow.appendChild(createEmptyTableCell());
    finishTableCellEdit('Đã thêm hàng.');
}

export function deleteTableRow() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào hàng cần xóa.');
    if (activeEditorTable.rows.length === 1) return deleteSelectedTable();
    const rowIndex = activeEditorCell.parentElement.rowIndex;
    activeEditorTable.deleteRow(rowIndex);
    activeEditorCell = null;
    finishTableCellEdit('Đã xóa hàng.');
}

export function addTableColumn() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào bảng.');
    const index = activeEditorCell.cellIndex + 1;
    Array.from(activeEditorTable.rows).forEach(row => row.insertBefore(createEmptyTableCell(), row.cells[index] || null));
    finishTableCellEdit('Đã thêm cột.');
}

export function deleteTableColumn() {
    if (!activeEditorCell) return showToast('Hãy đặt con trỏ vào cột cần xóa.');
    const index = activeEditorCell.cellIndex;
    Array.from(activeEditorTable.rows).forEach(row => {
        const cell = row.cells[index];
        if (cell) cell.remove();
    });
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
    return { row: cell.parentElement.rowIndex, column: cell.cellIndex };
}

export function selectEditorRectangle(startCell, endCell) {
    if (!startCell || !endCell || startCell.closest('table') !== endCell.closest('table')) return;
    const table = startCell.closest('table');
    const start = editorCellPosition(startCell);
    const end = editorCellPosition(endCell);
    const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column), maxColumn = Math.max(start.column, end.column);
    clearEditorTableSelection();
    Array.from(table.rows).forEach((row, rowIndex) => Array.from(row.cells).forEach((cell, columnIndex) => {
        if (rowIndex >= minRow && rowIndex <= maxRow && columnIndex >= minColumn && columnIndex <= maxColumn) {
            editorTableSelection.add(cell);
        }
    }));
    editorTableSelection.forEach(cell => cell.classList.add('editor-cell-selected'));
    activeEditorTable = table;
    activeEditorCell = startCell;
}

export function selectedEditorBounds() {
    if (!editorTableSelection.size) return null;
    const positions = [...editorTableSelection].map(editorCellPosition);
    return {
        minRow: Math.min(...positions.map(item => item.row)),
        maxRow: Math.max(...positions.map(item => item.row)),
        minColumn: Math.min(...positions.map(item => item.column)),
        maxColumn: Math.max(...positions.map(item => item.column))
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
    if (!table) return;
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
    table.dataset.resizeReady = 'true';
    table.style.position = table.style.position || 'relative';
    table.closest('.scientific-table-embed')?.setAttribute('contenteditable', 'true');
    Array.from(table.rows).forEach(row => {
        if (!row.style.height) row.style.height = `${Math.max(34, row.getBoundingClientRect().height || 34)}px`;
        Array.from(row.cells).forEach(cell => {
            cell.style.position = 'relative';
            cell.contentEditable = 'true';
            let colHandle = cell.querySelector(':scope > .table-col-resizer');
            if (!colHandle) {
                colHandle = document.createElement('span');
                colHandle.className = 'table-col-resizer';
                cell.appendChild(colHandle);
            }
            colHandle.contentEditable = 'false';
            colHandle.setAttribute('draggable', 'false');
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
    table.classList.add('table-resizing');
    table.style.tableLayout = 'fixed';
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

    const move = (moveEvent) => {
        moveEvent.preventDefault();
        const nextWidth = Math.max(32, startWidth + moveEvent.clientX - startX);
        colSpan1Cells.forEach(target => {
            target.style.width = `${nextWidth}px`;
            target.style.minWidth = `${nextWidth}px`;
        });
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
        syncRichEditorToState();
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
        syncRichEditorToState();
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
        saveToLocalStorage();

        const calcText = document.getElementById('form-calculated-pages');
        if (calcText) updateIssueStatusText();
        updateIssueStatusText();
        const headerMeta = document.getElementById('preview-header-meta');
        if (headerMeta) headerMeta.textContent = 'Tạp chí Khoa học Lạc Hồng, 2025, 20, 001-005';
    }
}
