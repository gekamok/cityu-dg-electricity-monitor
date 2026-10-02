const { DatabaseSync } = require('node:sqlite');
const { DB_FILE, loadConfig } = require('./auth.cjs');

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch_ms INTEGER NOT NULL,
    sampled_at TEXT NOT NULL,
    server_updated_at TEXT,
    remain REAL NOT NULL,
    used REAL NOT NULL DEFAULT 0,
    recharged REAL NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'api'
  );
  CREATE INDEX IF NOT EXISTS idx_readings_epoch ON readings(epoch_ms);
`);

const columns = db.prepare('PRAGMA table_info(readings)').all().map(x => x.name);
if (!columns.includes('gap_seconds')) {
  db.exec('ALTER TABLE readings ADD COLUMN gap_seconds REAL');
}

const insert = db.prepare(`
  INSERT INTO readings(epoch_ms, sampled_at, server_updated_at, remain, used, recharged, source, gap_seconds)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const previous = db.prepare('SELECT epoch_ms, remain FROM readings ORDER BY id DESC LIMIT 1');

function pad(n) { return String(n).padStart(2, '0'); }
function localTimestamp(ms = Date.now()) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function dateKey(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}
function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 0, 0, 0, 0);
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2])-1 || d.getDate() !== Number(m[3])) return null;
  return d;
}
function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0, 0);
}

function addReading(reading) {
  const prev = previous.get();
  let used = 0;
  let recharged = 0;
  let gapSeconds = null;
  const now = Date.now();

  if (prev && Number.isFinite(Number(prev.remain))) {
    const diff = Number(prev.remain) - reading.remain;
    if (diff > 0.0005) used = Number(diff.toFixed(4));
    if (diff < -0.0005) recharged = Number((-diff).toFixed(4));
    gapSeconds = Math.max(0, (now - Number(prev.epoch_ms)) / 1000);
  }

  insert.run(now, localTimestamp(now), reading.updatedAt || null, reading.remain, used, recharged, 'api', gapSeconds);

  const cfg = loadConfig();
  db.prepare('DELETE FROM readings WHERE epoch_ms < ?')
    .run(now - Number(cfg.retentionDays || 400) * 86400000);

  return { ...reading, used, recharged, gapSeconds, epochMs: now, sampledAt: localTimestamp(now) };
}

function getIntervalRows(startMs, endMs) {
  const prev = db.prepare(`
    SELECT epoch_ms AS epochMs, sampled_at AS sampledAt, remain, used, recharged, gap_seconds AS gapSeconds
    FROM readings WHERE epoch_ms < ? ORDER BY epoch_ms DESC LIMIT 1
  `).get(startMs);
  const middle = db.prepare(`
    SELECT epoch_ms AS epochMs, sampled_at AS sampledAt, remain, used, recharged, gap_seconds AS gapSeconds
    FROM readings WHERE epoch_ms >= ? AND epoch_ms < ? ORDER BY epoch_ms ASC
  `).all(startMs, endMs);
  const after = db.prepare(`
    SELECT epoch_ms AS epochMs, sampled_at AS sampledAt, remain, used, recharged, gap_seconds AS gapSeconds
    FROM readings WHERE epoch_ms >= ? ORDER BY epoch_ms ASC LIMIT 1
  `).get(endMs);
  const rows = [];
  if (prev) rows.push(prev);
  rows.push(...middle);
  if (after && (!rows.length || after.epochMs !== rows[rows.length-1].epochMs)) rows.push(after);
  return rows;
}

