const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { PROFILE_DIR, protectToken, loadConfig, saveConfig, ensureDirs } = require('./auth.cjs');

ensureDirs();

function edgePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(fs.existsSync) || candidates[0];
}

async function main() {
  const cfg = loadConfig();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: edgePath(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check']
  });

  let meterSn = cfg.meterSn;
  let remain = null;
  let updatedAt = null;
  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(12000);

    let capturedResolve;
    const captured = new Promise(resolve => { capturedResolve = resolve; });

    page.on('response', async response => {
      try {
        const request = response.request();
        const url = new URL(request.url());
        if (url.origin !== cfg.origin || url.pathname !== '/api/walletManagement/updateRemainCapacity') return;
        const body = JSON.parse(request.postData() || '{}');
        const json = await response.json();
        if (body.meterSn) meterSn = body.meterSn;
        if (json && json.data) {
          remain = Number(json.data.remainRapacity);
          updatedAt = json.data.updatedAt || null;
        }
        capturedResolve();
      } catch {}
    });

    await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1800);

    const token = await page.evaluate(() => localStorage.getItem('eb-token'));
    if (!token) throw new Error('eb-token not available; interactive login required');

    const refresh = page.locator('.refresh-icon').first();
    if (await refresh.count()) {
      await refresh.click();
      await Promise.race([captured, page.waitForTimeout(5000)]);
    }

    if (!meterSn) throw new Error('meterSn not discovered');
    protectToken(token);
    saveConfig({ meterSn, lastAuthAt: new Date().toISOString() });

    console.log(JSON.stringify({ ok: true, meterDiscovered: Boolean(meterSn), remain, updatedAt, tokenStoredWithDpapi: true }));
  } finally {
    await context.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
  process.exit(2);
});

