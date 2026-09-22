/**
 * سرور سامانه گزارشات کیفیت
 * ---------------------------------------------------------------
 * - سرویس فایل‌های ثابت رابط کاربری
 * - API تحلیلی (شاخص‌ها، روند، تفکیک‌ها، PFMEA، رکوردها، تولید)
 * - مدیریت: بارگذاری مجدد داده، آپلود فایل اکسل، کاربران، تنظیمات
 */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

import { getDb, ready as dbReady, getSettings, setSetting, RAW_DIR, CLEAN_DIR, ROOT } from './db.mjs';
import { runImport } from './etl.mjs';
import { parseFilters } from './filters.mjs';
import { checkDefectCounts } from './countcheck.mjs';
import { insights } from './insights.mjs';
import { refreshAll, rebuildFromRaw, pipelineStatus, startWatcher, computeDataVersion, adoptExistingClean } from './pipeline.mjs';
import {
  summary, trend, breakdown, pfmea, records, recordColumns,
  productionSummary, productionTrend, productionBreakdown, meta, DIMENSIONS, matrix, times,
  drillTree
} from './analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SECRET = process.env.QC_SECRET || 'qc-tahlil-local-secret';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------- احراز هویت ساده
const ROLE_LABELS = { admin: 'مدیر سیستم', executive: 'مدیر ارشد', expert: 'کارشناس کیفیت' };
const ROLE_PAGES = {
  admin: ['home', 'analyst', 'drill', 'management', 'inprocess', 'inspection', 'pfmea', 'production', 'records', 'admin', 'guide'],
  executive: ['home', 'analyst', 'drill', 'management', 'production', 'guide'],
  expert: ['home', 'analyst', 'drill', 'inprocess', 'inspection', 'pfmea', 'production', 'records', 'guide']
};

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

function authFromReq(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  const payload = verify(token);
  if (!payload) return null;
  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, role, active FROM app_user WHERE username = ?').get(payload.u);
  if (!user || !user.active) return null;
  return user;
}

function requireAuth(req, res, next) {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'نیاز به ورود به سامانه' });
  req.user = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'نیاز به ورود به سامانه' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'دسترسی به این بخش برای نقش شما مجاز نیست' });
    }
    return next();
  };
}

app.post('/api/auth/login', (req, res) => {
  const db = getDb();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username) return res.status(400).json({ error: 'نام کاربری را انتخاب کنید' });
  const user = db.prepare('SELECT id, username, display_name, role, active, password_hash FROM app_user WHERE username = ?').get(username);
  if (!user || !user.active) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (user.password_hash) {
    const hash = crypto.createHash('sha256').update(password + SECRET).digest('hex');
    if (hash !== user.password_hash) return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  }
  const token = sign({ u: user.username, r: user.role, t: Date.now() });
  res.json({
    token,
    user: {
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      role_label: ROLE_LABELS[user.role] || user.role,
      pages: ROLE_PAGES[user.role] || ROLE_PAGES.expert
    }
  });
});

app.get('/api/auth/users', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT username, display_name, role, active, password_hash FROM app_user WHERE active = 1 ORDER BY id').all();
  res.json({
    users: users.map((u) => ({
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      role_label: ROLE_LABELS[u.role] || u.role,
      has_password: !!u.password_hash,
      pages: ROLE_PAGES[u.role] || ROLE_PAGES.expert
    })),
    roles: Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label, pages: ROLE_PAGES[id] }))
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      username: req.user.username,
      display_name: req.user.display_name,
      role: req.user.role,
      role_label: ROLE_LABELS[req.user.role] || req.user.role,
      pages: ROLE_PAGES[req.user.role] || ROLE_PAGES.expert
    }
  });
});

// ---------------------------------------------------------------- API تحلیلی
app.get('/api/meta', requireAuth, (req, res) => {
  const db = getDb();
  const settings = getSettings();
  res.json({
    ...meta(),
    dimensions: Object.entries(DIMENSIONS).map(([id, d]) => ({ id, label: d.label, sources: d.sources })),
    role: req.user.role,
    pages: ROLE_PAGES[req.user.role] || ROLE_PAGES.expert,
    settings,
    imports: db.prepare('SELECT * FROM import_file ORDER BY imported_at DESC').all()
  });
});

app.get('/api/summary', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  res.json(summary(f, f.source));
});

// تحلیلگر خودکار: کلیات + آلارم‌ها + TOP 10 توضیحات تعمیرات (با محصول و فرآیند)
app.get('/api/insights', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  res.json(insights(f, f.source));
});

// تحلیل گام‌به‌گام: روز → محصول → کد عیب → ریز رکوردها (با توضیحات تعمیرات)
app.get('/api/drill', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  res.json(drillTree(f, f.source));
});

