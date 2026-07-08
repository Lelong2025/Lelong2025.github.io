import { showToast } from './utils.js';

export const state = {
    appState: {
        issues: {},
        currentIssueId: null,
        currentArticleId: null,
        zoomLevel: 100,
        sidebarCollapsed: false,
        previewMode: "single",
        mobileTab: "editor"
    },
    LOCAL_STATE_KEY: 'lhu_journal_manager_state_v4',
    CLOUD_WORKSPACE_ID: 'default',
    cloudUser: null,
    cloudProfile: null,
    clientSubmissions: [],
    cloudSyncEnabled: false,
    cloudSaveTimer: null
};

export async function handleLogout() {
    if (window.lhuSupabase) {
        await window.lhuSupabase.auth.signOut();
    }
    state.cloudUser = null;
    state.cloudProfile = null;
    state.cloudSyncEnabled = false;
    window.location.replace('/');
}

export function saveToLocalStorage() {
    localStorage.setItem(state.LOCAL_STATE_KEY, JSON.stringify(state.appState));
    if (!state.cloudSyncEnabled || !state.cloudUser) return;
    clearTimeout(state.cloudSaveTimer);
    state.cloudSaveTimer = setTimeout(saveToSupabase, 700);
}

export async function saveToSupabase() {
    if (!state.cloudUser || !window.lhuSupabase) return;
    clearTimeout(state.cloudSaveTimer);
    const { error } = await window.lhuSupabase.from('magazine_workspaces').upsert({
        user_id: state.cloudUser.id,
        workspace_id: state.CLOUD_WORKSPACE_ID,
        state: state.appState,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,workspace_id' });
    if (error) {
        console.error('Lỗi lưu workspace lên Supabase:', error);
        showToast('Không thể lưu lên Supabase. Bản local vẫn được giữ.');
    }
}
