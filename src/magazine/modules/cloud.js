import { state, saveToLocalStorage } from './state.js';
import { showToast } from './utils.js';

export const ROLE_ADMIN = 'admin';
export const ROLE_CLIENT = 'client';
export const ASSETS_BUCKET = 'article-assets';
export const EXPORTS_BUCKET = 'article-exports';

let mediaInsertCallback = null;

export function isAdmin() {
    return state.cloudProfile?.role === ROLE_ADMIN;
}

export function isClient() {
    return !isAdmin();
}

export async function loadProfile() {
    if (!state.cloudUser || !window.lhuSupabase) return null;
    const email = state.cloudUser.email || '';
    const fallbackName = state.cloudUser.user_metadata?.full_name || email.split('@')[0] || 'Client';
    let { data, error } = await window.lhuSupabase
        .from('profiles')
        .select('user_id, role, display_name, email')
        .eq('user_id', state.cloudUser.id)
        .maybeSingle();
    if (error) {
        console.warn('Cannot load profile:', error);
    }
    if (!data) {
        const insert = {
            user_id: state.cloudUser.id,
            role: ROLE_CLIENT,
            display_name: fallbackName,
            email
        };
        const result = await window.lhuSupabase
            .from('profiles')
            .insert(insert)
            .select('user_id, role, display_name, email')
            .maybeSingle();
        if (result.error) {
            console.warn('Cannot create profile, using local fallback:', result.error);
            data = insert;
        } else {
            data = result.data;
        }
    }
    state.cloudProfile = data || { user_id: state.cloudUser.id, role: ROLE_CLIENT, display_name: fallbackName, email };
    return state.cloudProfile;
}

export function ensureClientWorkspace() {
    if (!isClient()) return;
    state.appState.clientMode = true;
    const issueId = state.appState.currentIssueId || Object.keys(state.appState.issues || {})[0] || 'client-drafts';
    if (!state.appState.issues[issueId]) {
        state.appState.issues[issueId] = {
            title: 'Bài báo của tôi',
            articles: [],
            evenHeaderLanguage: 'vi',
            clientWorkspace: true
        };
    }
    state.appState.currentIssueId = issueId;
}

export function normalizeClientPages() {
    if (!isClient()) return;
    const issue = state.appState.issues[state.appState.currentIssueId];
    if (!issue) return;
    issue.articles.forEach(art => {
        const count = Math.max(1, parseInt(art.pageCount || 1, 10) || 1);
        art.startPage = 1;
        art.endPage = count;
    });
}

export function applyRoleUi() {
    const admin = isAdmin();
    document.body.dataset.userRole = admin ? ROLE_ADMIN : ROLE_CLIENT;
    const profileBadge = document.getElementById('profile-role-badge');
    if (profileBadge) {
        const label = admin ? 'Admin' : 'Client';
        profileBadge.textContent = `${label}: ${state.cloudProfile?.display_name || state.cloudUser?.email || ''}`;
    }
    document.querySelectorAll('[data-admin-only]').forEach(el => el.classList.toggle('hidden', !admin));
    document.querySelectorAll('[data-client-hidden]').forEach(el => el.classList.toggle('hidden', !admin));
    document.querySelectorAll('[data-client-only]').forEach(el => el.classList.toggle('hidden', admin));
}

export function activeArticleForSubmission() {
    const issue = state.appState.issues[state.appState.currentIssueId];
    return issue?.articles.find(art => art.id === state.appState.currentArticleId) || null;
}

export function snapshotArticle(art) {
    const profile = state.cloudProfile || {};
    return {
        ...JSON.parse(JSON.stringify(art || {})),
        submittedBy: {
            userId: state.cloudUser?.id || null,
            email: profile.email || state.cloudUser?.email || '',
            displayName: profile.display_name || state.cloudUser?.email || ''
        },
        submittedFromRole: profile.role || ROLE_CLIENT
    };
}

