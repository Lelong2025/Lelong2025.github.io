import { apiFetch } from './utils/api.js'

export const SERVICE_CODES = Object.freeze({
  CHATBOX_AI: 'chatbox_ai',
  MAGAZINE_EXPORT: 'magazine_export',
  MAGAZINE_AI_REVIEW: 'magazine_ai_review',
})

let serviceAccountPromise = null

export function loadServiceAccount({ refresh = false } = {}) {
  if (refresh || !serviceAccountPromise) {
    serviceAccountPromise = apiFetch('/api/services').catch(error => {
      serviceAccountPromise = null
      throw error
    })
  }
  return serviceAccountPromise
}

function usageErrorMessage(error) {
  const reason = error?.data?.reason || error?.data?.error
  if (reason === 'daily_limit') return 'Bạn đã dùng hết lượt miễn phí hôm nay.'
  if (reason === 'wallet_insufficient') return 'Đã hết lượt và số dư ví không đủ để tự gia hạn.'
  if (reason === 'renewal_plan_unavailable') return 'Gói tự gia hạn đã ngừng hoạt động.'
  if (reason === 'credits_exhausted' || error?.status === 403) return 'Bạn đã hết lượt sử dụng dịch vụ này.'
  return error?.message || 'Không thể kiểm tra hạn mức dịch vụ.'
}

export async function withServiceUsage({ productCode, action, metadata = {}, onDenied }, operation) {
  const idempotencyKey = `${action}-${crypto.randomUUID()}`
  let reservation = null
  try {
    reservation = await apiFetch('/api/usage/reserve', {
      method: 'POST',
      body: JSON.stringify({
        product_code: productCode,
        action,
        idempotency_key: idempotencyKey,
        metadata,
      }),
    })
  } catch (error) {
    const message = usageErrorMessage(error)
    if (typeof onDenied === 'function') onDenied(message, error)
    else window.alert(message)
    return false
  }

  let result
  try {
    result = await operation(reservation)
  } catch (error) {
    await apiFetch('/api/usage/finalize', {
      method: 'POST',
      body: JSON.stringify({ reservation_id: reservation.reservation_id, success: false }),
    }).catch(() => {})
    throw error
  }
  const success = result !== false
  try {
    await apiFetch('/api/usage/finalize', {
      method: 'POST',
      body: JSON.stringify({ reservation_id: reservation.reservation_id, success }),
    })
  } catch (error) {
    console.error('Không thể chốt lượt dịch vụ:', error)
  }
  if (success) void loadServiceAccount({ refresh: true })
  return success
}
