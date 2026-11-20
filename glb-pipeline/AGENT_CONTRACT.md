# Contrato Técnico para Agentes IA — Módulo GLB (`glb-pipeline`)

Este documento define las interfaces deterministas, esquemas JSON, códigos de salida y protocolo estándar para que cualquier desarrollador o agente IA (y futuras Skills personalizadas) analice, valide, compare e integre modelos `.glb` exportados desde Blender en **`tecno-tumbes`**.

---

## 1. Arquitectura de Capas

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Configuración declarativa | [mapping.config.json](file:///d:/tecno-tumbes/glb-pipeline/mapping.config.json) | Umbrales WebGL, `pabellonAliases`, `landmarks`, `ignoreUnmappedPrefixes`. |
| Analizador binario glTF 2.0 | [glb-parser.mjs](file:///d:/tecno-tumbes/glb-pipeline/lib/glb-parser.mjs) | Parser binario (JSON+BIN), matrices mundo 4×4, bounds, `floorHeights`, `landmarks`, `unmappedGroups`, `blockingErrors`. |
| Orquestador programático | [orchestrator.mjs](file:///d:/tecno-tumbes/glb-pipeline/lib/orchestrator.mjs) | `analyzeModel`, `diffModels`, `applyModel` (`dryRun`), `listModels`, `activateModel`, `verifyActiveModel`, `resolvePhpBin`. |
| API Pública ESM | [index.mjs](file:///d:/tecno-tumbes/glb-pipeline/index.mjs) | Re-exportación estable para scripts, tests y módulos de Skills. |
| CLI Determinista | [cli.mjs](file:///d:/tecno-tumbes/glb-pipeline/cli.mjs) | Entrada multiplataforma sin prompts interactivos; soporta `--json` y `--dry-run`. |
| Sincronizador MySQL | [sync-glb-db.php](file:///d:/tecno-tumbes/glb-pipeline/sync-glb-db.php) | Actualiza únicamente bounds/centros de `pabellones` en `db_tecno_tumbes`. Soporta `--dry-run` y `--json`. |
| Ejecutor WebGL | [glb-engine.js](file:///d:/tecno-tumbes/public/assets/js/glb-engine.js) | Lectura de `manifest.json`, batching `mergeGeometries`, cámara automática, telemetría y limpieza de VRAM. |
| API HTTP Runtime | [GlbController.php](file:///d:/tecno-tumbes/src/Controllers/GlbController.php) | `GET /api/modelos`, `GET /api/modelos/{id}/meta`, `POST /api/modelos/activar`. |

---

## 2. Interfaz CLI (`--json` Obligatorio para Agentes IA)

Cuando se pasa `--json`, `cli.mjs` emite **exclusivamente** un objeto JSON válido por `stdout` (`{ "ok": true|false, ... }`) sin banners ni texto libre.

### Comandos
```bash
# 1. Analizar modelo antes de tocar disco o BD
node glb-pipeline/cli.mjs analyze <ruta/modelo.glb> --json

# 2. Comparar versión activa actual contra una versión nueva
node glb-pipeline/cli.mjs diff <id_o_glb_base> <ruta/nuevo.glb> --json

# 3. Simular aplicación + sincronización MySQL sin escribir cambios
node glb-pipeline/cli.mjs apply <ruta/modelo.glb> --sync-db --dry-run --json

# 4. Aplicar, registrar en manifest.json, actualizar .env y sincronizar BD
node glb-pipeline/cli.mjs apply <ruta/modelo.glb> --sync-db --json
# Añadir --reanchor si el diff indicó recommendedReanchor=true

# 5. Listar versiones registradas y rollback instantáneo
node glb-pipeline/cli.mjs list --json
node glb-pipeline/cli.mjs use <id_version> --json

# 6. Verificar integridad física + SHA-256 del modelo activo
node glb-pipeline/cli.mjs verify --json
```

### Códigos de Salida (`exitCode`)
| Código | Significado | Acción sugerida para el agente |
|---|---|---|
| `0` | Éxito completo | Continuar flujo o reportar resultado |
| `1` | Error de E/S, argumentos, PHP o MySQL | Revisar rutas / `PHP_BIN` / estado de MySQL |
| `2` | Error de validación del `.glb` (`blockingErrors`) | No aplicar; informar extensiones (ej. Draco) o mallas faltantes |
| `3` | Fallo de integridad / hash desincronizado en `verify` | Re-ejecutar `apply` sobre el `.glb` correspondiente |

---

## 3. Protocolo Estándar de 6 Pasos para Agentes IA

Al recibir una nueva versión `.glb` de un colaborador:
1. **Analizar**: ejecutar `node glb-pipeline/cli.mjs analyze <archivo.glb> --json`.
2. **Validar bloqueos**: comprobar `report.blockingErrors.length === 0`. Si hay errores bloqueantes, detenerse y reportar qué corregir en Blender.
3. **Revisar grupos no mapeados**: inspeccionar `report.unmappedGroups[]`. Si aparece un edificio nuevo (por su `prefix`, `size` y `center`), agregar su regla en `glb-pipeline/mapping.config.json` bajo `pabellonAliases` (o en `ignoreUnmappedPrefixes` si es mobiliario/ornato) y repetir el paso 1.
4. **Comparar contra la versión activa**: ejecutar `node glb-pipeline/cli.mjs diff <active_id> <archivo.glb> --json`. Verificar `pabellonChanges` y si `recommendedReanchor` es `true`.
5. **Previsualizar y aplicar**: ejecutar `--dry-run --sync-db --json` y luego `apply <archivo.glb> --sync-db [--reanchor] --json`.
6. **Verificar estado final**: ejecutar `node glb-pipeline/cli.mjs verify --json` y comprobar que `ok === true`.

---

## 4. API Programática ESM (Base para Futuras Skills)

```js
import {
  analyzeModel,
  diffModels,
  applyModel,
  listModels,
  activateModel,
  verifyActiveModel,
} from './glb-pipeline/index.mjs';
```

Todos los artefactos generados respetan los JSON Schemas en `glb-pipeline/schemas/`:
- [mapping.schema.json](file:///d:/tecno-tumbes/glb-pipeline/schemas/mapping.schema.json)
- [manifest.schema.json](file:///d:/tecno-tumbes/glb-pipeline/schemas/manifest.schema.json)
- [model-meta.schema.json](file:///d:/tecno-tumbes/glb-pipeline/schemas/model-meta.schema.json)

---

## 5. Reglas de Seguridad y Despliegue (InfinityFree + jsDelivr)
- **Resolución de PHP**: `resolvePhpBin()` busca en orden `--php-bin` → `process.env.PHP_BIN` → `.env` `PHP_BIN` → auto-detección `C:\laragon\bin\php\php-8.2.*\php.exe` → `php` en `PATH`.
- **Aislamiento de datos**: `sync-glb-db.php` solo actualiza dimensiones/centros en `pabellones` (y offsets XZ opcionales con `--reanchor`); jamás elimina redes WiFi, cuentas de laboratorio ni credenciales TI.
- **Producción**: `glb-pipeline/`, `blender-exports/` y `*.blend` quedan bloqueados vía `.htaccess` y excluidos del FTP en `.github/workflows/deploy.yml`; solo `public/assets/models/` (`*.glb`, `*.meta.json`, `manifest.json`) se sirve desde jsDelivr CDN.
