async function validateToken(cfg, token, meterSn) {
  if (!token || !meterSn) return { ok: false, unauthorized: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(cfg.origin + '/api/walletManagement/updateRemainCapacity', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: cfg.origin,
        Referer: cfg.origin + '/home'
      },
      body: JSON.stringify({ meterSn, from: cfg.from || 'mobile' }),
      signal: controller.signal
    });
    const json = await response.json().catch(() => null);
    const unauthorized = response.status === 401 || response.status === 403 ||
      Number(json && json.code) === 401 || Number(json && json.code) === 403;
    if (unauthorized) return { ok: false, unauthorized: true };
    const remain = Number(json && json.data && json.data.remainRapacity);
    if (!response.ok || !json || Number(json.code) !== 0 || !json.data || !Number.isFinite(remain)) {
      return { ok: false, unauthorized: false };
    }
    return {
      ok: true,
      unauthorized: false,
      remain,
      updatedAt: json.data.updatedAt || null
    };
  } finally {
    clearTimeout(timer);
  }
}

function captureMeterFromPage(page, cfg, onMeter) {
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if (url.origin !== cfg.origin || url.pathname !== '/api/walletManagement/updateRemainCapacity') return;
      const body = JSON.parse(request.postData() || '{}');
      if (body.meterSn) onMeter(String(body.meterSn));
    } catch {}
  });
}

async function readToken(page, origin) {
  try {
    if (new URL(page.url()).origin !== origin) return null;
    return await page.evaluate(() => localStorage.getItem('eb-token'));
  } catch {
    return null;
  }
}

async function clearToken(page, origin) {
  try {
    if (new URL(page.url()).origin !== origin) return;
    await page.evaluate(() => localStorage.removeItem('eb-token'));
  } catch {}
}

async function clickRefresh(page) {
  try {
    const refresh = page.locator('.refresh-icon').first();
    if (await refresh.count()) {
      await refresh.click({ timeout: 5000 });
      return true;
    }
  } catch {}
  return false;
}

module.exports = { validateToken, captureMeterFromPage, readToken, clearToken, clickRefresh };
