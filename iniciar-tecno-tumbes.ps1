$php = "C:\laragon\bin\php\php-8.2.35-1-Win32-vs16-x64\php.exe"
$mysql = "C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin\mysql.exe"

if (-not (Test-Path $php)) {
    Write-Error "No se encontro PHP 8.2.35 en $php"
    exit 1
}

& $php -v
if (Test-Path $mysql) {
    & $mysql -u root -e "SELECT 1;" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "MySQL 8.0.30 no responde en 127.0.0.1:3306. Inicia MySQL desde Laragon antes de usar la web."
    }
}

Write-Host "Iniciando TECNO-TUMBES en http://127.0.0.1:8085 (aislado de Apache/VirtualHosts de Laragon)" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:8085"
& $php -S 127.0.0.1:8085 -t "$PSScriptRoot\public" "$PSScriptRoot\public\router.php"
