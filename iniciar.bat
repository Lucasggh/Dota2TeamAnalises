@echo off
title Dota 2 Rival Scout - Coach Edition
chcp 65001 >nul

echo ====================================================
echo    Iniciando Dota 2 Rival Scout...
echo ====================================================

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Iniciando servidor local com Node.js...
    start http://localhost:3000
    node server.js
    goto fim
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Iniciando servidor local com Python...
    start http://localhost:3000
    py server.py
    goto fim
)

echo Abrindo diretamente index.html no seu navegador padrao...
start index.html

:fim