export async function uploadExportBlob(blob, extension, submissionId) {
    if (!blob || !state.cloudUser || !window.lhuSupabase) return null;
    const safeExt = extension === 'pdf' ? 'pdf' : 'docx';
    const path = `${state.cloudUser.id}/${submissionId}.${safeExt}`;
    const { error } = await window.lhuSupabase.storage
        .from(EXPORTS_BUCKET)
        .upload(path, blob, {
            upsert: true,
            contentType: safeExt === 'pdf'
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
    if (error) {
        console.warn('Cannot upload export:', error);
        showToast('Da xuat file, nhung chua upload duoc len Supabase Storage.');
        return null;
    }
    return path;
}

export async function submitCurrentArticle(format, blob = null) {
    const art = activeArticleForSubmission();
    if (!art || !state.cloudUser || !window.lhuSupabase) return;
    const submissionId = randomId();
    const ext = format === 'pdf' ? 'pdf' : 'docx';
    const filePath = blob ? await uploadExportBlob(blob, ext, submissionId) : null;
    const payload = {
        id: submissionId,
        owner_id: state.cloudUser.id,
        article_snapshot: snapshotArticle(art),
        exported_format: ext,
        exported_file_path: filePath,
        exported_at: new Date().toISOString(),
        status: 'submitted'
    };
    const { error } = await window.lhuSupabase.from('article_submissions').insert(payload);
    if (error) {
        console.warn('Cannot create submission:', error);
        showToast('Da xuat file, nhung chua gui duoc bai ve admin.');
        return;
    }
    showToast(isClient() ? 'Da xuat va gui bai ve admin.' : 'Da luu ban xuat bai bao.');
    loadSubmissions();
}

export async function loadSubmissions() {
    if (!window.lhuSupabase || !state.cloudUser) return [];
    let query = window.lhuSupabase
        .from('article_submissions')
        .select('id, owner_id, article_snapshot, exported_format, exported_file_path, exported_at, status')
        .order('exported_at', { ascending: false })
        .limit(100);
    if (!isAdmin()) query = query.eq('owner_id', state.cloudUser.id);
    const { data, error } = await query;
    if (error) {
        console.warn('Cannot load submissions:', error);
        state.clientSubmissions = [];
    } else {
        state.clientSubmissions = data || [];
    }
    renderSubmissionsList();
    return state.clientSubmissions;
}

export function renderSubmissionsList() {
    const container = document.getElementById('client-submissions-list');
    const section = document.getElementById('client-submissions-section');
    if (!container || !section) return;
    section.classList.toggle('hidden', !isAdmin());
    container.innerHTML = '';
    const rows = state.clientSubmissions || [];
    if (!rows.length) {
        container.innerHTML = '<div class="p-3 text-[11px] text-slate-400">Chua co bai client nao da xuat.</div>';
        return;
    }
    rows.forEach(row => {
        const art = row.article_snapshot || {};
        const submitter = art.submittedBy || {};
        const item = document.createElement('div');
        item.className = 'p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs space-y-1';
        item.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <strong class="truncate text-slate-700 dark:text-slate-100" title="${escapeHtml(art.titleVn || '')}">${escapeHtml(art.titleVn || '(Không có tiêu đề)')}</strong>
                <span class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">${escapeHtml(row.exported_format || '')}</span>
            </div>
            <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate">Bởi ${escapeHtml(submitter.displayName || submitter.email || row.owner_id)}</div>
            <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] text-slate-400">${formatDateTime(row.exported_at)}</span>
                <button type="button" class="text-blue-600 hover:underline font-bold" data-import-submission="${row.id}">Đưa vào số</button>
            </div>
        `;
        item.querySelector('[data-import-submission]').addEventListener('click', () => importSubmission(row.id));
        container.appendChild(item);
    });
}

export function importSubmission(id) {
    const row = (state.clientSubmissions || []).find(item => item.id === id);
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!row || !currentIssue) return;
    const source = row.article_snapshot || {};
    const copy = {
        ...JSON.parse(JSON.stringify(source)),
        id: `art-${Date.now()}`,
        submissionId: row.id,
        sourceClient: source.submittedBy || { userId: row.owner_id },
        sourceExportedAt: row.exported_at,
        sourceExportedFormat: row.exported_format
    };
    currentIssue.articles.push(copy);
    state.appState.currentArticleId = copy.id;
    saveToLocalStorage();
    window.recalculateContinuousPages?.();
    window.renderArticlesList?.();
    window.loadArticleIntoEditor?.(copy.id);
    showToast('Da dua bai client vao so bao hien tai.');
}

export function openLhjLogin() {
    window.open('https://lhj.vn/index.php/lachong/login', '_blank', 'noopener,noreferrer');
}

export function openMediaLibrary(callback) {
    mediaInsertCallback = callback || null;
    const modal = document.getElementById('media-library-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    loadMediaLibrary();
}

export function closeMediaLibrary() {
    const modal = document.getElementById('media-library-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

export async function uploadMediaFile(kind = 'images') {
    const input = document.getElementById(kind === 'avatars' ? 'author-photo-input' : 'media-upload-input');
    const file = input?.files?.[0];
    if (!file || !state.cloudUser || !window.lhuSupabase) return null;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const id = randomId();
    const path = `${state.cloudUser.id}/${kind}/${id}.${ext}`;
    const { error } = await window.lhuSupabase.storage.from(ASSETS_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || `image/${ext}`
    });
    if (error) {
        console.warn('Cannot upload media:', error);
        showToast('Khong upload duoc anh len Storage.');
        return null;
    }
    const { data } = window.lhuSupabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
    return { path, url: data.publicUrl, name: file.name };
}

export async function handleMediaUpload() {
    const uploaded = await uploadMediaFile('images');
    const input = document.getElementById('media-upload-input');
    if (input) input.value = '';
    if (!uploaded) return;
    await loadMediaLibrary();
    if (mediaInsertCallback) {
        mediaInsertCallback(uploaded.url);
        closeMediaLibrary();
    }
}

export async function loadMediaLibrary() {
    const grid = document.getElementById('media-library-grid');
    if (!grid || !state.cloudUser || !window.lhuSupabase) return;
    grid.innerHTML = '<div class="p-4 text-xs text-slate-400">Dang tai thu vien anh...</div>';
    const prefix = `${state.cloudUser.id}/images`;
    const { data, error } = await window.lhuSupabase.storage.from(ASSETS_BUCKET).list(prefix, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
    });
    if (error) {
        console.warn('Cannot list media:', error);
        grid.innerHTML = '<div class="p-4 text-xs text-slate-400">Chua doc duoc thu vien anh.</div>';
        return;
    }
    grid.innerHTML = '';
    if (!data?.length) {
        grid.innerHTML = '<div class="p-4 text-xs text-slate-400">Chua co anh nao. Hay upload anh moi.</div>';
        return;
    }
    data.filter(file => !file.name.endsWith('/')).forEach(file => {
        const path = `${prefix}/${file.name}`;
        const { data: urlData } = window.lhuSupabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'group aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900';
        button.innerHTML = `<img src="${urlData.publicUrl}" alt="${escapeHtml(file.name)}" class="h-full w-full object-cover transition group-hover:scale-105">`;
        button.addEventListener('click', () => {
            if (mediaInsertCallback) mediaInsertCallback(urlData.publicUrl);
            closeMediaLibrary();
        });
        grid.appendChild(button);
    });
}

export async function uploadAuthorPhotoFromInput() {
    const uploaded = await uploadMediaFile('avatars');
    if (!uploaded) return;
    const target = document.getElementById('author-photo-url');
    const preview = document.getElementById('author-photo-preview');
    if (target) target.value = uploaded.url;
    if (preview) preview.src = uploaded.url;
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

export function formatDateTime(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
        return String(value);
    }
}

export function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
        (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
}
