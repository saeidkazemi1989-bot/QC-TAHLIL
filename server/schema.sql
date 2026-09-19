-- ============================================================
-- طرح پایگاه داده سامانه گزارشات کیفیت (QC-TAHLIL)
-- SQLite | جداول بعدی (dim) + جداول واقعیت (fact) + نماهای تحلیلی
-- ============================================================

PRAGMA journal_mode = WAL;

-- ---------- ثبت ورود داده‌ها ----------
CREATE TABLE IF NOT EXISTS import_file (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name     TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  rows_in       INTEGER DEFAULT 0,
  rows_loaded   INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'ok',
  message       TEXT,
  file_size     INTEGER,
  imported_at   TEXT NOT NULL,
  UNIQUE(file_name, source_type)
);

-- ---------- جدول تقویم شمسی ----------
CREATE TABLE IF NOT EXISTS dim_date (
  jdate             TEXT PRIMARY KEY,      -- 1405/05/26
  jyear             INTEGER,
  jmonth            INTEGER,
  jday              INTEGER,
  jmonth_name       TEXT,                  -- مرداد
  jmonth_label      TEXT,                  -- 1405/05
  jmonth_name_label TEXT,                  -- مرداد 1405
  jyear_label       TEXT,
  jquarter          INTEGER,
  jquarter_label    TEXT,                  -- 1405 / فصل 2
  jquarter_name     TEXT,
  jhalf             INTEGER,
  jhalf_label       TEXT,
  jhalf_name        TEXT,
  jweek             INTEGER,
  jweek_label       TEXT,                  -- هفته 22 1405
  jweek_start       TEXT,
  jweekday          INTEGER,               -- 0 = شنبه
  jweekday_name     TEXT,
  gdate             TEXT                   -- 2026-08-17
);

-- ---------- بعد محصول ----------
CREATE TABLE IF NOT EXISTS dim_product (
  product_code    TEXT PRIMARY KEY,
  product_name    TEXT,
  product_full    TEXT,
  product_family  TEXT,
  product_combined TEXT,
  final_group     TEXT,
  branch          TEXT
);

-- ---------- بعد کد عیب ----------
CREATE TABLE IF NOT EXISTS dim_defect (
  defect_code   TEXT PRIMARY KEY,
  defect_desc   TEXT,
  defect_group  TEXT
);

-- ---------- بعد ایستگاه ----------
CREATE TABLE IF NOT EXISTS dim_station (
  station        TEXT PRIMARY KEY,
  process_domain TEXT,
  branch         TEXT
);

-- ---------- بعد مرکز کاری (تولید) ----------
CREATE TABLE IF NOT EXISTS dim_workcenter (
  work_center    TEXT PRIMARY KEY,
  process_domain TEXT,
  branch         TEXT
);

-- ---------- واقعیت: سفارش‌های تولید ----------
CREATE TABLE IF NOT EXISTS fact_order (
  order_no     TEXT PRIMARY KEY,
  order_date   TEXT,
  shift        TEXT,
  product_code TEXT,
  station      TEXT,
  planned_qty  REAL,
  sound_qty    REAL,
  scrap_qty    REAL,
  sources      TEXT
);
CREATE INDEX IF NOT EXISTS ix_order_date    ON fact_order(order_date);
CREATE INDEX IF NOT EXISTS ix_order_product ON fact_order(product_code);
CREATE INDEX IF NOT EXISTS ix_order_station ON fact_order(station);

