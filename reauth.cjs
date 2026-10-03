const { PROFILE_DIR, protectToken, loadConfig, saveConfig, ensureDirs } = require('./auth.cjs');
const { launchEdgeSession, sleep } = require('./edge-session.cjs');
const { validateToken, captureMeterFromPage, readToken, clearToken, clickRefresh } = require('./onebill-auth.cjs');

ensureDirs();

async function main() {
  const cfg = loadConfig();
  const session = await launchEdgeSession({
    profileDir: PROFILE_DIR,
    url: cfg.origin + '/home',
    headless: true
  });

  let meterSn = cfg.meterSn || null;
  try {
    const page = session.page;
    page.setDefaultTimeout(8000);
    captureMeterFromPage(page, cfg, value => { meterSn = value; });

    await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(1200);

    for (let pass = 0; pass < 2; pass++) {
      let token = await readToken(page, cfg.origin);
      if (token && !meterSn) {
        await clickRefresh(page);
        await sleep(1000);
        token = await readToken(page, cfg.origin);
      }

      if (token && meterSn) {
        const result = await validateToken(cfg, token, meterSn);
        if (result.ok) {
          protectToken(token);
          saveConfig({ meterSn, lastAuthAt: new Date().toISOString() });
          console.log(JSON.stringify({
            ok: true,
            tokenStoredWithDpapi: true,
            meterDiscovered: Boolean(meterSn),
            browserSessionRefreshed: true
          }));
          return;
        }
        if (result.unauthorized && pass === 0) {
          await clearToken(page, cfg.origin);
          await page.goto(cfg.origin + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await sleep(5000);
          continue;
        }
      }

      if (pass === 0) {
        await clickRefresh(page);
        await sleep(2500);
      }
    }

    const error = new Error('interactive login required');
    error.authRequired = true;
    throw error;
  } finally {
    await session.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, authRequired: true, error: String(error.message || error) }));
  process.exit(2);
});
