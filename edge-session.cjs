const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

function edgePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(fs.existsSync) || candidates[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDevToolsPort(profileDir, child, timeoutMs = 15000) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('Edge exited before DevTools became available');
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
    await sleep(150);
  }
  throw new Error('Timed out waiting for Edge DevTools port');
}

async function launchEdgeSession({ profileDir, url, headless = false }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try { fs.unlinkSync(portFile); } catch {}

  const args = [
    '--user-data-dir=' + profileDir,
    '--profile-directory=Default',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience'
  ];
  if (headless) args.push('--headless=new');
  args.push(url || 'about:blank');

  const child = spawn(edgePath(), args, {
    windowsHide: headless,
    stdio: 'ignore'
  });

  let browser;
  try {
    const port = await waitForDevToolsPort(profileDir, child);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Edge context unavailable');
    let page = context.pages().find(p => p.url() !== 'about:blank') || context.pages()[0];
    if (!page) page = await context.newPage();

    const close = async () => {
      try { await browser.close(); } catch {}
      if (child.exitCode == null) {
        try { child.kill(); } catch {}
      }
      try { fs.unlinkSync(portFile); } catch {}
    };

    return { browser, context, page, child, close };
  } catch (error) {
    try { if (browser) await browser.close(); } catch {}
    if (child.exitCode == null) {
      try { child.kill(); } catch {}
    }
    try { fs.unlinkSync(portFile); } catch {}
    throw error;
  }
}

module.exports = { launchEdgeSession, sleep };
