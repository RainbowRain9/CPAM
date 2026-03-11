const AUTH_STORAGE_KEY = 'api-center-auth-token-v1'
const AUTH_CHANGE_EVENT = 'api-center-auth-change'

function dispatchAuthChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

function parseStoredAuth(rawValue) {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object' || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

export function getStoredAppAuth() {
  if (typeof window === 'undefined') return null

  const parsed = parseStoredAuth(window.localStorage.getItem(AUTH_STORAGE_KEY))
  if (!parsed) return null

  if (parsed.expiresAt && Number(parsed.expiresAt) <= Date.now()) {
    clearStoredAppAuth({ silent: true })
    return null
  }

  return parsed
}

export function saveStoredAppAuth(auth) {
  if (typeof window === 'undefined') return

  const payload = {
    token: auth?.token || '',
    expiresAt: auth?.expiresAt || null,
  }

  if (!payload.token) {
    clearStoredAppAuth()
    return
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload))
  dispatchAuthChange()
}

export function clearStoredAppAuth(options = {}) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
  if (!options.silent) {
    dispatchAuthChange()
  }
}

function getRequestPath(input) {
  if (typeof input === 'string') return input
  if (input instanceof Request) return input.url
  return String(input || '')
}

function getAuthHeaders(headers) {
  const nextHeaders = new Headers(headers || {})
  const auth = getStoredAppAuth()
  if (auth?.token) {
    nextHeaders.set('Authorization', `Bearer ${auth.token}`)
  }
  return nextHeaders
}

export async function apiFetch(input, init = {}) {
  const response = await fetch(input, {
    ...init,
    headers: getAuthHeaders(init.headers),
  })

  const path = getRequestPath(input)
  if (response.status === 401 && path.includes('/api/')) {
    clearStoredAppAuth()
  }

  return response
}

export function createApiEventSource(path) {
  const url = new URL(path, window.location.origin)
  const auth = getStoredAppAuth()
  if (auth?.token) {
    url.searchParams.set('access_token', auth.token)
  }
  return new EventSource(url.toString())
}

export function subscribeToAuthChanges(listener) {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener(AUTH_CHANGE_EVENT, listener)
  const handleStorage = (event) => {
    if (event.key === AUTH_STORAGE_KEY) {
      listener()
    }
  }
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, listener)
    window.removeEventListener('storage', handleStorage)
  }
}
