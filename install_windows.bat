@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title QC-TAHLIL - install requirements (openpyxl)

echo.
echo  === پیدا کردنِ پایتون / Finding Python ===
set "PYEXE="
set "PYARGS="
call :try "%ProgramFiles%\Python314\python.exe"
call :try "%ProgramFiles%\Python313\python.exe"
call :try "%ProgramFiles%\Python312\python.exe"
call :try "%ProgramFiles%\Python311\python.exe"
call :try "%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
call :try "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
call :try "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
call :try "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
call :trywhere py "-3"
call :trywhere python ""
call :trywhere python3 ""
if not defined PYEXE goto :nopython

rem «اشاره‌گرِ فروشگاه مایکروسافت» پایتونِ واقعی نیست؛ باید نسخه چاپ کند
%PYEXE% %PYARGS% --version >nul 2>nul
if errorlevel 1 goto :nopython
%PYEXE% %PYARGS% --version
echo.

echo  === نصبِ openpyxl / pip install -r requirements.txt ===
%PYEXE% %PYARGS% -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo.
  echo  تلاشِ دوباره با دسترسیِ کاربر ... retrying with --user
  %PYEXE% %PYARGS% -m pip install --user --disable-pip-version-check -r "%~dp0requirements.txt"
)
echo.

echo  === بررسی / verify ===
%PYEXE% %PYARGS% -c "import openpyxl; print('openpyxl', openpyxl.__version__)"
if errorlevel 1 goto :failed

echo.
echo  [موفق / OK] ابزار تبدیل آماده است.
echo  حالا سامانه فایل‌های پوشهٔ data/raw را خودش تبدیل می‌کند؛ یا run_windows.bat را اجرا کنید.
echo  If the dashboard still shows no data, open the admin page and press the force-convert button.
goto :end

:try
if defined PYEXE exit /b
if exist "%~1" set PYEXE="%~1"
exit /b

:trywhere
if defined PYEXE exit /b
where %~1 >nul 2>nul
if not errorlevel 1 set PYEXE=%~1& set "PYARGS=%~2"
exit /b

:nopython
echo.
echo  [خطا / ERROR] پایتون روی این سیستم پیدا نشد - Python was not found.
echo  1) دانلود و نصبِ پایتون:  https://www.python.org/downloads/windows/
echo  2) در نخستین صفحهٔ نصب تیکِ  "Add python.exe to PATH"  را بزنید.
echo  3) دوباره همین فایل را اجرا کنید.
echo.
echo  راهِ دیگر بدونِ پایتون: یک «QC Report ...» آماده را در پوشهٔ data/clean بگذارید.
goto :end

:failed
echo.
echo  [خطا / ERROR] نصبِ openpyxl ناموفق بود - pip install failed.
echo  اگر اینترنت کند یا فیلتر است، با فیلترشکن یا در زمانی دیگر این دستور را بزنید:
echo      %PYEXE% %PYARGS% -m pip install openpyxl
echo.
echo  راهِ دیگر بدونِ پایتون: یک «QC Report ...» آماده را در پوشهٔ data/clean بگذارید.
goto :end

:end
echo.
pause
endlocal
