@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title QC-TAHLIL - report converter (qc.py)

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

%PYEXE% %PYARGS% --version >nul 2>nul
if errorlevel 1 goto :nopython

%PYEXE% %PYARGS% -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo  openpyxl نصب نیست؛ نصبِ خودکار ...
  call "%~dp0install_windows.bat"
)

%PYEXE% %PYARGS% "%~dp0qc.py" --gui
if errorlevel 1 (
  echo.
  echo  ابزار تبدیل با خطا بسته شد - converter failed. پیامِ بالا را بخوانید.
  pause
)
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
echo  [خطا / ERROR] پایتون پیدا نشد - Python was not found.
echo  install_windows.bat را اجرا کنید یا پایتون را از python.org نصب کنید
echo  (تیکِ  "Add python.exe to PATH"  فراموش نشود).
echo.
pause

:end
endlocal
