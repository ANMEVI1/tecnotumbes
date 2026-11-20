@echo off
title TECNO-TUMBES (PHP 8.2.35 - Puerto 8085)
echo Iniciando TECNO-TUMBES en http://127.0.0.1:8085 usando PHP 8.2.35 de Laragon...
start "" http://127.0.0.1:8085
"C:\laragon\bin\php\php-8.2.35-1-Win32-vs16-x64\php.exe" -S 127.0.0.1:8085 -t "%~dp0public" "%~dp0public\router.php"
