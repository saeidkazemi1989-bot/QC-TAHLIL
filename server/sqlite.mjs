/**
 * لایه‌ی سازگار پایگاه داده
 * ---------------------------------------------------------------
 * اولویت اول: SQLite داخلی خود Node (بدون نیاز به هیچ نصب اضافه، Node 22 به بالا)
 * اولویت دوم: بسته‌ی better-sqlite3 در صورت نصب بودن (برای نسخه‌های قدیمی‌تر Node)
 *
 * هدف: نصب و اجرای برنامه در هر محیطی بدون دردسر کامپایل انجام شود.
 */
const warnings = [];

/** حذف هشدارِ آزمایشی بودن SQLite در Node (برای اینکه خروجی برنامه شلوغ نشود) */
function silenceExperimentalWarning() {
  const original = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) return undefined;
    if (warning && warning.name === 'ExperimentalWarning' && String(warning.message || '').includes('SQLite')) return undefined;
    return original.call(process, warning, ...rest);
  };
}

function wrapNodeSqlite(db) {
  return {
    driver: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    pragma: (sql) => db.exec(`PRAGMA ${sql}`),
    close: () => db.close(),
    transaction(fn) {
      return (...args) => {
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          try { db.exec('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        }
      };
    }
  };
}

function wrapBetterSqlite(db) {
  return {
    driver: 'better-sqlite3',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    pragma: (sql) => db.pragma(sql),
    close: () => db.close(),
    transaction: (fn) => db.transaction(fn)
  };
}

/**
 * باز کردن پایگاه داده
 * @param {string} file مسیر فایل پایگاه داده
 */
export async function openDatabase(file) {
  silenceExperimentalWarning();
  // ۱) SQLite داخلی Node
  try {
    const mod = await import('node:sqlite');
    const DatabaseSync = mod.DatabaseSync || mod.default?.DatabaseSync;
    if (DatabaseSync) {
      const db = new DatabaseSync(file);
      const wrapped = wrapNodeSqlite(db);
      wrapped.pragma('journal_mode = WAL');
      return wrapped;
    }
  } catch (err) {
    warnings.push(`SQLite داخلی Node در دسترس نیست: ${err.message}`);
  }

  // ۲) بسته‌ی better-sqlite3
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(file);
    const wrapped = wrapBetterSqlite(db);
    wrapped.pragma('journal_mode = WAL');
    return wrapped;
  } catch (err) {
    warnings.push(`better-sqlite3 در دسترس نیست: ${err.message}`);
  }

  throw new Error(
    'هیچ موتور پایگاه داده‌ای در دسترس نیست.\n' +
    'برای اجرای برنامه، Node.js نسخه ۲۲ یا بالاتر نصب کنید (توصیه می‌شود) ' +
    'یا بسته‌ی better-sqlite3 را نصب کنید: npm install better-sqlite3\n' +
    `جزئیات: ${warnings.join(' | ')}`
  );
}

export function driverWarnings() {
  return warnings.slice();
}
