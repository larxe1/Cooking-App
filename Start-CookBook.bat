@echo off
cd /d "%~dp0"
if exist "%~dp0CookBook.exe" (
  start "" "%~dp0CookBook.exe"
  exit /b 0
)
start "CookBook Database Server" /min node "%~dp0server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:3847"
