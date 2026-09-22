/** ساختِ خودکارِ باندل‌های آزمون — تا بعد از پاک‌شدنِ /tmp یا کلونِ تازه، آزمون‌ها خودشان سرِپا شوند */
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const REPO = '/home/user/QC-TAHLIL';
export const TMP_BUNDLE = '/tmp/bundle.js';
export const TEST_BUNDLE = path.join(REPO, 'tools', 'qc-test', 'testbundle.js');
export const STATIC_HTML = path.join(REPO, 'QC-Dashboard.html');

const newestJs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
  .map((f) => fs.statSync(path.join(dir, f)).mtimeMs).sort((a, b) => b - a)[0] || 0;

/**
 * باندلِ رابط (از public/js) و باندلِ آزمون (از testentry.js) را در صورت نبود یا کهنه‌بودن می‌سازد.
 * @returns {Promise<{tmp:string, test:string}>}
 */
export async function ensureBundles() {
  const srcAt = newestJs(path.join(REPO, 'public', 'js'));
  const stale = (f) => !fs.existsSync(f) || fs.statSync(f).mtimeMs < srcAt;
  if (stale(TMP_BUNDLE)) {
    await esbuild.build({ entryPoints: [path.join(REPO, 'public', 'js', 'main.js')], bundle: true, outfile: TMP_BUNDLE, format: 'iife', platform: 'browser', logLevel: 'warning' });
  }
  if (stale(TEST_BUNDLE)) {
    await esbuild.build({ entryPoints: [path.join(REPO, 'tools', 'qc-test', 'testentry.js')], bundle: true, outfile: TEST_BUNDLE, format: 'esm', platform: 'browser', logLevel: 'warning' });
  }
  return { tmp: TMP_BUNDLE, test: TEST_BUNDLE };
}

/** نسخهٔ تک‌فایل آفلاین لازم است؛ اگر نبود به‌جای خطایِ خام، راهنما می‌دهد (کدِ خروج ۲ = اجرا نشد) */
export function needStatic(label = 'این آزمون') {
  if (fs.existsSync(STATIC_HTML)) return STATIC_HTML;
  console.log(`⚠️  ${label} به فایل تک‌فایل نیاز دارد ولی QC-Dashboard.html ساخته نشده؛ اول «npm run export» را اجرا کنید.`);
  process.exit(2);
}
