// Workspace content (including embedded images) can exceed localStorage's quota.
// Keep the complete backup in IndexedDB and read the old localStorage cache
// for existing installations or browsers where IndexedDB is unavailable.
export const LOCAL_STATE_KEY = 'lhu_journal_manager_state_v4';
let pendingWrite = Promise.resolve();

function openCache() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('lhu-magazine-cache', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Workspace cache is blocked'));
        request.onsuccess = () => resolve(request.result);
    });
}

async function useCache(mode, operation) {
    const db = await openCache();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction('workspaces', mode);
            const request = operation(transaction.objectStore('workspaces'));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error || request.error);
            transaction.onerror = () => reject(transaction.error || request.error);
        });
    } finally {
        db.close();
    }
}

export async function readWorkspaceCache() {
    await pendingWrite;
    const backups = [];
    const collect = saved => {
        if (!saved) return;
        const parsed = JSON.parse(saved);
        backups.push(parsed.cacheVersion === 1
            ? parsed
            : { savedAt: 0, workspace: parsed });
    };
    try {
        const saved = await useCache('readonly', store => store.get(LOCAL_STATE_KEY));
        collect(saved);
    } catch (error) {
        console.warn('Không đọc được bộ nhớ IndexedDB:', error);
    }
    try {
        const saved = localStorage.getItem(LOCAL_STATE_KEY);
        collect(saved);
    } catch (error) {
        console.warn('Không đọc được bản lưu workspace trên máy:', error);
    }
    backups.sort((a, b) => b.savedAt - a.savedAt);
    return backups[0]?.workspace || null;
}

export function writeWorkspaceCache(workspace) {
    let snapshot;
    try {
        snapshot = JSON.stringify({ cacheVersion: 1, savedAt: Date.now(), workspace });
    } catch (error) {
        console.warn('Không tạo được bản lưu workspace:', error);
        return Promise.resolve(false);
    }
    // Serialize writes so an older snapshot cannot overwrite a newer edit.
    pendingWrite = pendingWrite.then(async () => {
        try {
            await useCache('readwrite', store => store.put(snapshot, LOCAL_STATE_KEY));
            // Remove only the legacy workspace copy, after the new backup commits.
            try { localStorage.removeItem(LOCAL_STATE_KEY); } catch { /* Storage may be disabled. */ }
            return true;
        } catch (error) {
            try {
                localStorage.setItem(LOCAL_STATE_KEY, snapshot);
                return true;
            } catch (localError) {
                console.warn('Không lưu được bản sao workspace trên máy:', error, localError);
                return false;
            }
        }
    });
    return pendingWrite;
}
