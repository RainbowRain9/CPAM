const AUTH_CHANGE_EVENT = 'cpam-auth-change'

export function notifyAuthChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

function getRequestPath(input) {
  if (typeof input === 'string') return input
  if (input instanceof Request) return input.url
  return String(input || '')
}

export async function apiFetch(input, init = {}) {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
  })

  const path = getRequestPath(input)
  if (response.status === 401 && path.includes('/api/')) {
    notifyAuthChanged()
  }

  return response
}

export function createApiEventSource(path) {
  const url = new URL(path, window.location.origin)
  return new EventSource(url.toString())
}

export function subscribeToAuthChanges(listener) {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener(AUTH_CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, listener)
  }
}
