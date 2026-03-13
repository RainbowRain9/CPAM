function normalizeCliProxyBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v0\/management$/i, '');
}

function getCliProxyManagementBase(baseUrl) {
  return `${normalizeCliProxyBaseUrl(baseUrl)}/v0/management`;
}

async function requestJson(fetchImpl, url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function buildInstanceClient(instance, fetchImpl = fetch) {
  const normalizedBaseUrl = normalizeCliProxyBaseUrl(instance?.baseUrl);
  const managementBase = getCliProxyManagementBase(normalizedBaseUrl);
  const headers = {
    Authorization: `Bearer ${instance?.apiKey || ''}`,
  };

  return {
    normalizedBaseUrl,
    managementBase,

    async fetchJson(path, init = {}, timeoutMs = 8000) {
      return requestJson(
        fetchImpl,
        `${managementBase}${path}`,
        {
          ...init,
          headers: {
            ...headers,
            ...(init.headers || {}),
          },
        },
        timeoutMs
      );
    },

    async exportUsage() {
      const { response, payload } = await this.fetchJson('/usage/export');
      return { response, payload };
    },

    async fetchOpenaiCompatibility() {
      const { response, payload } = await this.fetchJson('/openai-compatibility');
      return { response, payload };
    },

    async fetchAuthFiles() {
      const { response, payload } = await this.fetchJson('/auth-files');
      return { response, payload };
    },

    async apiCall(payload) {
      const { response, payload: data } = await this.fetchJson('/api-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      return { response, payload: data };
    },

    async deleteAuthFile(name) {
      const encodedName = encodeURIComponent(name);
      const { response, payload } = await this.fetchJson(`/auth-files?name=${encodedName}`, {
        method: 'DELETE',
      });
      return { response, payload };
    },
  };
}

function mapValidationFailure(status, detail) {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 401,
      instanceStatus: 'auth_failed',
      error: 'CLI-Proxy 管理密码错误',
      detail: detail || '',
    };
  }

  if (status >= 500) {
    return {
      ok: false,
      status: 502,
      instanceStatus: 'unreachable',
      error: 'CLI-Proxy 服务暂时不可用，请稍后再试',
      detail: detail || '',
    };
  }

  return {
    ok: false,
    status: 400,
    instanceStatus: 'unreachable',
    error: detail
      ? `CLI-Proxy 校验失败：${String(detail).slice(0, 120)}`
      : `CLI-Proxy 校验失败（HTTP ${status}）`,
    detail: detail || '',
  };
}

async function validateCliProxyManagementAccess(baseUrl, apiKey, fetchImpl = fetch) {
  const normalizedBaseUrl = normalizeCliProxyBaseUrl(baseUrl);
  const normalizedApiKey = String(apiKey || '').trim();

  if (!normalizedBaseUrl || !normalizedApiKey) {
    return {
      ok: false,
      status: 400,
      instanceStatus: 'unreachable',
      error: 'CLI-Proxy 地址和管理密码不能为空',
    };
  }

  const client = buildInstanceClient(
    {
      baseUrl: normalizedBaseUrl,
      apiKey: normalizedApiKey,
    },
    fetchImpl
  );

  const endpoints = ['/config', '/openai-compatibility', '/auth-files'];

  try {
    for (const endpoint of endpoints) {
      const { response, payload } = await client.fetchJson(endpoint);

      if (response.ok) {
        return {
          ok: true,
          normalizedBaseUrl,
          instanceStatus: 'healthy',
          statusMessage: '管理接口验证成功',
        };
      }

      if (response.status === 404) {
        continue;
      }

      let detail = '';
      if (payload && typeof payload === 'object') {
        detail = payload.error || payload.message || '';
      }

      return mapValidationFailure(response.status, detail);
    }

    return {
      ok: false,
      status: 404,
      instanceStatus: 'unreachable',
      error: 'CLI-Proxy 管理接口不可用，请确认地址是否正确',
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        instanceStatus: 'unreachable',
        error: '连接 CLI-Proxy 超时，请检查地址或网络',
      };
    }

    return {
      ok: false,
      status: 502,
      instanceStatus: 'unreachable',
      error: `无法连接 CLI-Proxy：${error?.message || '网络异常'}`,
    };
  }
}

module.exports = {
  buildInstanceClient,
  getCliProxyManagementBase,
  normalizeCliProxyBaseUrl,
  validateCliProxyManagementAccess,
};
