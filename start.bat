@echo off
chcp 65001 >nul
setlocal
title سامانه گزارشات کیفیت
cd /d "%~dp0"

echo.
echo ==================================================
echo    سامانه گزارشات کیفیت - در حال راه اندازی
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js روی این رایانه نصب نیست.
  echo.
  echo لطفا Node.js نسخه LTS را از آدرس زیر نصب کنید و دوباره این فایل را اجرا کنید:
  echo      https://nodejs.org
  echo.
  pause
  start https://nodejs.org
  exit /b 1
)

if not exist "node_modules\" (
  echo در حال نصب وابستگی ها - فقط بار اول - ممکن است چند دقیقه طول بکشد...
  call npm install
  if errorlevel 1 (
    echo.
    echo [خطا] نصب وابستگی ها ناموفق بود. پیام بالا را بررسی کنید.
    pause
    exit /b 1
  )
)

echo.
echo سرور اجرا می شود. مرورگر روی آدرس زیر باز خواهد شد:
echo      http://localhost:3000
echo.
echo به روز رساني خودكار فعال است:
echo   فايل خام جديد را در پوشه  data\raw  كپي كنيد؛ سامانه خودش
echo   تبديل، بارگذاري و همه صفحه ها را به روز مي كند (بدون دستور).
echo   وضعیت را در صفحه «مدیریت داده و کاربران» ببینید.
echo.
echo برای توقف برنامه همین پنجره را ببندید.
echo.

start "" http://localhost:3000
call npm start

echo.
echo برنامه متوقف شد.
pause
