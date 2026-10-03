const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readToken, loadConfig } = require('./auth.cjs');

let token = null;

function loadToken() {
  try {
    token = readToken();
    return Boolean(token);
  } catch {
    token = null;
    return false;
  }
}

function headlessReauth() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'reauth.cjs')], {
    cwd: __dirname,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) return { ok: false, detail: String(result.stderr || result.stdout || '').trim().slice(0, 500) };
  return { ok: loadToken(), detail: null };
}

async function apiRequest(currentToken) {
  const cfg = loadConfig();
  if (!cfg.meterSn) throw new Error('meterSn missing');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();

  try {
    const response = await fetch(cfg.origin + '/api/walletManagement/updateRemainCapacity', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + currentToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': cfg.origin,
        'Referer': cfg.origin + '/home'
      },
      body: JSON.stringify({ meterSn: cfg.meterSn, from: cfg.from || 'mobile' }),
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      const error = new Error('authorization expired');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const json = await response.json();
    if (json && (Number(json.code) === 401 || Number(json.code) === 403)) {
      const error = new Error('authorization expired');
      error.status = Number(json.code);
      throw error;
    }
    if (!json || Number(json.code) !== 0 || !json.data) throw new Error('unexpected API response');

    const remain = Number(json.data.remainRapacity);
    if (!Number.isFinite(remain)) throw new Error('invalid remainRapacity');

    return {
      remain,
      updatedAt: json.data.updatedAt || null,
      latencyMs: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getReading() {
  if (!token && !loadToken()) {
    const recovered = headlessReauth();
    if (!recovered.ok) {
      const error = new Error('需要重新登录');
      error.authRequired = true;
      error.detail = recovered.detail;
      throw error;
    }
  }

  try {
    return await apiRequest(token);
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) {
      token = null;
      const recovered = headlessReauth();
      if (!recovered.ok) {
        const authError = new Error('登录已失效，需要重新登录');
        authError.authRequired = true;
        authError.detail = recovered.detail;
        throw authError;
      }
      return await apiRequest(token);
    }
    throw error;
  }
}

function authPresent() {
  return Boolean(token || loadToken());
}

module.exports = { getReading, headlessReauth, authPresent, reloadToken: loadToken };
