const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadConfig, LOG_FILE, ensureDirs } = require('./auth.cjs');
const { getReading, authPresent, reloadToken } = require('./sampler.cjs');
const store = require('./store.cjs');
const { startDashboard } = require('./dashboard.cjs');

ensureDirs();

function rotateLog() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      const backup = LOG_FILE + '.1';
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(LOG_FILE, backup);
    }
  } catch {}
}

function log(message, extra) {
  rotateLog();
  const line = '[' + new Date().toISOString() + '] ' + message +
    (extra === undefined ? '' : ' ' + JSON.stringify(extra)) + '\n';
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
  console.log(line.trim());
}

const cfg = loadConfig();
const state = {
  running: true,
  sampling: false,
  auth: authPresent() ? 'ok' : 'unknown',
  lastError: null,
  lastSampleAt: null,
  lastRemain: null,
  lastServerUpdatedAt: null,
  lastLatencyMs: null,
  sessionKeepaliveRunning: false,
  lastSessionKeepaliveAt: null,
  lastSessionKeepaliveError: null
};

let dashboard = null;

function snapshot() {
  const latest = loadConfig();
  return {
    ...state,
    ...store.statusData(),
    intervalSeconds: Number(latest.intervalSeconds || 60),
    dashboardPort: Number(latest.dashboardPort || 17890),
    browserKeepaliveMinutes: Number(latest.browserKeepaliveMinutes || 60)
  };
}

async function sampleNow(reason = 'timer') {
  if (state.sampling) return { ok: false, busy: true };
  state.sampling = true;
  try {
    const reading = await getReading();
    const saved = store.addReading(reading);
    state.auth = 'ok';
    state.lastError = null;
    state.lastSampleAt = saved.sampledAt;
    state.lastRemain = saved.remain;
    state.lastServerUpdatedAt = saved.updatedAt;
    state.lastLatencyMs = saved.latencyMs;
    log('采样成功', {
      reason,
      remain: saved.remain,
      used: saved.used,
      recharged: saved.recharged,
      latencyMs: saved.latencyMs
    });
    dashboard?.push('reading', saved);
    return { ok: true, ...saved };
  } catch (error) {
    state.auth = error && error.authRequired ? 'required' : state.auth;
    state.lastError = String(error.message || error);
    log('采样失败', { reason, error: state.lastError });
    dashboard?.push('status', snapshot());
    return { ok: false, error: state.lastError };
  } finally {
    state.sampling = false;
  }
}

async function refreshBrowserSession(reason = 'timer') {
  if (state.sessionKeepaliveRunning) return { ok: false, busy: true };
  state.sessionKeepaliveRunning = true;

  return await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'reauth.cjs')], {
      cwd: __dirname,
      windowsHide: true,
      stdio: 'ignore'
    });

    let settled = false;
    const finish = (ok, error = null) => {
      if (settled) return;
      settled = true;
      state.sessionKeepaliveRunning = false;
      state.lastSessionKeepaliveAt = new Date().toISOString();
      state.lastSessionKeepaliveError = error;
      if (ok) {
        reloadToken();
        log('浏览器会话保活成功', { reason });
      } else {
        log('浏览器会话保活失败', { reason, error });
      }
      dashboard?.push('status', snapshot());
      resolve({ ok, error });
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(false, 'timeout');
    }, 60000);

    child.on('error', error => {
      clearTimeout(timer);
      finish(false, String(error.message || error));
    });
    child.on('close', code => {
      clearTimeout(timer);
      finish(code === 0, code === 0 ? null : 'interactive login required');
    });
  });
}

function shutdown() {
  try { dashboard?.server.close(); } catch {}
  try { store.close(); } catch {}
  process.exit(0);
}

const port = Number(cfg.dashboardPort || 17890);
dashboard = startDashboard({ port, getStatus: snapshot, sampleNow });

dashboard.server.on('listening', () => {
  log('电量监控已启动', { dashboard: 'http://127.0.0.1:' + port + '/' });
  sampleNow('startup');

  const interval = Math.max(30, Number(loadConfig().intervalSeconds || 60)) * 1000;
  setInterval(() => sampleNow('timer'), interval);

  const keepaliveMinutes = Math.max(15, Number(loadConfig().browserKeepaliveMinutes || 60));
  setTimeout(() => refreshBrowserSession('startup-delayed'), Math.min(5, keepaliveMinutes) * 60 * 1000);
  setInterval(() => refreshBrowserSession('timer'), keepaliveMinutes * 60 * 1000);
  log('浏览器会话保活已启用', { everyMinutes: keepaliveMinutes });
});

dashboard.server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    log('监控程序已在运行');
    process.exit(0);
  }
  log('本地服务启动失败', { error: String(error.message || error) });
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', error => {
  log('未捕获异常', { error: String(error.stack || error) });
});
process.on('unhandledRejection', error => {
  log('未处理 Promise 异常', { error: String(error && (error.stack || error.message) || error) });
});
