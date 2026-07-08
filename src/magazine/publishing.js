import './publishing.css'
import { initMixingShell } from '../shared/shell.js'
import { auth } from '../shared/utils/auth.js'
import { supabase } from '../shared/utils/supabase.js'
import { FEATURES } from '../shared/features.js'

if (!FEATURES.EDITORIAL_PUBLISHING) {
  window.location.replace('/magazine/editor.html')
}

const WORKSPACE_ID = 'default'
const LOCAL_STATE_KEY = 'lhu_journal_manager_state_v4'
const UNASSIGNED_ID = '__editorial_unassigned__'
const state = { user: null, profile: null, workspace: null, submissions: [], activeTab: 'issues', filter: 'all' }

if (FEATURES.EDITORIAL_PUBLISHING) {
  initMixingShell({ active: 'publishing' })
  boot()
}

async function boot() {
  state.user = await auth.getUser()
  if (!state.user) return window.location.replace('/magazine/#login')
  if (!supabase) return showToast('Supabase chưa được cấu hình.')

  const { data: profile } = await supabase.from('profiles')
    .select('user_id, role, display_name, email').eq('user_id', state.user.id).maybeSingle()
  state.profile = profile
  if (profile?.role !== 'admin') return window.location.replace('/magazine/editor.html')

  bindEvents()
  await reloadData()
}

