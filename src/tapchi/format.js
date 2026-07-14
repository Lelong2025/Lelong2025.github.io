export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function formatISSN(issn) {
  if (!issn) return 'N/A'
  const s = String(issn).replace(/[^0-9xX]/gi, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : (issn || 'N/A')
}
