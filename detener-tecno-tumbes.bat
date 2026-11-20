@echo off
title Detener TECNO-TUMBES (Puerto 8085)
echo Buscando servidor PHP 8.2.35 de tecno-tumbes en el puerto 8085...
powershell -NoProfile -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 8085 -State Listen -ErrorAction SilentlyContinue; ^
   if (-not $conns) { Write-Host 'No hay ningun servidor ejecutandose en el puerto 8085.' -ForegroundColor Yellow; exit 0 } ^
   $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique; ^
   foreach ($pidVal in $pids) { ^
     $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue; ^
     if ($proc -and $proc.ProcessName -eq 'php') { ^
       Stop-Process -Id $pidVal -Force; ^
       Write-Host \"Servidor tecno-tumbes detenido (PID $pidVal).\" -ForegroundColor Green; ^
     } else { ^
       Write-Host \"Proceso en 8085 no es php.exe ($($proc.ProcessName)); omitido por seguridad.\" -ForegroundColor Red; ^
     } ^
   }"
pause