app.get('/api/trend', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  res.json(trend(f, f.source, req.query.group || 'month'));
});

app.get('/api/breakdown', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  const dim = DIMENSIONS[req.query.dim] ? req.query.dim : 'station';
  res.json(breakdown(f, f.source, dim, Number(req.query.limit) || 25));
});

app.get('/api/matrix', requireAuth, (req, res) => {
  const f = parseFilters(req.query);
  res.json(matrix(f, f.source, req.query.row || 'defect', req.query.col || 'station',
    Number(req.query.rows) || 15, Number(req.query.cols) || 10));
});

app.get('/api/times', requireAuth, (req, res) => {
  const f = parseFilters({ ...req.query, source: 'inprocess' });
  res.json(times(f, req.query.dim || 'station', Number(req.query.limit) || 15));
});

app.get('/api/pfmea', requireAuth, (req, res) => {
  const f = parseFilters({ ...req.query, source: 'inprocess' });
  res.json(pfmea(f, Number(req.query.limit) || 60));
});

app.get('/api/records', requireAuth, requireRole('expert', 'admin'), (req, res) => {
  const f = parseFilters(req.query);
  const result = records(f, f.source, {
    page: req.query.page, size: req.query.size, sort: req.query.sort, dir: req.query.dir
  });
  res.json({ ...result, columns: recordColumns(f.source) });
});

app.get('/api/production/summary', requireAuth, (req, res) => {
  res.json(productionSummary(parseFilters(req.query)));
});

app.get('/api/production/trend', requireAuth, (req, res) => {
  res.json(productionTrend(parseFilters(req.query), req.query.group || 'day'));
});

app.get('/api/production/breakdown', requireAuth, (req, res) => {
  res.json(productionBreakdown(parseFilters(req.query), req.query.dim || 'work_center', Number(req.query.limit) || 30));
});

// ---------------------------------------------------------------- مدیریت داده
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RAW_DIR),
    filename: (req, file, cb) => {
      const raw = Buffer.from(file.originalname || 'upload.xlsx', 'latin1').toString('utf8');
      const safe = path.basename(raw).replace(/[\\/:*?"<>|~$]/g, '_');
      cb(null, safe);
    }
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xlsm)$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('تنها فایل‌های اکسل با پسوند xlsx پذیرفته می‌شود'));
  }
});

app.post('/api/admin/upload', requireAuth, requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  try {
    // فایل در data/raw ذخیره شده؛ حالا کل زنجیره خودش اجرا می‌شود:
    // تبدیل با qc.py (اگر لازم باشد) ← بارگذاری در پایگاه ← به‌روزرسانی داشبورد
    const result = await refreshAll({ reason: `upload:${req.file.filename}` });
    res.json({ ok: result.ok !== false, file: req.file.filename, result });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/admin/refresh', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await refreshAll({ reason: 'manual', forceClean: req.query.force === '1' });
    res.json({ ok: result.ok !== false, result });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * بازسازیِ کامل: همهٔ گزارش‌های تمیزِ data/clean پاک می‌شوند و داده‌ها فقط از
 * فایل‌های خامِ فعلیِ data/raw از نو ساخته می‌شوند (برای گذر از دادهٔ آزمایشی به واقعی).
 */
app.post('/api/admin/rebuild', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await rebuildFromRaw({ reason: 'rebuild' });
    res.json({ ok: r.ok, message: r.message, removed: r.removed, result: r.result, data_version: r.data_version });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** وضعیت به‌روزرسانی خودکار (برای نمایش در صفحهٔ مدیریت) */
app.get('/api/admin/pipeline', requireAuth, requireRole('admin'), (req, res) => {
  res.json(pipelineStatus());
});

app.get('/api/admin/files', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  const collect = (dir, folder) => (fs.existsSync(dir)
    ? fs.readdirSync(dir)
      .filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        const rec = db.prepare('SELECT source_type, rows_loaded, imported_at, status, message FROM import_file WHERE file_name = ?').all(f);
        return { name: f, folder, size: stat.size, modified: stat.mtime.toISOString(), records: rec };
      })
    : []);
  res.json({
    files: [...collect(RAW_DIR, 'raw'), ...collect(CLEAN_DIR, 'clean')],
    pipeline: pipelineStatus()
  });
});

