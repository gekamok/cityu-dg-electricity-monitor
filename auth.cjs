const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const defaultRoot = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'CityUDGElectricityMonitor');
const ROOT = process.env.CITYU_DG_ELECTRICITY_MONITOR_HOME || defaultRoot;
const DATA_DIR = path.join(ROOT, 'data');
const PROFILE_DIR = path.join(ROOT, 'edge-profile');
const AUTH_FILE = path.join(DATA_DIR, 'auth.dpapi');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DB_FILE = path.join(DATA_DIR, 'electricity.sqlite');
const LOG_FILE = path.join(DATA_DIR, 'monitor.log');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

function findPowerShell() {
  for (const name of ['pwsh.exe', 'powershell.exe']) {
    const found = spawnSync('where.exe', [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    if (found.status === 0 && found.stdout.trim()) {
      return found.stdout.trim().split(/\r?\n/)[0];
    }
  }
  throw new Error('PowerShell not found');
}

function runDpapi(mode, input) {
  const script = path.join(__dirname, 'dpapi.ps1');
  const result = spawnSync(
    findPowerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, mode],
    { input, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'DPAPI failed').trim());
  }
  return result.stdout;
}

function protectToken(token) {
  ensureDirs();
  if (!token || typeof token !== 'string') throw new Error('token missing');
  fs.writeFileSync(AUTH_FILE, runDpapi('protect', token).trim(), 'utf8');
}

function readToken() {
  ensureDirs();
  if (!fs.existsSync(AUTH_FILE)) return null;
  const encoded = fs.readFileSync(AUTH_FILE, 'utf8').trim();
  if (!encoded) return null;
  return runDpapi('unprotect', encoded);
}

function loadConfig() {
  ensureDirs();
  const defaults = {
    origin: 'https://onebill.cityu-dg.edu.cn',
    meterSn: null,
    from: 'mobile',
    intervalSeconds: 60,
    dashboardPort: 17890,
    retentionDays: 400,
    browserKeepaliveMinutes: 60,
    lastAuthAt: null
  };
  if (!fs.existsSync(CONFIG_FILE)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveConfig(patch) {
  ensureDirs();
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  ROOT, DATA_DIR, PROFILE_DIR, AUTH_FILE, CONFIG_FILE, DB_FILE, LOG_FILE,
  ensureDirs, protectToken, readToken, loadConfig, saveConfig
};
