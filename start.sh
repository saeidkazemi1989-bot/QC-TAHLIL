#!/usr/bin/env bash
# اجرای سامانه گزارشات کیفیت (لینوکس/مک)
cd "$(dirname "$0")"

echo "============================================"
echo "  سامانه گزارشات کیفیت - در حال راه‌اندازی"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[خطا] Node.js نصب نیست. لطفاً از https://nodejs.org نسخه LTS را نصب کنید."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "در حال نصب وابستگی‌ها (فقط بار اول)..."
  npm install || { echo "[خطا] نصب وابستگی‌ها ناموفق بود."; exit 1; }
fi

echo "سرور روی http://localhost:3000 اجرا می‌شود (برای توقف: Ctrl+C)"
echo "به‌روزرسانی خودکار فعال است: فایل خام تازه را در پوشه data/raw کپی کنید."
(sleep 2 && (xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null)) &
npm start