app.delete('/api/admin/files/:name', requireAuth, requireRole('admin'), async (req, res) => {
  const name = path.basename(req.params.name);
  const p = [RAW_DIR, CLEAN_DIR].map((d) => path.join(d, name)).find((x) => fs.existsSync(x));
  if (!p) return res.status(404).json({ error: 'فایل یافت نشد' });
  fs.unlinkSync(p);
  const db = getDb();
  db.prepare('DELETE FROM fact_inprocess WHERE src_file = ?').run(name);
  db.prepare('DELETE FROM fact_inspection WHERE src_file = ?').run(name);
  db.prepare('DELETE FROM fact_production WHERE src_file = ?').run(name);
  db.prepare('DELETE FROM import_file WHERE file_name = ?').run(name);
  // پس از حذف، آمار و ابعاد دوباره ساخته می‌شود تا عددِ اشتباهی در داشبورد نماند
  try { await refreshAll({ reason: `delete:${name}`, removeMissing: true }); } catch { /* ignore */ }
  res.json({ ok: true, deleted: name, data_version: computeDataVersion() });
});

/** بررسی شمارش عیب‌های فایل جامع کیفیت (تعداد عیب مربوطه در برابر تعداد عیب) */
app.get('/api/admin/check-counts', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await checkDefectCounts(RAW_DIR);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT id, username, display_name, role, active, created_at, (password_hash IS NOT NULL) AS has_password FROM app_user ORDER BY id').all());
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  const { username, display_name, role, password } = req.body || {};
  if (!username || !role) return res.status(400).json({ error: 'نام کاربری و نقش الزامی است' });
  if (!ROLE_LABELS[role]) return res.status(400).json({ error: 'نقش نامعتبر' });
  const hash = password ? crypto.createHash('sha256').update(String(password) + SECRET).digest('hex') : null;
  try {
    db.prepare('INSERT INTO app_user (username, display_name, role, password_hash, active, created_at) VALUES (?,?,?,?,1,?)')
      .run(String(username).trim(), display_name || username, role, hash, new Date().toISOString());
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'نام کاربری تکراری است' });
  }
});

app.put('/api/admin/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  const { display_name, role, password, active, username } = req.body || {};
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM app_user WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const newRole = ROLE_LABELS[role] ? role : current.role;
  let hash = current.password_hash;
  if (password === '') hash = null;
  else if (password) hash = crypto.createHash('sha256').update(String(password) + SECRET).digest('hex');
  db.prepare('UPDATE app_user SET username = ?, display_name = ?, role = ?, password_hash = ?, active = ? WHERE id = ?')
    .run(String(username || current.username).trim(), display_name || current.display_name, newRole, hash,
      active === undefined ? current.active : (active ? 1 : 0), id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM app_user WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT key, value, label, description FROM app_setting').all());
});

app.put('/api/admin/settings', requireAuth, requireRole('admin'), (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [k, v] of entries) setSetting(k, v);
  res.json({ ok: true, settings: getSettings() });
});

// ---------------------------------------------------------------- فایل‌های ثابت
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

app.get('/api/health', (req, res) => {
  const db = getDb();
  const counts = {
    inprocess: db.prepare('SELECT COUNT(*) c FROM fact_inprocess').get().c,
    inspection: db.prepare('SELECT COUNT(*) c FROM fact_inspection').get().c,
    production: db.prepare('SELECT COUNT(*) c FROM fact_production').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM fact_order').get().c
  };
  res.json({
    ok: true,
    counts,
    data_version: pipelineStatus().data_version || computeDataVersion(),
    watcher: pipelineStatus()
  });
});

// هر مسیر ناشناخته به رابط کاربری هدایت می‌شود (SPA)
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------- راه‌اندازی
async function bootstrap() {
  await dbReady;
  const db = getDb();
  const hasData = db.prepare('SELECT COUNT(*) c FROM import_file').get().c > 0;
  if (!hasData) {
    console.log('[server] پایگاه داده خالی است؛ بارگذاری خودکار فایل‌های اکسل...');
    try {
      await runImport({ removeMissing: true });
    } catch (err) {
      console.error('[server] خطا در بارگذاری خودکار:', err.message);
    }
  }
  adoptExistingClean();
  app.listen(PORT, HOST, () => {
    console.log(`[server] سامانه گزارشات کیفیت آماده است: http://${HOST}:${PORT}`);
    console.log(`[server] پوشه داده‌ها: ${RAW_DIR}`);
    if (process.env.QC_WATCH === '0') {
      console.log('[server] به‌روزرسانی خودکار غیرفعال است (QC_WATCH=0)');
    } else {
      startWatcher({ intervalMs: Number(process.env.QC_WATCH_INTERVAL) || 10000 });
      console.log('[server] به‌روزرسانی خودکار فعال است: فایل تازه در data/raw ⇒ تبدیل + بارگذاری + به‌روزرسانی داشبورد');
    }
  });
}

bootstrap();

export default app;