function allocateToBuckets(buckets) {
  if (!buckets.length) return [];
  const startMs = buckets[0].startMs;
  const endMs = buckets[buckets.length-1].endMs;
  const rows = getIntervalRows(startMs, endMs);
  const cfg = loadConfig();
  const expectedInterval = Math.max(30, Number(cfg.intervalSeconds || 60));
  const longGapMs = Math.max(180000, expectedInterval * 3 * 1000);

  const out = buckets.map(b => ({
    ...b,
    used: 0,
    recharged: 0,
    estimatedUsed: 0,
    sampleCount: 0
  }));

  for (const row of rows) {
    if (row.epochMs >= startMs && row.epochMs < endMs) {
      const b = out.find(x => row.epochMs >= x.startMs && row.epochMs < x.endMs);
      if (b) {
        b.sampleCount += 1;
        if (Number(row.recharged) > 0) b.recharged += Number(row.recharged);
      }
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i-1], b = rows[i];
    const intervalStart = Number(a.epochMs), intervalEnd = Number(b.epochMs);
    if (!(intervalEnd > intervalStart)) continue;
    const delta = Number(a.remain) - Number(b.remain);
    if (!(delta > 0.0005)) continue;

    const duration = intervalEnd - intervalStart;
    for (const bucket of out) {
      if (bucket.endMs <= intervalStart) continue;
      if (bucket.startMs >= intervalEnd) break;
      const overlap = Math.max(0, Math.min(intervalEnd, bucket.endMs) - Math.max(intervalStart, bucket.startMs));
      if (!overlap) continue;
      const part = delta * overlap / duration;
      bucket.used += part;
      if (duration > longGapMs) bucket.estimatedUsed += part;
    }
  }

  return out.map(x => ({
    ...x,
    used: Number(x.used.toFixed(4)),
    recharged: Number(x.recharged.toFixed(4)),
    estimatedUsed: Number(x.estimatedUsed.toFixed(4))
  }));
}

function dayBuckets(key) {
  const d = parseDateKey(key);
  if (!d) return null;
  const buckets = [];
  for (let h=0; h<24; h++) {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
    const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h+1, 0, 0, 0);
    buckets.push({ key: pad(h)+':00', label: pad(h)+':00', startMs:s.getTime(), endMs:e.getTime() });
  }
  return buckets;
}

function dayAnalysis(key = dateKey()) {
  const d = parseDateKey(key);
  if (!d) throw new Error('invalid date');
  const start = d.getTime();
  const end = addDays(d,1).getTime();

  const samples = db.prepare(`
    SELECT epoch_ms AS epochMs, sampled_at AS sampledAt, server_updated_at AS serverUpdatedAt,
           remain, used, recharged, gap_seconds AS gapSeconds
    FROM readings WHERE epoch_ms >= ? AND epoch_ms < ? ORDER BY epoch_ms ASC
  `).all(start,end);

  const hourly = allocateToBuckets(dayBuckets(key));
  const used = hourly.reduce((s,x)=>s+x.used,0);
  const estimatedUsed = hourly.reduce((s,x)=>s+x.estimatedUsed,0);
  const recharged = hourly.reduce((s,x)=>s+x.recharged,0);
  const cfg = loadConfig();
  const expected = Math.max(1, Math.round(86400 / Math.max(30, Number(cfg.intervalSeconds || 60))));
  return {
    date: key,
    samples,
    hourly,
    summary: {
      firstRemain: samples.length ? Number(samples[0].remain) : null,
      lastRemain: samples.length ? Number(samples[samples.length-1].remain) : null,
      firstSampleAt: samples.length ? samples[0].sampledAt : null,
      lastSampleAt: samples.length ? samples[samples.length-1].sampledAt : null,
      used: Number(used.toFixed(4)),
      estimatedUsed: Number(estimatedUsed.toFixed(4)),
      recharged: Number(recharged.toFixed(4)),
      sampleCount: samples.length,
      expectedSamples: expected,
      coveragePercent: Number(Math.min(100, samples.length / expected * 100).toFixed(1))
    }
  };
}

