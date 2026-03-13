const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'cpam_session';
const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW_MS = 30 * 60 * 1000;

function validateUsername(username) {
  const value = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(value)) {
    return '用户名必须为 3 到 32 位，只能包含字母、数字、点、下划线和连字符';
  }
  return '';
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return '密码至少需要 12 个字符';
  }
  return '';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('scrypt:')) {
    return false;
  }

  const [, salt, expectedHash] = storedHash.split(':');
  if (!salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(actualHash, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  cookieHeader.split(';').forEach((part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) {
      return;
    }

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}

function getSessionTokenFromRequest(req) {
  return parseCookies(req.headers.cookie || '')[SESSION_COOKIE_NAME] || '';
}

function getSessionCookieOptions(isProduction) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(isProduction),
    path: '/',
    maxAge: SESSION_IDLE_TTL_MS,
  };
}

function buildSessionExpiry(now = Date.now()) {
  return new Date(now + SESSION_IDLE_TTL_MS).toISOString();
}

function shouldRefreshSession(lastSeenAt, now = Date.now()) {
  const lastSeenTimestamp = Date.parse(lastSeenAt || '');
  if (!Number.isFinite(lastSeenTimestamp)) {
    return true;
  }

  return now - lastSeenTimestamp >= SESSION_REFRESH_WINDOW_MS;
}

function isSessionExpired(expiresAt, now = Date.now()) {
  const expiresAtTimestamp = Date.parse(expiresAt || '');
  if (!Number.isFinite(expiresAtTimestamp)) {
    return true;
  }

  return expiresAtTimestamp <= now;
}

function isSessionInvalidatedByPasswordChange(session) {
  const passwordChangedAt = Date.parse(session?.password_changed_at || '');
  const sessionCreatedAt = Date.parse(session?.created_at || '');

  if (!Number.isFinite(passwordChangedAt) || !Number.isFinite(sessionCreatedAt)) {
    return false;
  }

  return passwordChangedAt > sessionCreatedAt;
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TTL_MS,
  SESSION_REFRESH_WINDOW_MS,
  buildSessionExpiry,
  generateSessionToken,
  getSessionCookieOptions,
  getSessionTokenFromRequest,
  hashPassword,
  hashSessionToken,
  isSessionExpired,
  isSessionInvalidatedByPasswordChange,
  parseCookies,
  shouldRefreshSession,
  validatePassword,
  validateUsername,
  verifyPassword,
};
