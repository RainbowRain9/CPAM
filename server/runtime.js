const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function shouldUseViteProxy(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const devProxyFlag = options.devProxyFlag ?? process.env.API_CENTER_DEV_PROXY;
  return nodeEnv !== 'production' && devProxyFlag === 'true';
}

function resolveAppAuthSecret(options = {}) {
  const envSecret = String(options.envSecret ?? process.env.API_CENTER_SESSION_SECRET ?? '').trim();
  if (envSecret) {
    return envSecret;
  }

  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const secretFile = options.secretFile || path.join(dataDir, '.session-secret');

  ensureDirectory(dataDir);

  if (fs.existsSync(secretFile)) {
    const storedSecret = String(fs.readFileSync(secretFile, 'utf-8')).trim();
    if (storedSecret) {
      return storedSecret;
    }
  }

  const generatedSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretFile, `${generatedSecret}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (error) {
    console.warn('保存会话密钥失败，将使用当前进程内存中的随机密钥:', error?.message || error);
  }

  return generatedSecret;
}

function hasDefinedIdentifier(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

module.exports = {
  ensureDirectory,
  hasDefinedIdentifier,
  resolveAppAuthSecret,
  shouldUseViteProxy,
};
