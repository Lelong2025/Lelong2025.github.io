import { supabase } from '../shared/utils/supabase.js'
import { currentIframeUrls } from './account.js'
import { escapeHTML } from './format.js'

export const QUERY_TOKEN = '{{query}}'

const DEFAULT_LOOKUP_SOURCES = [
  {
    id: 'noapc',
    name: 'Non-APC',
    result_url: 'https://noapc.com/no-apc-scopus-indexed-journals-publish-without-publication-fee/',
    sample_keyword: 'iatreia',
    url_template: 'https://noapc.com/journal.php?q={{query}}',
    source_type: 'search',
    display_mode: 'both',
    is_active: true,
    sort_order: 10
  },
  {
    id: 'resurchify',
    name: 'Resurchify',
    result_url: 'https://www.resurchify.com/',
    sample_keyword: '2773 0123',
    url_template: 'https://www.resurchify.com/find/?query={{query}}#search_results',
    source_type: 'search',
    display_mode: 'both',
    is_active: true,
    sort_order: 20
  },
  {
    id: 'wos',
    name: 'Web Of Science',
    result_url: 'https://wos-journal.info/',
    sample_keyword: 'iatreia',
    url_template: 'https://wos-journal.info/?jsearch={{query}}',
    source_type: 'search',
    display_mode: 'both',
    is_active: true,
    sort_order: 30
  }
]

export let lookupSources = [...DEFAULT_LOOKUP_SOURCES]

function iconForSource(name = '') {
  const value = name.toLowerCase()
  if (value.includes('apc')) return 'fa-file-invoice-dollar'
  if (value.includes('resurchify')) return 'fa-chart-line'
  if (value.includes('web') || value.includes('science') || value.includes('wos')) return 'fa-globe'
  return 'fa-up-right-from-square'
}

function normalizeSource(source, index = 0) {
  return {
    id: String(source.id || `lookup-${index}`),
    name: String(source.name || `Nguồn ${index + 1}`),
    result_url: source.result_url || '',
    sample_keyword: source.sample_keyword || '',
    url_template: String(source.url_template || source.result_url || ''),
    source_type: ['fixed', 'search'].includes(source.source_type) ? source.source_type : 'search',
    display_mode: ['iframe', 'link', 'both'].includes(source.display_mode) ? source.display_mode : 'both',
    is_active: source.is_active !== false,
    sort_order: Number(source.sort_order || 0),
    icon: iconForSource(source.name)
  }
}

export async function loadLookupSources() {
  try {
    if (!supabase) throw new Error('Supabase is not configured')
    const { data, error } = await supabase
      .from('lookup_sources')
      .select('id, name, result_url, sample_keyword, url_template, source_type, display_mode, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    lookupSources = (data?.length ? data : DEFAULT_LOOKUP_SOURCES)
      .filter(source => source.source_type !== 'journal_checker_widget')
      .map(normalizeSource)
  } catch (error) {
    console.warn('Không tải được nguồn tra cứu, dùng cấu hình mặc định:', error.message)
    lookupSources = DEFAULT_LOOKUP_SOURCES.map(normalizeSource)
  }
  window.lookupSources = lookupSources
  window.lookupSourceLabels = Object.fromEntries(lookupSources.map(source => [
    source.id,
    `<i class="fas ${source.icon}"></i> ${escapeHTML(source.name)}`
  ]))
  return lookupSources
}

function encodeQueryForTemplate(template, query) {
  const encoded = encodeURIComponent(query)
  return /[?&][^#]*\{\{query\}\}/.test(template) ? encoded.replace(/%20/g, '+') : encoded
}

export function buildLookupUrl(source, query = '') {
  if (!source) return ''
  if (source.source_type === 'fixed') return source.url_template || source.result_url || ''
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) return source.result_url || source.url_template.replaceAll(QUERY_TOKEN, '')
  return source.url_template.replaceAll(QUERY_TOKEN, encodeQueryForTemplate(source.url_template, cleanQuery))
}

export function updateLookupUrls(query = '') {
  Object.keys(currentIframeUrls).forEach(key => delete currentIframeUrls[key])
  lookupSources.forEach(source => {
    currentIframeUrls[source.id] = buildLookupUrl(source, query)
  })
  return currentIframeUrls
}

export function renderLookupIntegrations() {
  const iframeHost = document.getElementById('iframes')
  const buttonHost = document.getElementById('lookupIframeButtons') || document.querySelector('#iframeLinksSection .iframe-buttons-grid')
  const iframeSources = lookupSources.filter(source => source.display_mode !== 'link')
  if (iframeHost) {
    iframeHost.innerHTML = iframeSources.map(source => `
      <div class="iframe-block">
        <p><i class="fas ${source.icon}"></i> ${escapeHTML(source.name)}</p>
        <iframe id="lookupFrame-${escapeHTML(source.id)}" src="" title="${escapeHTML(source.name)}" loading="lazy"
          sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>
      </div>
    `).join('')
  }
  if (buttonHost) {
    buttonHost.innerHTML = iframeSources.map(source => `
      <button data-iframe-type="${escapeHTML(source.id)}" class="iframe-btn lookup-source-btn">
        <i class="fas ${source.icon}"></i> Xem ${escapeHTML(source.name)}
      </button>
    `).join('')
  }
}

export function syncRenderedLookupFrames() {
  lookupSources.filter(source => source.display_mode !== 'link').forEach(source => {
    const frame = document.getElementById(`lookupFrame-${source.id}`)
    if (frame) frame.src = currentIframeUrls[source.id] || ''
  })
}

export function getIframeLookupSources() {
  return lookupSources.filter(source => source.display_mode !== 'link')
}

export function renderLookupExternalLinks() {
  const host = document.getElementById('lookupExternalLinks')
  if (!host) return
  const linkSources = lookupSources.filter(source => source.display_mode !== 'iframe')
  host.innerHTML = linkSources.map(source => `
    <a href="${escapeHTML(currentIframeUrls[source.id] || buildLookupUrl(source, ''))}" target="_blank" rel="noopener noreferrer">
      <i class="fas ${source.icon}"></i> ${escapeHTML(source.name)}
    </a>
  `).join('')
}
