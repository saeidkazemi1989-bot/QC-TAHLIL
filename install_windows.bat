@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=C:\Program Files\Python314\python.exe"
if exist "%PYTHON_EXE%" (
    "%PYTHON_EXE%" -m pip install -r "%~dp0requirements.txt"
) else (
    py -3 -m pip install -r "%~dp0requirements.txt"
)

pause
