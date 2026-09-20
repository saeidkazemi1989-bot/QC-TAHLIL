@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=C:\Program Files\Python314\python.exe"
if exist "%PYTHON_EXE%" (
    "%PYTHON_EXE%" "%~dp0qc.py" --gui
) else (
    py -3 "%~dp0qc.py" --gui
)

if errorlevel 1 pause
