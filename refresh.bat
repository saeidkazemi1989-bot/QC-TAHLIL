@echo off
chcp 65001 >nul
setlocal
title به روز رساني داده هاي كيفيت
cd /d "%~dp0"

echo.
echo ==================================================
echo   تميز كردن گزارش ها و بارگذاري در داشبورد
echo ==================================================
echo.

call npm run refresh

echo.
pause