-- ---------- واقعیت: عیوب حین تولید (ریز اطلاعات) ----------
CREATE TABLE IF NOT EXISTS fact_inprocess (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  src_file            TEXT,
  src_row             INTEGER,
  order_no            TEXT,
  order_date          TEXT,
  product_code        TEXT,
  product_name        TEXT,
  station             TEXT,
  station_group       TEXT,
  process_name        TEXT,
  process_code        TEXT,
  defect_code         TEXT,
  defect_desc         TEXT,
  defect_qty          REAL,
  related_defect_qty  REAL,
  scrap_qty           REAL,
  sound_qty           REAL,
  fix_time_min        REAL,
  retest_time_min     REAL,
  troubleshoot_time_min REAL,
  cause_6m            TEXT,
  failure_mode        TEXT,
  failure_mode_type   TEXT,
  severity            REAL,
  occurrence          REAL,
  detection           REAL,
  rpn                 REAL,
  part_code           TEXT,
  part_name           TEXT,
  part_family         TEXT,
  supplier            TEXT,
  tool                TEXT,
  location            TEXT,
  repair_action       TEXT,
  repair_desc         TEXT,
  inspector           TEXT,
  operator_name       TEXT,
  registrar           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inprocess_src ON fact_inprocess(src_file, src_row);
CREATE INDEX IF NOT EXISTS ix_ip_date    ON fact_inprocess(order_date);
CREATE INDEX IF NOT EXISTS ix_ip_order   ON fact_inprocess(order_no);
CREATE INDEX IF NOT EXISTS ix_ip_defect  ON fact_inprocess(defect_code);
CREATE INDEX IF NOT EXISTS ix_ip_station ON fact_inprocess(station);
CREATE INDEX IF NOT EXISTS ix_ip_product ON fact_inprocess(product_code);
CREATE INDEX IF NOT EXISTS ix_ip_6m      ON fact_inprocess(cause_6m);

-- ---------- واقعیت: عیوب اسناد بازرسی ----------
CREATE TABLE IF NOT EXISTS fact_inspection (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  src_file     TEXT,
  src_row      INTEGER,
  order_no     TEXT,
  order_date   TEXT,
  shift        TEXT,
  product_code TEXT,
  product_name TEXT,
  station      TEXT,
  operation    TEXT,
  planned_qty  REAL,
  sound_qty    REAL,
  scrap_qty    REAL,
  defect_code  TEXT,
  defect_desc  TEXT,
  defect_qty   REAL,
  op_seq       INTEGER DEFAULT 1   -- 1 = رکورد اصلی (برای حذف تکرار عملیات‌های تکراری)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_insp_src ON fact_inspection(src_file, src_row);
CREATE INDEX IF NOT EXISTS ix_ins_date    ON fact_inspection(order_date);
CREATE INDEX IF NOT EXISTS ix_ins_order   ON fact_inspection(order_no);
CREATE INDEX IF NOT EXISTS ix_ins_defect  ON fact_inspection(defect_code);
CREATE INDEX IF NOT EXISTS ix_ins_station ON fact_inspection(station);
CREATE INDEX IF NOT EXISTS ix_ins_product ON fact_inspection(product_code);
CREATE INDEX IF NOT EXISTS ix_ins_op      ON fact_inspection(operation);
CREATE INDEX IF NOT EXISTS ix_ins_seq     ON fact_inspection(op_seq);

-- ---------- واقعیت: تولید روزانه به تفکیک مرکز کاری ----------
CREATE TABLE IF NOT EXISTS fact_production (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  src_file       TEXT,
  src_row        INTEGER,
  production_date TEXT,
  product_code   TEXT,
  product_name   TEXT,
  work_center    TEXT,
  sound_qty      REAL,
  scrap_qty      REAL,
  personnel      REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prod_src ON fact_production(src_file, src_row);
CREATE INDEX IF NOT EXISTS ix_prod_date ON fact_production(production_date);
CREATE INDEX IF NOT EXISTS ix_prod_wc   ON fact_production(work_center);
CREATE INDEX IF NOT EXISTS ix_prod_prod ON fact_production(product_code);

-- ---------- کاربران و تنظیمات ----------
CREATE TABLE IF NOT EXISTS app_user (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT UNIQUE,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'expert',
  password_hash TEXT,
  active       INTEGER DEFAULT 1,
  created_at   TEXT
);

CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT,
  label TEXT,
  description TEXT
);

-- ---------- نماهای تحلیلی ----------
DROP VIEW IF EXISTS v_inprocess;
CREATE VIEW v_inprocess AS
SELECT i.*,
       COALESCE(p.branch, 'نامشخص')      AS branch,
       COALESCE(p.product_family, 'نامشخص') AS product_family,
       COALESCE(p.product_combined, p.product_name, 'نامشخص') AS product_combined,
       COALESCE(p.final_group, 'نامشخص') AS final_group,
       COALESCE(p.product_name, i.product_code) AS product_name_dim,
       s.process_domain,
       df.defect_group, d.jdate,
       d.jyear, d.jmonth, d.jmonth_label, d.jmonth_name_label,
       d.jquarter_label, d.jquarter_name, d.jhalf_label,
       d.jweek_label, d.jweekday_name
FROM fact_inprocess i
LEFT JOIN dim_product p ON p.product_code = i.product_code
LEFT JOIN dim_station s ON s.station = i.station
LEFT JOIN dim_defect  df ON df.defect_code = i.defect_code
LEFT JOIN dim_date    d ON d.jdate = i.order_date;

DROP VIEW IF EXISTS v_inspection;
CREATE VIEW v_inspection AS
SELECT i.*,
       COALESCE(p.branch, 'نامشخص')      AS branch,
       COALESCE(p.product_family, 'نامشخص') AS product_family,
       COALESCE(p.product_combined, p.product_name, 'نامشخص') AS product_combined,
       COALESCE(p.final_group, 'نامشخص') AS final_group,
       COALESCE(p.product_name, i.product_code) AS product_name_dim,
       s.process_domain,
       df.defect_group, d.jdate,
       d.jyear, d.jmonth, d.jmonth_label, d.jmonth_name_label,
       d.jquarter_label, d.jquarter_name, d.jhalf_label,
       d.jweek_label, d.jweekday_name
FROM fact_inspection i
LEFT JOIN dim_product p ON p.product_code = i.product_code
LEFT JOIN dim_station s ON s.station = i.station
LEFT JOIN dim_defect  df ON df.defect_code = i.defect_code
LEFT JOIN dim_date    d ON d.jdate = i.order_date;

DROP VIEW IF EXISTS v_production;
CREATE VIEW v_production AS
SELECT f.*,
       COALESCE(p.branch, 'نامشخص') AS branch,
       COALESCE(p.product_family, 'نامشخص') AS product_family,
       COALESCE(p.final_group, 'نامشخص') AS final_group,
       COALESCE(p.product_name, f.product_name) AS product_name_dim,
       COALESCE(w.process_domain, 'سایر') AS process_domain,
       d.jdate,
       d.jyear, d.jmonth, d.jmonth_label, d.jmonth_name_label,
       d.jweek_label
FROM fact_production f
LEFT JOIN dim_product   p ON p.product_code = f.product_code
LEFT JOIN dim_workcenter w ON w.work_center = f.work_center
LEFT JOIN dim_date      d ON d.jdate = f.production_date;

DROP VIEW IF EXISTS v_order;
CREATE VIEW v_order AS
SELECT o.*,
       COALESCE(p.branch, 'نامشخص') AS branch,
       COALESCE(p.product_family, 'نامشخص') AS product_family,
       COALESCE(p.product_combined, p.product_name, 'نامشخص') AS product_combined,
       COALESCE(p.final_group, 'نامشخص') AS final_group,
       COALESCE(p.product_name, o.product_code) AS product_name_dim,
       COALESCE(s.process_domain, 'سایر') AS process_domain,
       d.jyear, d.jmonth, d.jmonth_label, d.jmonth_name_label,
       d.jquarter_label, d.jhalf_label, d.jweek_label
FROM fact_order o
LEFT JOIN dim_product p ON p.product_code = o.product_code
LEFT JOIN dim_station s ON s.station = o.station
LEFT JOIN dim_date    d ON d.jdate = o.order_date;
