import { state, handleLogout, saveToLocalStorage, saveToSupabase } from './modules/state.js';
import { showToast, allowDrop, handleAbstractPaste } from './modules/utils.js';
import {
    initApp, toggleSidebar, populateIssueSelector, recalculateContinuousPages,
    syncCurrentArticlePageCountFromPreview, renderArticlesList, selectArticle,
    loadArticleIntoEditor, clearEditorForm, syncFormToPreview, footerDateText,
    effectiveHeaderLanguage, syncHeaderLanguageControls, setIssueHeaderLanguage,
    setArticleHeaderLanguage, formatKeywords, articleDisplayPageNumber,
    createArticlePage, pageHasOverflow, appendTextBlockAcrossPages, paginateContent,
    renderSingleArticlePreview, togglePreviewMode, renderLivePreview,
    createNewArticle, deleteCurrentArticle, createNewIssue, zoomPreview,
    activeArticle, toggleDarkMode, switchMobileTab, adjustPreviewScale,
    toggleAiPanel, switchReviewTab, openAuthorDialog, closeAuthorDialog, addAuthorProfile,
    renderAuthorProfiles, removeAuthorProfile
} from './modules/ui.js';
import {
    initQuill, openRichTextWorkspace, closeRichTextWorkspace, formatDoc,
    openTableDialog, closeTableDialog, buildDraftTable, mergeDraftSelection,
    splitDraftCell, formatDraftSelection, applyDraftBorder, insertDraftTableAtCursor,
    insertCustomTable, setTableBorderPreset, formatSelectedTable, deleteSelectedTable,
    mergeCellRight, mergeCellDown, splitActiveCell, addTableRow, deleteTableRow,
    addTableColumn, deleteTableColumn, formatActiveCell, toggleActiveCellBorder,
    updateCurrentArticlePages
} from './modules/editor.js';
import {
    exportCurrentArticleWord, exportIssueWord, exportVectorPdf, exportIssue,
    closeExportModal, exportJSON
} from './modules/export.js';
import { runAiReview, applySelectedSuggestions } from './modules/ai.js';
import {
    loadProfile, ensureClientWorkspace, applyRoleUi, loadSubmissions, renderSubmissionsList,
    openLhjLogin, openMediaLibrary, closeMediaLibrary, handleMediaUpload,
    uploadAuthorPhotoFromInput, submitCurrentArticle, renderSubmissionCard, isClient
} from './modules/cloud.js';

// Expose states to global window scope for inline scripts
window.state = state;
Object.defineProperty(window, 'appState', {
    get() { return state.appState; },
    set(val) { state.appState = val; }
});

// Expose functions to global window scope for inline HTML event handlers
Object.assign(window, {
    handleLogout,
    saveToLocalStorage,
    saveToSupabase,
    showToast,
    allowDrop,
    initApp,
    toggleSidebar,
    populateIssueSelector,
    recalculateContinuousPages,
    syncCurrentArticlePageCountFromPreview,
    renderArticlesList,
    selectArticle,
    loadArticleIntoEditor,
    clearEditorForm,
    syncFormToPreview,
    footerDateText,
    effectiveHeaderLanguage,
    syncHeaderLanguageControls,
    setIssueHeaderLanguage,
    setArticleHeaderLanguage,
    formatKeywords,
    articleDisplayPageNumber,
    createArticlePage,
    pageHasOverflow,
    appendTextBlockAcrossPages,
    paginateContent,
    renderSingleArticlePreview,
    togglePreviewMode,
    renderLivePreview,
    createNewArticle,
    deleteCurrentArticle,
    createNewIssue,
    zoomPreview,
    activeArticle,
    toggleDarkMode,
    switchMobileTab,
    adjustPreviewScale,
    toggleAiPanel,
    switchReviewTab,
    openAuthorDialog,
    closeAuthorDialog,
    addAuthorProfile,
    renderAuthorProfiles,
    removeAuthorProfile,
    openRichTextWorkspace,
    closeRichTextWorkspace,
    formatDoc,
    openTableDialog,
    closeTableDialog,
    buildDraftTable,
    mergeDraftSelection,
    splitDraftCell,
    formatDraftSelection,
    applyDraftBorder,
    insertDraftTableAtCursor,
    insertCustomTable,
    setTableBorderPreset,
    formatSelectedTable,
    deleteSelectedTable,
    mergeCellRight,
    mergeCellDown,
    splitActiveCell,
    addTableRow,
    deleteTableRow,
    addTableColumn,
    deleteTableColumn,
    formatActiveCell,
    toggleActiveCellBorder,
    updateCurrentArticlePages,
    exportCurrentArticleWord,
    exportIssueWord,
    exportVectorPdf,
    exportIssue,
    closeExportModal,
    exportJSON,
    runAiReview,
    applySelectedSuggestions: applySelectedSuggestions,
    renderSubmissionsList,
    loadSubmissions,
    submitCurrentArticle,
    renderSubmissionCard,
    openLhjLogin,
    openMediaLibrary,
    closeMediaLibrary,
    handleMediaUpload,
    uploadAuthorPhotoFromInput
});

async function boot() {
    const savedState = localStorage.getItem(state.LOCAL_STATE_KEY);
    if (savedState) {
        try {
            state.appState = JSON.parse(savedState);
        } catch (e) {
            console.error("Lỗi phục hồi dữ liệu, khởi chạy mặc định", e);
        }
    }

    const savedTheme = localStorage.getItem('mixing-theme') || localStorage.getItem('theme') || document.documentElement.dataset.theme || 'dark';
    const theme = savedTheme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('mixing-theme', theme);
    localStorage.setItem('theme', theme);

    state.appState.previewMode = state.appState.previewMode === 'full' ? 'full' : 'single';

    try {
        state.cloudUser = await window.lhuRequireAuth();
        if (!state.cloudUser) return;
        await loadProfile();
        const { data, error } = await window.lhuSupabase
            .from('magazine_workspaces')
            .select('state')
            .eq('user_id', state.cloudUser.id)
            .eq('workspace_id', state.CLOUD_WORKSPACE_ID)
            .maybeSingle();
        if (error) throw error;
        if (data?.state && typeof data.state === 'object') {
            state.appState = data.state;
            state.appState.previewMode = state.appState.previewMode === 'full' ? 'full' : 'single';
            localStorage.setItem(state.LOCAL_STATE_KEY, JSON.stringify(state.appState));
        }
        ensureClientWorkspace();
        state.cloudSyncEnabled = true;
        if (!data) await saveToSupabase();
    } catch (error) {
        console.error('Không thể tải workspace từ Supabase:', error);
        setTimeout(() => showToast('Chưa đồng bộ được Supabase; tạm dùng bản lưu trên máy.'), 300);
    }

    // Bind pasting abstracts
    ['input-abstract-vn', 'input-abstract-en'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('paste', handleAbstractPaste);
    });

    // Initialize Quill editor
    initQuill();

    // Initialize layout and articles list
    initApp();
    applyRoleUi();
    if (isClient()) loadSubmissions();
}

function markEditorReady() {
    window.dispatchEvent(new CustomEvent('mixing:page-ready'));
}

function startEditor() {
    boot()
        .catch(error => console.error('Không thể khởi tạo trình soạn báo:', error))
        .finally(markEditorReady);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEditor);
} else {
    startEditor();
}
