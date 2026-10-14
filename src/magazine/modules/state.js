import { showToast } from './utils.js';
import { LOCAL_STATE_KEY, writeWorkspaceCache } from './workspace-cache.js';

export const state = {
    appState: {
        issues: {},
        currentIssueId: null,
        currentArticleId: null,
        zoomLevel: 100,
        sidebarCollapsed: false,
        previewMode: "single",
        adminPageMode: "issue",
        mobileTab: "editor"
    },
    LOCAL_STATE_KEY,
    CLOUD_WORKSPACE_ID: 'default',
    cloudUser: null,
    cloudProfile: null,
    clientSubmissions: [],
    cloudSyncEnabled: false,
    cloudSaveTimer: null,
    localBackupAvailable: false
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

let cacheWarningShown = false;

export async function cacheWorkspace() {
    state.localBackupAvailable = await writeWorkspaceCache(state.appState);
    if (!state.localBackupAvailable && !cacheWarningShown) {
        cacheWarningShown = true;
        showToast('Không lưu được bản sao trên máy. Hãy giữ trang mở đến khi lưu lên Supabase thành công.');
    }
    if (state.localBackupAvailable) cacheWarningShown = false;
    return state.localBackupAvailable;
}

export function saveToLocalStorage() {
    void cacheWorkspace();
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
        showToast(state.localBackupAvailable
            ? 'Không thể lưu lên Supabase. Bản lưu trên máy vẫn được giữ.'
            : 'Không thể lưu lên Supabase. Hãy giữ trang mở và xuất JSON để giữ dữ liệu.');
    }
}
