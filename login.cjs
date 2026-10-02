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
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check']
  });

  let meterSn = cfg.meterSn;
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(12000);

  page.on('response', async response => {
    try {
      const request = response.request();
      const url = new URL(request.url());
      if (url.origin !== cfg.origin || url.pathname !== '/api/walletManagement/updateRemainCapacity') return;
      const body = JSON.parse(request.postData() || '{}');
      if (body.meterSn) meterSn = body.meterSn;
    } catch {}
  });

  await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  const deadline = Date.now() + 10 * 60 * 1000;
  let token = null;
  while (Date.now() < deadline) {
    try {
      token = await page.evaluate(() => localStorage.getItem('eb-token'));
      if (token && new URL(page.url()).origin === cfg.origin) {
        const refresh = page.locator('.refresh-icon').first();
        if (await refresh.count()) {
          await refresh.click().catch(() => {});
          await page.waitForTimeout(1800);
        }
        break;
      }
    } catch {}
    await page.waitForTimeout(1500);
  }

  if (!token) {
    await context.close();
    throw new Error('login timed out');
  }

  if (!meterSn) {
    await context.close();
    throw new Error('未能识别电表编号，请确认已进入 OneBill 首页并能看到剩余电量。');
  }

  protectToken(token);
  saveConfig({ meterSn, lastAuthAt: new Date().toISOString() });
  console.log('登录状态已保存，可关闭此窗口。');
  await page.waitForTimeout(1200);
  await context.close();
}

main().catch(error => {
  console.error(String(error.message || error));
  process.exit(2);
});

