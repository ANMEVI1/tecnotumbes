# Pipeline Modular de Modelos `.glb` (`glb-pipeline`)

Módulo desacoplado, multiplataforma y orientado a desarrolladores y agentes IA para analizar, versionar, sincronizar e inyectar modelos `.glb` de Blender en **`tecno-tumbes`**.

Para detalles técnicos de contratos JSON, códigos de salida y protocolo automatizado para Skills/IA, consulta [AGENT_CONTRACT.md](file:///d:/tecno-tumbes/glb-pipeline/AGENT_CONTRACT.md).

---

## Estructura del Módulo

- [mapping.config.json](file:///d:/tecno-tumbes/glb-pipeline/mapping.config.json) — Reglas de mapeo Blender → Pabellones MySQL, landmarks y umbrales.
- [lib/glb-parser.mjs](file:///d:/tecno-tumbes/glb-pipeline/lib/glb-parser.mjs) — Analizador binario glTF 2.0 (bounds reales 4×4, `floorHeights`, `landmarks`, `unmappedGroups`, cámara automática).
- [lib/orchestrator.mjs](file:///d:/tecno-tumbes/glb-pipeline/lib/orchestrator.mjs) — Orquestador puro (`analyzeModel`, `diffModels`, `applyModel`, `activateModel`, `verifyActiveModel`).
- [index.mjs](file:///d:/tecno-tumbes/glb-pipeline/index.mjs) — API programática ESM pública.
- [cli.mjs](file:///d:/tecno-tumbes/glb-pipeline/cli.mjs) — CLI determinista con soporte `--json` y `--dry-run`.
- [sync-glb-db.php](file:///d:/tecno-tumbes/glb-pipeline/sync-glb-db.php) — Sincronizador transaccional de `pabellones` en `db_tecno_tumbes`.
- [schemas/](file:///d:/tecno-tumbes/glb-pipeline/schemas/model-meta.schema.json) — Esquemas JSON Schema Draft 2020-12.

---

## Uso Rápido por Línea de Comandos

```bash
# Analizar un modelo nuevo (salida legible o --json para agentes)
node glb-pipeline/cli.mjs analyze ruta/al/modelo.glb
node glb-pipeline/cli.mjs analyze ruta/al/modelo.glb --json

# Comparar cambios espaciales y polígonos frente al modelo activo
node glb-pipeline/cli.mjs diff tecno-v1 ruta/al/tecno-v2.glb --json

# Simular aplicación sin escribir archivos ni BD
node glb-pipeline/cli.mjs apply ruta/al/tecno-v2.glb --sync-db --dry-run --json

# Aplicar modelo, generar .meta.json, actualizar manifest.json/.env y sincronizar MySQL
node glb-pipeline/cli.mjs apply ruta/al/tecno-v2.glb --sync-db

# Ver versiones registradas y cambiar versión activa (rollback)
node glb-pipeline/cli.mjs list
node glb-pipeline/cli.mjs use tecno-v1

# Verificar integridad del modelo activo
node glb-pipeline/cli.mjs verify

# Vigilar exportaciones en tiempo real desde Blender hacia blender-exports/
node glb-pipeline/cli.mjs watch --sync-db
```

---

## Convención Recomendada en Blender

1. Nombra o agrupa objetos con los prefijos configurados en [mapping.config.json](file:///d:/tecno-tumbes/glb-pipeline/mapping.config.json) (`PAB_ADMIN_*`, `PAB_NARANJA_*`, `PAB_U_3P_*`, `PAB_INTERIOR_*`, `PAB_FONDO_*`, `AUDITORIO_*`, `TORRE_*`, `LAB_NAVE1_*`, `LAB_NAVE2_*`, `CANCHA_*`, `TRIBUNA_*`).
2. Antes de exportar: selecciona todo (`A`) → **`Ctrl + A` > `All Transforms`**.
3. Exporta como **`glTF Binary (.glb)`** sin compresión Draco y procura mantener el archivo debajo de `4–8 MB`.