function bindEvents() {
  document.querySelectorAll('[data-publishing-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.publishingTab)))
  document.getElementById('publishing-refresh')?.addEventListener('click', reloadData)
  document.getElementById('create-issue-btn')?.addEventListener('click', createIssue)
  document.getElementById('article-status-filter')?.addEventListener('change', event => { state.filter = event.target.value; renderArticles() })
  document.getElementById('publishing-modal-close')?.addEventListener('click', closeModal)
  document.getElementById('publishing-modal')?.addEventListener('click', event => { if (event.target.id === 'publishing-modal') closeModal() })
}

async function reloadData() {
  const [{ data: workspace, error: workspaceError }, { data: submissions, error: submissionsError }] = await Promise.all([
    supabase.from('magazine_workspaces').select('state').eq('user_id', state.user.id).eq('workspace_id', WORKSPACE_ID).maybeSingle(),
    supabase.from('article_submissions')
      .select('id, owner_id, source_article_id, article_snapshot, submitted_at, exported_at, status')
      .order('submitted_at', { ascending: false })
  ])
  if (workspaceError) showToast('Không tải được workspace admin.')
  if (submissionsError) showToast('Không tải được bài client. Hãy chạy migration mới.')
  state.workspace = normalizeWorkspace(workspace?.state)
  state.submissions = (submissions || []).filter(row => row.article_snapshot?.submittedFromRole !== 'admin')
  renderAll()
}

function normalizeWorkspace(input) {
  const workspace = input && typeof input === 'object' ? structuredClone(input) : { issues: {}, currentIssueId: null, currentArticleId: null }
  workspace.issues ||= {}
  workspace.issues[UNASSIGNED_ID] ||= { title: 'Chưa xếp số', articles: [], evenHeaderLanguage: 'vi', editorialInbox: true }
  return workspace
}

async function saveWorkspace(message = '') {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state.workspace))
  const { error } = await supabase.from('magazine_workspaces').upsert({
    user_id: state.user.id, workspace_id: WORKSPACE_ID, state: state.workspace, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,workspace_id' })
  if (error) return showToast('Không lưu được thay đổi lên Supabase.')
  if (message) showToast(message)
  renderAll()
}

function renderAll() { renderMetrics(); renderIssues(); renderArticles() }

function renderMetrics() {
  const issues = issueEntries()
  const articles = allEditorialArticles()
  const unassigned = state.workspace.issues[UNASSIGNED_ID].articles.length
  const updates = articles.filter(({ article }) => hasPendingUpdate(article)).length
  document.getElementById('publishing-metrics').innerHTML = [
    ['Số báo', issues.length], ['Tổng bản biên tập', articles.length], ['Chưa xếp số', unassigned], ['Cập nhật chờ duyệt', updates]
  ].map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join('')
}

function issueEntries() { return Object.entries(state.workspace?.issues || {}).filter(([id]) => id !== UNASSIGNED_ID) }
function allEditorialArticles() {
  return Object.entries(state.workspace?.issues || {}).flatMap(([issueId, issue]) => (issue.articles || []).map(article => ({ issueId, issue, article })))
}

function renderIssues() {
  const host = document.getElementById('issues-grid')
  const issues = issueEntries()
  if (!issues.length) { host.innerHTML = '<div class="empty-state">Chưa có số báo. Hãy tạo số báo đầu tiên.</div>'; return }
  host.innerHTML = issues.map(([id, issue]) => `
    <article class="issue-card" data-issue-id="${escapeHtml(id)}">
      <header><div><h3>${escapeHtml(issue.title || 'Số báo chưa đặt tên')}</h3><span class="badge">${issue.articles?.length || 0} bài</span></div>
        <div class="issue-actions">
          <button class="icon-btn" data-add-to-issue="${escapeHtml(id)}" title="Thêm bài"><i class="fa-solid fa-plus"></i></button>
          <button class="icon-btn" data-rename-issue="${escapeHtml(id)}" title="Đổi tên"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn" data-delete-issue="${escapeHtml(id)}" title="Xóa số"><i class="fa-solid fa-trash"></i></button>
        </div></header>
      <div class="article-list" data-drop-issue="${escapeHtml(id)}">
        ${(issue.articles || []).map((article, index, articles) => articleRow(article, id, index, articles.length)).join('') || '<div class="empty-state">Chưa có bài trong số này.</div>'}
      </div>
      ${(issue.articles?.length || 0) > 4 ? '<div class="reorder-hint"><i class="fa-solid fa-grip-lines"></i> Kéo bài đến vị trí mong muốn để sắp xếp nhanh.</div>' : ''}
    </article>`).join('')
  bindIssueActions(host)
}

function articleRow(article, issueId, index, total) {
  return `<div class="article-row" draggable="true" data-drag-article="${escapeHtml(article.id)}" data-drag-issue="${escapeHtml(issueId)}">
    <i class="fa-solid fa-grip-lines drag-handle"></i><div class="article-copy"><strong>${escapeHtml(article.titleVn || article.titleEn || 'Bài chưa đặt tên')}</strong>
    <small>${escapeHtml(article.sourceClient?.displayName || article.sourceClient?.email || 'Bài của admin')}</small></div>
    ${hasPendingUpdate(article) ? '<span class="badge update">Có cập nhật</span>' : ''}
    <div class="row-actions"><button class="icon-btn" data-move-up="${index}" title="${index === 0 ? 'Đã ở đầu số báo' : 'Di chuyển lên'}" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-move-down="${index}" title="${index === total - 1 ? 'Đã ở cuối số báo' : 'Di chuyển xuống'}" ${index === total - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-remove-article="${escapeHtml(article.id)}" title="Gỡ khỏi số"><i class="fa-solid fa-box-archive"></i></button></div>
  </div>`
}

function bindIssueActions(host) {
  host.querySelectorAll('[data-rename-issue]').forEach(btn => btn.onclick = () => renameIssue(btn.dataset.renameIssue))
  host.querySelectorAll('[data-delete-issue]').forEach(btn => btn.onclick = () => deleteIssue(btn.dataset.deleteIssue))
  host.querySelectorAll('[data-add-to-issue]').forEach(btn => btn.onclick = () => openAddArticles(btn.dataset.addToIssue))
  host.querySelectorAll('[data-remove-article]').forEach(btn => btn.onclick = () => moveArticle(btn.dataset.removeArticle, btn.closest('[data-issue-id]').dataset.issueId, UNASSIGNED_ID))
  host.querySelectorAll('[data-move-up],[data-move-down]').forEach(btn => btn.onclick = () => {
    const issueId = btn.closest('[data-issue-id]').dataset.issueId
    const from = Number(btn.dataset.moveUp ?? btn.dataset.moveDown)
    const to = btn.hasAttribute('data-move-up') ? from - 1 : from + 1
    reorderArticle(issueId, from, to)
  })
  host.querySelectorAll('[data-drag-article]').forEach(row => {
    row.ondragstart = event => { row.classList.add('dragging'); event.dataTransfer.setData('text/plain', JSON.stringify({ articleId: row.dataset.dragArticle, issueId: row.dataset.dragIssue })) }
    row.ondragend = () => row.classList.remove('dragging')
    row.ondragover = event => { event.preventDefault(); row.classList.add('drag-over') }
    row.ondragleave = () => row.classList.remove('drag-over')
    row.ondrop = event => {
      event.preventDefault(); event.stopPropagation(); row.classList.remove('drag-over')
      try {
        const data = JSON.parse(event.dataTransfer.getData('text/plain'))
        const bounds = row.getBoundingClientRect()
        const placeAfter = event.clientY > bounds.top + bounds.height / 2
        moveArticleToPosition(data.articleId, data.issueId, row.dataset.dragIssue, row.dataset.dragArticle, placeAfter)
      } catch (_) {}
    }
  })
  host.querySelectorAll('[data-drop-issue]').forEach(list => {
    list.ondragover = event => event.preventDefault()
    list.ondrop = event => { event.preventDefault(); try { const data = JSON.parse(event.dataTransfer.getData('text/plain')); moveArticle(data.articleId, data.issueId, list.dataset.dropIssue) } catch (_) {} }
  })
}

function renderArticles() {
  const host = document.getElementById('articles-groups')
  const editorial = allEditorialArticles()
  const rowsBySource = new Map(editorial.filter(item => item.article.sourceClient).map(item => [`${item.article.sourceClient.userId}:${item.article.sourceArticleId || item.article.id}`, item]))
  const adminRows = editorial.filter(item => !item.article.sourceClient)
  const clientGroups = new Map()
  state.submissions.forEach(submission => {
    const source = submission.article_snapshot?.submittedBy || { userId: submission.owner_id }
    const key = source.userId || submission.owner_id
    if (!clientGroups.has(key)) clientGroups.set(key, { source, rows: [] })
    const editorialRow = rowsBySource.get(`${submission.owner_id}:${submission.source_article_id}`)
    clientGroups.get(key).rows.push({ submission, editorial: editorialRow })
  })
  const groups = [{ title: 'Bài của admin', source: null, rows: adminRows.map(editorial => ({ editorial })) }, ...Array.from(clientGroups.values()).map(group => ({ title: group.source.displayName || group.source.email || 'Client', ...group }))]
  host.innerHTML = groups.map(group => renderArticleGroup(group)).join('') || '<div class="empty-state">Chưa có bài báo.</div>'
  bindArticleActions(host)
}

function renderArticleGroup(group) {
  const visible = group.rows.filter(row => matchesFilter(row))
  if (!visible.length && state.filter !== 'all') return ''
  return `<article class="article-group"><header><div><h3>${escapeHtml(group.title)}</h3><span class="badge">${visible.length} bài</span></div>${group.source?.email ? `<small>${escapeHtml(group.source.email)}</small>` : ''}</header>
    <div class="article-list">${visible.map(row => articleLibraryRow(row)).join('') || '<div class="empty-state">Chưa có bài.</div>'}</div></article>`
}

function articleLibraryRow({ submission, editorial }) {
  const article = editorial?.article || submission?.article_snapshot || {}
  const assigned = editorial && editorial.issueId !== UNASSIGNED_ID
  const update = editorial && hasPendingUpdate(editorial.article, submission)
  return `<div class="article-row"><div class="article-copy"><strong>${escapeHtml(article.titleVn || article.titleEn || 'Bài chưa đặt tên')}</strong>
    <small>${assigned ? `Đã xếp: ${escapeHtml(editorial.issue.title)}` : 'Chưa xếp số'}${submission ? ` · Gửi ${formatDate(submission.submitted_at || submission.exported_at)}` : ''}</small></div>
    <span class="badge ${update ? 'update' : ''}">${update ? 'Có cập nhật' : assigned ? 'Đã xếp số' : 'Chưa xếp số'}</span>
    <div class="row-actions">
      ${editorial ? `<button class="icon-btn" data-place-editorial="${escapeHtml(editorial.article.id)}" title="${assigned ? 'Chuyển sang số báo khác' : 'Thêm vào số báo'}"><i class="fa-solid fa-folder-plus"></i></button>` : submission ? `<button class="icon-btn" data-place-submission="${submission.id}" title="Tạo bản biên tập và thêm vào số báo"><i class="fa-solid fa-folder-plus"></i></button>` : ''}
      ${!editorial && submission ? `<button class="icon-btn" data-create-editorial="${submission.id}" title="Tạo bản biên tập"><i class="fa-solid fa-copy"></i></button>` : ''}
      ${editorial ? `<button class="icon-btn" data-edit-editorial="${escapeHtml(editorial.article.id)}" title="Mở trình soạn"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
      ${editorial && submission ? `<button class="icon-btn" data-compare-submission="${submission.id}" title="So sánh"><i class="fa-solid fa-code-compare"></i></button>` : ''}
    </div></div>`
}

function matchesFilter({ submission, editorial }) {
  if (state.filter === 'all') return true
  if (state.filter === 'unassigned') return !editorial || editorial.issueId === UNASSIGNED_ID
  if (state.filter === 'assigned') return editorial?.issueId !== UNASSIGNED_ID
  if (state.filter === 'updates') return editorial && submission && hasPendingUpdate(editorial.article, submission)
  return true
}

function bindArticleActions(host) {
  host.querySelectorAll('[data-create-editorial]').forEach(btn => btn.onclick = () => createEditorialCopy(btn.dataset.createEditorial))
  host.querySelectorAll('[data-place-editorial]').forEach(btn => btn.onclick = () => openIssuePicker({ articleId: btn.dataset.placeEditorial }))
  host.querySelectorAll('[data-place-submission]').forEach(btn => btn.onclick = () => openIssuePicker({ submissionId: btn.dataset.placeSubmission }))
  host.querySelectorAll('[data-edit-editorial]').forEach(btn => btn.onclick = () => editEditorial(btn.dataset.editEditorial))
  host.querySelectorAll('[data-compare-submission]').forEach(btn => btn.onclick = () => openComparison(btn.dataset.compareSubmission))
}

function openIssuePicker({ articleId = '', submissionId = '' } = {}) {
  const editorial = articleId ? allEditorialArticles().find(item => item.article.id === articleId) : null
  const issues = issueEntries()
  const body = issues.length ? issues.map(([issueId, issue]) => {
    const current = editorial?.issueId === issueId
    return `<div class="article-row"><div class="article-copy"><strong>${escapeHtml(issue.title || 'Số báo chưa đặt tên')}</strong><small>${issue.articles?.length || 0} bài hiện có</small></div><button class="primary-btn" data-pick-issue="${escapeHtml(issueId)}" ${current ? 'disabled' : ''}>${current ? 'Đang thuộc số này' : 'Chọn số'}</button></div>`
  }).join('') : '<div class="empty-state">Chưa có số báo. Hãy tạo số báo trước.</div>'
  openModal('Chọn số báo', editorial?.article?.titleVn || 'Thêm bài vào số', body, '')
  document.querySelectorAll('[data-pick-issue]').forEach(button => button.onclick = async () => {
    if (button.disabled) return
    if (editorial) await moveArticle(articleId, editorial.issueId, button.dataset.pickIssue)
    else if (submissionId) await createEditorialCopy(submissionId, button.dataset.pickIssue)
    closeModal()
  })
}

function hasPendingUpdate(article, explicitSubmission = null) {
  if (!article?.sourceClient) return false
  const submission = explicitSubmission || findSubmissionForArticle(article)
  if (!submission) return false
  return new Date(submission.submitted_at || submission.exported_at || 0) > new Date(article.sourceReviewedAt || article.sourceSubmittedAt || 0)
}

function findSubmissionForArticle(article) {
  return state.submissions.find(row => row.owner_id === article.sourceClient?.userId && row.source_article_id === article.sourceArticleId)
}

async function createIssue() {
  const title = window.prompt('Tên số báo mới:')?.trim()
  if (!title) return
  const id = `issue-${Date.now()}`
  state.workspace.issues[id] = { title, articles: [], evenHeaderLanguage: 'vi' }
  state.workspace.currentIssueId ||= id
  await saveWorkspace('Đã tạo số báo mới.')
}

async function renameIssue(id) {
  const issue = state.workspace.issues[id]
  const title = window.prompt('Tên mới của số báo:', issue?.title || '')?.trim()
  if (!issue || !title) return
  issue.title = title
  await saveWorkspace('Đã đổi tên số báo.')
}

async function deleteIssue(id) {
  const issue = state.workspace.issues[id]
  if (!issue) return
  const count = issue.articles?.length || 0
  if (!window.confirm(`Xóa số báo “${issue.title}”?\n\n${count} bài trong số sẽ được chuyển về Chưa xếp số và không bị xóa.`)) return
  state.workspace.issues[UNASSIGNED_ID].articles.push(...(issue.articles || []))
  delete state.workspace.issues[id]
  if (state.workspace.currentIssueId === id) state.workspace.currentIssueId = UNASSIGNED_ID
  await saveWorkspace('Đã xóa số báo; các bài được giữ ở Chưa xếp số.')
}

function openAddArticles(issueId) {
  const available = state.workspace.issues[UNASSIGNED_ID].articles || []
  const importedKeys = new Set(allEditorialArticles().filter(item => item.article.sourceClient).map(item => `${item.article.sourceClient.userId}:${item.article.sourceArticleId}`))
  const rawClientArticles = state.submissions.filter(row => !importedKeys.has(`${row.owner_id}:${row.source_article_id}`))
  const availableMarkup = available.map(article => `<div class="article-row"><div class="article-copy"><strong>${escapeHtml(article.titleVn || article.titleEn || 'Bài chưa đặt tên')}</strong><small>${escapeHtml(article.sourceClient?.displayName || 'Bài của admin')}</small></div><button class="primary-btn" data-assign-article="${escapeHtml(article.id)}">Thêm</button></div>`).join('')
  const rawMarkup = rawClientArticles.map(row => { const article=row.article_snapshot||{}, sender=article.submittedBy||{}; return `<div class="article-row"><div class="article-copy"><strong>${escapeHtml(article.titleVn || article.titleEn || 'Bài client chưa đặt tên')}</strong><small>${escapeHtml(sender.displayName || sender.email || 'Client')} · Chưa có bản biên tập</small></div><button class="primary-btn" data-create-in-issue="${row.id}">Tạo & thêm</button></div>` }).join('')
  openModal('Thêm bài vào số', state.workspace.issues[issueId]?.title || '', availableMarkup || rawMarkup
    ? `${availableMarkup}${rawMarkup}`
    : '<div class="empty-state">Không có bài chưa xếp số.</div>', '')
  document.querySelectorAll('[data-assign-article]').forEach(btn => btn.onclick = async () => { await moveArticle(btn.dataset.assignArticle, UNASSIGNED_ID, issueId); closeModal() })
  document.querySelectorAll('[data-create-in-issue]').forEach(btn => btn.onclick = async () => { await createEditorialCopy(btn.dataset.createInIssue, issueId); closeModal() })
}

async function moveArticle(articleId, fromIssueId, toIssueId) {
  if (fromIssueId === toIssueId) return
  const from = state.workspace.issues[fromIssueId], to = state.workspace.issues[toIssueId]
  const index = from?.articles?.findIndex(article => article.id === articleId) ?? -1
  if (index < 0 || !to) return
  const [article] = from.articles.splice(index, 1)
  to.articles.push(article)
  await saveWorkspace(toIssueId === UNASSIGNED_ID ? 'Đã chuyển bài về Chưa xếp số.' : 'Đã thêm bài vào số báo.')
}

async function reorderArticle(issueId, from, to) {
  const articles = state.workspace.issues[issueId]?.articles
  if (!articles || to < 0 || to >= articles.length) return
  const [article] = articles.splice(from, 1); articles.splice(to, 0, article)
  await saveWorkspace('Đã cập nhật thứ tự bài.')
}

async function moveArticleToPosition(articleId, fromIssueId, toIssueId, targetArticleId, placeAfter = false) {
  const from = state.workspace.issues[fromIssueId], to = state.workspace.issues[toIssueId]
  const fromIndex = from?.articles?.findIndex(article => article.id === articleId) ?? -1
  const initialTargetIndex = to?.articles?.findIndex(article => article.id === targetArticleId) ?? -1
  if (fromIndex < 0 || initialTargetIndex < 0 || articleId === targetArticleId) return
  const [article] = from.articles.splice(fromIndex, 1)
  let targetIndex = to.articles.findIndex(item => item.id === targetArticleId)
  if (targetIndex < 0) targetIndex = to.articles.length
  else if (placeAfter) targetIndex += 1
  to.articles.splice(targetIndex, 0, article)
  await saveWorkspace('Đã cập nhật thứ tự bài.')
}

async function createEditorialCopy(submissionId, targetIssueId = UNASSIGNED_ID) {
  const submission = state.submissions.find(row => row.id === submissionId)
  if (!submission) return
  const source = structuredClone(submission.article_snapshot || {})
  const submittedBy = source.submittedBy || { userId: submission.owner_id }
  delete source.submittedBy; delete source.submittedFromRole
  const copy = { ...source, id: `editorial-${submission.id}`, sourceSubmissionId: submission.id, sourceArticleId: submission.source_article_id, sourceClient: submittedBy, sourceSubmittedAt: submission.submitted_at || submission.exported_at, sourceReviewedAt: submission.submitted_at || submission.exported_at }
  const targetIssue = state.workspace.issues[targetIssueId] || state.workspace.issues[UNASSIGNED_ID]
  targetIssue.articles.push(copy)
  await supabase.from('article_submissions').update({ status: 'imported' }).eq('id', submission.id)
  await saveWorkspace(targetIssueId === UNASSIGNED_ID
    ? 'Đã tạo bản biên tập và giữ nguyên nguồn client.'
    : 'Đã tạo bản biên tập và thêm vào số báo.')
}

async function editEditorial(articleId) {
  const row = allEditorialArticles().find(item => item.article.id === articleId)
  if (!row) return
  state.workspace.currentIssueId = row.issueId
  state.workspace.currentArticleId = articleId
  await saveWorkspace()
  window.location.href = '/magazine/editor.html'
}

function openComparison(submissionId) {
  const submission = state.submissions.find(row => row.id === submissionId)
  const editorial = allEditorialArticles().find(item => item.article.sourceSubmissionId === submissionId || (item.article.sourceClient?.userId === submission?.owner_id && item.article.sourceArticleId === submission?.source_article_id))
  if (!submission || !editorial) return
  const source = submission.article_snapshot || {}, target = editorial.article
  const fields = [
    ['titleVn','Tiêu đề tiếng Việt'],['titleEn','Tiêu đề tiếng Anh'],['headerTitle','Tiêu đề header'],['authors','Tác giả'],['email','Email'],
    ['abstractVn','Tóm tắt tiếng Việt'],['abstractEn','Tóm tắt tiếng Anh'],['keywordsVn','Từ khóa Việt'],['keywordsEn','Từ khóa Anh'],['bodyContent','Nội dung chính']
  ]
  const changed = fields.filter(([key]) => String(source[key] || '') !== String(target[key] || ''))
  const body = changed.length ? changed.map(([key,label]) => `<div class="compare-row"><div class="compare-box"><label>Bản biên tập · ${label}</label><div class="compare-value">${formatCompareValue(target[key], key)}</div></div><button class="apply-change" data-apply-field="${key}" title="Nhận thay đổi"><i class="fa-solid fa-arrow-left"></i></button><div class="compare-box"><label>Bản client mới · ${label}</label><div class="compare-value">${formatCompareValue(source[key], key)}</div></div></div>`).join('') : '<div class="empty-state">Hai bản không có khác biệt nội dung.</div>'
  openModal('So sánh cập nhật', source.titleVn || source.titleEn || 'Bài client', body, `<button class="secondary-btn" id="mark-reviewed-btn">Giữ bản biên tập & hoàn tất</button><button class="primary-btn" id="apply-all-btn">Nhận toàn bộ thay đổi</button>`)
  document.querySelectorAll('[data-apply-field]').forEach(btn => btn.onclick = async () => { target[btn.dataset.applyField] = source[btn.dataset.applyField] || ''; await saveWorkspace(); openComparison(submissionId) })
  document.getElementById('apply-all-btn').onclick = async () => { changed.forEach(([key]) => target[key] = source[key] || ''); target.sourceReviewedAt = submission.submitted_at || submission.exported_at; await saveWorkspace('Đã nhận toàn bộ thay đổi.'); closeModal() }
  document.getElementById('mark-reviewed-btn').onclick = async () => { target.sourceReviewedAt = submission.submitted_at || submission.exported_at; await saveWorkspace('Đã đánh dấu cập nhật là đã duyệt.'); closeModal() }
}

function formatCompareValue(value, key) { return key === 'bodyContent' ? sanitizeArticleHtml(value) : escapeHtml(value || '—') }
function sanitizeArticleHtml(value) {
  if (!value) return '<em>Trống</em>'
  const template = document.createElement('template')
  template.innerHTML = String(value)
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(node => node.remove())
  template.content.querySelectorAll('*').forEach(node => Array.from(node.attributes).forEach(attribute => {
    if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name)
  }))
  return template.innerHTML
}
function switchTab(tab) {
  state.activeTab = tab
  document.querySelectorAll('[data-publishing-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.publishingTab === tab))
  document.getElementById('publishing-issues-panel').classList.toggle('hidden', tab !== 'issues')
  document.getElementById('publishing-articles-panel').classList.toggle('hidden', tab !== 'articles')
}
function openModal(title, lead, body, footer) { document.getElementById('publishing-modal-title').textContent=title; document.getElementById('publishing-modal-lead').textContent=lead; document.getElementById('publishing-modal-body').innerHTML=body; document.getElementById('publishing-modal-footer').innerHTML=footer; const modal=document.getElementById('publishing-modal'); modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false') }
function closeModal() { const modal=document.getElementById('publishing-modal'); modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true') }
function showToast(message) { const toast=document.getElementById('publishing-toast'); if(!toast)return; toast.textContent=message; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),2600) }
function formatDate(value) { return value ? new Date(value).toLocaleString('vi-VN',{dateStyle:'short',timeStyle:'short'}) : '' }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
