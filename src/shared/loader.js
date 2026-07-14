import './loader.css'

const PAGE_SVG = `
  <svg fill="currentColor" viewBox="0 0 90 120" aria-hidden="true">
    <path d="M90,0 L90,120 L11,120 C4.92486775,120 0,115.075132 0,109 L0,11 C0,4.92486775 4.92486775,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.1192881,81 16,82.1192881 16,83.5 C16,84.8254834 17.0315359,85.9100387 18.3356243,85.9946823 L18.5,86 L71.5,86 C72.8807119,86 74,84.8807119 74,83.5 C74,82.1745166 72.9684641,81.0899613 71.6643757,81.0053177 L71.5,81 Z M71.5,57 L18.5,57 C17.1192881,57 16,58.1192881 16,59.5 C16,60.8254834 17.0315359,61.9100387 18.3356243,61.9946823 L18.5,62 L71.5,62 C72.8807119,62 74,60.8807119 74,59.5 C74,58.1192881 72.8807119,57 71.5,57 Z M71.5,33 L18.5,33 C17.1192881,33 16,34.1192881 16,35.5 C16,36.8254834 17.0315359,37.9100387 18.3356243,37.9946823 L18.5,38 L71.5,38 C72.8807119,38 74,36.8807119 74,35.5 C74,34.1192881 72.8807119,33 71.5,33 Z"></path>
  </svg>
`

export function getSharedLoaderMarkup({ label = 'Loading', labelled = true } = {}) {
  const labelMarkup = labelled ? `<span class="shared-loader__label">${escapeHTML(label)}</span>` : ''
  return `
    <div class="shared-loader" role="status" aria-live="polite" aria-label="${escapeHTML(label)}">
      <div class="shared-loader__book">
        <ul class="shared-loader__pages">
          ${Array.from({ length: 6 }, () => `<li class="shared-loader__page">${PAGE_SVG}</li>`).join('')}
        </ul>
      </div>
      ${labelMarkup}
    </div>
  `
}

export function createSharedLoader(options = {}) {
  const template = document.createElement('template')
  template.innerHTML = getSharedLoaderMarkup(options).trim()
  return template.content.firstElementChild
}

export function mountSharedLoader(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target
  if (!host) return null
  const loader = createSharedLoader(options)
  if (options.replace !== false) host.replaceChildren(loader)
  else host.appendChild(loader)
  return loader
}

export function showSharedPageLoader(options = {}) {
  if (typeof document === 'undefined') return null
  let overlay = document.getElementById('shared-page-loader')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'shared-page-loader'
    overlay.className = 'shared-page-loader'
    document.body.appendChild(overlay)
  }
  overlay.classList.remove('is-hiding')
  mountSharedLoader(overlay, {
    label: options.label || 'Đang tải...',
    replace: true,
  })
  return overlay
}

export function hideSharedPageLoader() {
  const overlay = document.getElementById('shared-page-loader')
  if (!overlay) return
  overlay.classList.add('is-hiding')
  window.setTimeout(() => overlay.remove(), 240)
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}
