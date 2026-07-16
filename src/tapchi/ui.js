const htmlEl = document.documentElement

const savedTheme = localStorage.getItem('theme') || 'dark'
htmlEl.setAttribute('data-theme', savedTheme)

function toggleTheme() {
  const currentTheme = htmlEl.getAttribute('data-theme')
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
  htmlEl.setAttribute('data-theme', nextTheme)
  localStorage.setItem('theme', nextTheme)
}

export function openIframeInModal(type) {
  const modal = document.getElementById('iframeModal')
  const iframe = document.getElementById('modalIframe')
  const title = document.getElementById('modalTitle')
  const url = window.currentIframeUrls?.[type]

  const labels = window.lookupSourceLabels || {
    noapc: '<i class="fas fa-file-invoice-dollar"></i> Non-APC',
    resurchify: '<i class="fas fa-chart-line"></i> Resurchify',
    wos: '<i class="fas fa-globe"></i> Web Of Science',
  }

  if (!modal || !iframe || !title || !url) return

  title.innerHTML = labels[type] || ''
  iframe.src = url
  modal.classList.add('open')

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'integration_click', {
      integration_type: type,
      url,
    })
  }
}

export function closeIframeModal() {
  const modal = document.getElementById('iframeModal')
  const iframe = document.getElementById('modalIframe')
  if (modal) modal.classList.remove('open')
  if (iframe) iframe.src = ''
}

export function initTapchiUi() {
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme)
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-iframe-type]')
    if (button) openIframeInModal(button.dataset.iframeType)
  })
  document.querySelectorAll('[data-action="close-iframe-modal"]').forEach(button => {
    button.addEventListener('click', closeIframeModal)
  })
  document.getElementById('iframeModal')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeIframeModal()
  })
}
