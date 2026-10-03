const { PROFILE_DIR, protectToken, loadConfig, saveConfig, ensureDirs } = require('./auth.cjs');
const { launchEdgeSession, sleep } = require('./edge-session.cjs');
const { validateToken, captureMeterFromPage, readToken, clearToken, clickRefresh } = require('./onebill-auth.cjs');

ensureDirs();

async function main() {
  const cfg = loadConfig();
  const session = await launchEdgeSession({
    profileDir: PROFILE_DIR,
    url: cfg.origin + '/home',
    headless: false
  });

  let meterSn = cfg.meterSn || null;
  let rejectedToken = null;
  let success = false;

  try {
    const page = session.page;
    page.setDefaultTimeout(10000);
    captureMeterFromPage(page, cfg, value => { meterSn = value; });

    await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (session.child.exitCode != null) throw new Error('登录窗口已关闭');

      let token = await readToken(page, cfg.origin);
      if (token && !meterSn) {
        await clickRefresh(page);
        await sleep(1200);
        token = await readToken(page, cfg.origin);
      }

      if (token && meterSn) {
        const result = await validateToken(cfg, token, meterSn);
        if (result.ok) {
          protectToken(token);
          saveConfig({ meterSn, lastAuthAt: new Date().toISOString() });
          success = true;
          console.log('登录验证成功，新的登录状态已保存。');
          await sleep(1000);
          break;
        }

        if (result.unauthorized && token !== rejectedToken) {
          rejectedToken = token;
          await clearToken(page, cfg.origin);
          await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          continue;
        }
      }

      await sleep(1000);
    }

    if (!success) throw new Error('登录等待超时');
  } finally {
    await session.close();
  }
}

main().catch(error => {
  console.error(String(error.message || error));
  process.exit(2);
});