function dailyUsage(days = 31) {
  days = Math.max(1, Math.min(400, Number(days) || 31));
  const today = new Date(); today.setHours(0,0,0,0);
  const first = addDays(today, -(days-1));
  const buckets = [];
  for (let i=0;i<days;i++) {
    const s = addDays(first,i), e=addDays(first,i+1);
    buckets.push({ key:dateKey(s), label:(s.getMonth()+1)+'/'+s.getDate(), startMs:s.getTime(), endMs:e.getTime() });
  }
  return allocateToBuckets(buckets);
}

function weeklyUsage(weeks = 12) {
  weeks = Math.max(1, Math.min(104, Number(weeks) || 12));
  const thisMonday = startOfWeek(new Date());
  const first = addDays(thisMonday, -(weeks-1)*7);
  const buckets = [];
  for (let i=0;i<weeks;i++) {
    const s=addDays(first,i*7), e=addDays(s,7);
    buckets.push({
      key:dateKey(s),
      label:(s.getMonth()+1)+'/'+s.getDate(),
      startMs:s.getTime(),
      endMs:e.getTime()
    });
  }
  return allocateToBuckets(buckets);
}

function monthlyUsage(months = 12) {
  months = Math.max(1, Math.min(36, Number(months) || 12));
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const first = addMonths(thisMonth, -(months-1));
  const buckets = [];
  for (let i=0;i<months;i++) {
    const s=addMonths(first,i), e=addMonths(first,i+1);
    buckets.push({
      key:s.getFullYear()+'-'+pad(s.getMonth()+1),
      label:s.getFullYear()+'/'+pad(s.getMonth()+1),
      startMs:s.getTime(),
      endMs:e.getTime()
    });
  }
  return allocateToBuckets(buckets);
}

function periodUsage(startMs,endMs) {
  const b = allocateToBuckets([{key:'period',label:'period',startMs,endMs}])[0];
  return b || {used:0,recharged:0,estimatedUsed:0,sampleCount:0};
}

function statusData() {
  const now = new Date();
  const current = db.prepare('SELECT * FROM readings ORDER BY id DESC LIMIT 1').get() || null;
  const today = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const week = startOfWeek(now).getTime();
  const month = new Date(now.getFullYear(),now.getMonth(),1).getTime();
  const pToday = periodUsage(today, Date.now()+1);
  const pWeek = periodUsage(week, Date.now()+1);
  const pMonth = periodUsage(month, Date.now()+1);
  return {
    current,
    todayUsage:Number(pToday.used.toFixed(4)),
    todayRecharge:Number(pToday.recharged.toFixed(4)),
    weekUsage:Number(pWeek.used.toFixed(4)),
    monthUsage:Number(pMonth.used.toFixed(4)),
    estimatedToday:Number(pToday.estimatedUsed.toFixed(4)),
    estimatedWeek:Number(pWeek.estimatedUsed.toFixed(4)),
    estimatedMonth:Number(pMonth.estimatedUsed.toFixed(4))
  };
}

function dataRange() {
  const first = db.prepare('SELECT sampled_at AS sampledAt FROM readings ORDER BY epoch_ms ASC LIMIT 1').get();
  const last = db.prepare('SELECT sampled_at AS sampledAt FROM readings ORDER BY epoch_ms DESC LIMIT 1').get();
  return {
    firstDate: first ? String(first.sampledAt).slice(0,10) : null,
    lastDate: last ? String(last.sampledAt).slice(0,10) : null,
    today: dateKey()
  };
}

function history(hours = 24) {
  const cutoff = Date.now() - Math.max(1, Math.min(720, Number(hours))) * 3600000;
  return db.prepare(`
    SELECT epoch_ms AS epochMs, sampled_at AS sampledAt, server_updated_at AS serverUpdatedAt,
           remain, used, recharged, gap_seconds AS gapSeconds
    FROM readings WHERE epoch_ms >= ? ORDER BY epoch_ms ASC
  `).all(cutoff);
}

function close() { db.close(); }

module.exports = {
  addReading, statusData, history, dayAnalysis, dailyUsage, weeklyUsage, monthlyUsage, dataRange, close
};
