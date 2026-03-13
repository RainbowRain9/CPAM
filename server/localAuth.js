const express = require('express');
const {
  SESSION_COOKIE_NAME,
  buildSessionExpiry,
  generateSessionToken,
  getSessionCookieOptions,
  getSessionTokenFromRequest,
  hashPassword,
  hashSessionToken,
  isSessionExpired,
  isSessionInvalidatedByPasswordChange,
  shouldRefreshSession,
  validatePassword,
  validateUsername,
  verifyPassword,
} = require('./auth');

const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 8;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

function createLocalAuth(options) {
  const {
    usageDb,
    isProduction = process.env.NODE_ENV === 'production',
    loginRateLimitWindowMs = DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MS,
    loginMaxAttempts = DEFAULT_LOGIN_MAX_ATTEMPTS,
  } = options || {};

  if (!usageDb) {
    throw new Error('usageDb is required');
  }

  const loginAttempts = new Map();
  const cookieOptions = getSessionCookieOptions(isProduction);
  const router = express.Router();

  function getLoginRateLimitState(ip, now = Date.now()) {
    const entry = loginAttempts.get(ip);
    if (!entry) {
      return {
        blocked: false,
        remaining: loginMaxAttempts,
        retryAfterMs: 0,
      };
    }

    if (now - entry.firstAttemptAt > loginRateLimitWindowMs) {
      loginAttempts.delete(ip);
      return {
        blocked: false,
        remaining: loginMaxAttempts,
        retryAfterMs: 0,
      };
    }

    return {
      blocked: entry.count >= loginMaxAttempts,
      remaining: Math.max(0, loginMaxAttempts - entry.count),
      retryAfterMs: Math.max(0, loginRateLimitWindowMs - (now - entry.firstAttemptAt)),
    };
  }

  function recordLoginFailure(ip, now = Date.now()) {
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.firstAttemptAt > loginRateLimitWindowMs) {
      loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
      return;
    }

    entry.count += 1;
  }

  function clearLoginFailures(ip) {
    loginAttempts.delete(ip);
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: cookieOptions.httpOnly,
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      path: cookieOptions.path,
    });
  }

  function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, cookieOptions);
  }

  function issueSession(user, req, res, now = Date.now()) {
    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const nowIso = new Date(now).toISOString();
    const expiresAt = buildSessionExpiry(now);

    const session = usageDb.createAuthSession({
      userId: user.id,
      sessionTokenHash,
      expiresAt,
      lastSeenAt: nowIso,
      createdAt: nowIso,
      userAgent: req.headers['user-agent'] || '',
      ipAddress: getClientIp(req),
    });

    setSessionCookie(res, sessionToken);

    return {
      session,
      user: {
        username: user.username,
      },
    };
  }

  function getAuthenticatedSession(req, res) {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return null;
    }

    const session = usageDb.getAuthSessionByTokenHash(hashSessionToken(sessionToken));
    if (!session) {
      clearSessionCookie(res);
      return null;
    }

    if (session.revoked_at || isSessionExpired(session.expires_at) || isSessionInvalidatedByPasswordChange(session)) {
      usageDb.revokeAuthSession(session.id);
      clearSessionCookie(res);
      return null;
    }

    if (shouldRefreshSession(session.last_seen_at)) {
      const now = Date.now();
      const nextSession = usageDb.touchAuthSession(
        session.id,
        buildSessionExpiry(now),
        new Date(now).toISOString()
      );
      setSessionCookie(res, sessionToken);
      return nextSession;
    }

    return session;
  }

  function applyAuthState(req, res, next) {
    const session = getAuthenticatedSession(req, res);
    if (session) {
      req.auth = {
        sessionId: session.id,
        userId: session.user_id,
        username: session.username,
      };
    } else {
      req.auth = null;
    }

    next();
  }

  function requireAppAuth(req, res, next) {
    if (req.auth?.userId) {
      return next();
    }

    clearSessionCookie(res);
    return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
  }

  function buildStatusPayload(req, res) {
    const bootstrapRequired = !usageDb.hasAuthUsers();
    const session = bootstrapRequired ? null : getAuthenticatedSession(req, res);
    const rateLimitState = bootstrapRequired || session
      ? { blocked: false, retryAfterMs: 0 }
      : getLoginRateLimitState(getClientIp(req));

    const message = rateLimitState.blocked
      ? `登录尝试过多，请 ${Math.ceil(rateLimitState.retryAfterMs / 1000)} 秒后再试`
      : '';

    return {
      bootstrapRequired,
      authenticated: Boolean(session),
      user: session ? { username: session.username } : null,
      loginRequired: !bootstrapRequired,
      blocked: Boolean(rateLimitState.blocked),
      message,
    };
  }

  router.get('/status', (req, res) => {
    res.json(buildStatusPayload(req, res));
  });

  router.post('/bootstrap', (req, res) => {
    if (usageDb.hasAuthUsers()) {
      return res.status(409).json({ error: '管理员账号已初始化' });
    }

    const username = String(req.body?.username || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ error: usernameError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: '两次输入的密码不一致' });
    }

    const user = usageDb.createAuthUser({
      username,
      passwordHash: hashPassword(password),
    });

    const session = issueSession(user, req, res);

    return res.status(201).json({
      success: true,
      user: session.user,
    });
  });

  router.post('/login', (req, res) => {
    if (!usageDb.hasAuthUsers()) {
      return res.status(409).json({ error: '请先初始化管理员账号' });
    }

    const ip = getClientIp(req);
    const rateLimitState = getLoginRateLimitState(ip);
    if (rateLimitState.blocked) {
      return res.status(429).json({
        error: `登录尝试过多，请 ${Math.ceil(rateLimitState.retryAfterMs / 1000)} 秒后再试`,
      });
    }

    const username = String(req.body?.username || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = usageDb.getAuthUserByUsername(username);

    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    clearLoginFailures(ip);
    const session = issueSession(user, req, res);

    return res.json({
      success: true,
      user: session.user,
    });
  });

  router.post('/logout', applyAuthState, requireAppAuth, (req, res) => {
    if (req.auth?.sessionId) {
      usageDb.revokeAuthSession(req.auth.sessionId);
    }

    clearSessionCookie(res);
    res.json({ success: true });
  });

  return {
    router,
    applyAuthState,
    requireAppAuth,
    buildStatusPayload,
    getLoginRateLimitState,
    resetSingleAdminPassword(password) {
      const user = usageDb.getSingleAuthUser();
      if (!user) {
        throw new Error('当前还没有管理员账号');
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        throw new Error(passwordError);
      }

      const updatedUser = usageDb.updateAuthUserPassword(user.id, hashPassword(password));
      usageDb.revokeAuthSessionsByUserId(user.id);

      return {
        id: updatedUser.id,
        username: updatedUser.username,
      };
    },
  };
}

module.exports = {
  createLocalAuth,
  getClientIp,
};
