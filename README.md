# TECNO · TUMBES

Plataforma web directa de gestión para el **IESTP "Cap. FAP José Abelardo Quiñones"** (Av. Tumbes Norte N° 1228, Tumbes):
- **Croquis 3D Dinámico** (Three.js): pabellones reales, Paseo Central, Plaza Cívica, antenas WiFi con radio de alcance real en metros, filtro de pisos (`P1–P3`), modo `Neón` / `Real`, sonda de medición de señal y selector de posición 3D.
- **WiFi & Claves Libres**: consulta, búsqueda, copia en 1 clic, código QR SVG escaneable y CRUD conectado a MySQL.
- **6 Laboratorios de Cómputo (`LAB-01` a `LAB-06`)**: gestión de equipos, cuentas libres de estudiante/docente/invitado y cuentas `admin_local` protegidas.
- **10 Oficinas de Carreras**: ubicación exacta por pabellón, piso, coordinador y WiFi vinculado.
- **Bóveda TI Autorizada**: sin pantalla de login bloqueante; validación inline con `DNI` + `PIN` (`Argon2id`) contra la tabla `personas_autorizadas`, descifrado bajo demanda `AES-256-GCM` y bitácora de auditoría en `auditoria_ti`.

## Aislamiento en Laragon
- Ejecuta directamente sobre **PHP 8.2.35** (`C:\laragon\bin\php\php-8.2.35-1-Win32-vs16-x64\php.exe`) en `http://127.0.0.1:8085`.
- No modifica `laragon.ini`, `httpd.conf`, `00-default.conf`, `hosts` ni ninguna base de datos previa. Utiliza únicamente `db_tecno_tumbes`.

## Arranque
Ejecuta `iniciar-tecno-tumbes.bat` o `iniciar-tecno-tumbes.ps1` (con MySQL de Laragon encendido).

## Accesos Demo de la Bóveda TI
- **Superadmin TI**: DNI `45128901` · PIN `TI-2026#Admin`
- **Soporte Redes**: DNI `72345610` · PIN `Redes#2026`
- **Coord. Laboratorios**: DNI `70981234` · PIN `Labs#2026`
