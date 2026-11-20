import fs from 'node:fs';
import path from 'node:path';
import {
  PATHS,
  analyzeModel,
  diffModels,
  applyModel,
  listModels,
  activateModel,
  verifyActiveModel,
} from './index.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {
    json: false,
    syncDb: false,
    reanchor: false,
    dryRun: false,
    noReport: false,
    id: null,
    phpBin: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--sync-db') flags.syncDb = true;
    else if (a === '--reanchor') flags.reanchor = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--no-report') flags.noReport = true;
    else if (a === '--id' && argv[i + 1]) flags.id = argv[++i];
    else if (a === '--php-bin' && argv[i + 1]) flags.phpBin = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printHumanAnalyze(report, reportPath) {
  console.log('');
  console.log(`=== ANÁLISIS GLB: ${report.fileName} ===`);
  console.log(`Peso:          ${report.sizeMB} MB (${report.sizeBytes.toLocaleString('es-PE')} bytes)`);
  console.log(`SHA-256:       ${report.shortHash}`);
  console.log(`Calificación:  ${report.grade}`);
  console.log(`Geometría:     ${report.stats.triangles.toLocaleString('es-PE')} triángulos | ${report.stats.vertices.toLocaleString('es-PE')} vértices`);
  console.log(`Draw calls:    ${report.stats.rawDrawCalls} brutos -> ${report.stats.mergedDrawCalls} fusionados (${report.stats.reductionFactor}x reducción)`);
  console.log(`Dimensiones:   ${report.campusBounds.size[0]}m (X) x ${report.campusBounds.size[1]}m (Y) x ${report.campusBounds.size[2]}m (Z)`);
  console.log(`Cámara auto:   pos=[${report.camera.position.join(', ')}] target=[${report.camera.target.join(', ')}]`);
  console.log(`Pabellones:    ${report.detectedPabellones.map((p) => p.codigo).join(', ') || 'Ninguno'}`);
  console.log(`Landmarks:     ${report.landmarks.map((l) => l.key).join(', ') || 'Ninguno'}`);
  if (report.warnings.length) {
    console.log('Advertencias:');
    for (const w of report.warnings) console.log(`  - ${w}`);
  }
  if (reportPath) console.log(`Reporte JSON:  ${reportPath}`);
  console.log('');
}

function printHumanDiff(d) {
  console.log('');
  console.log(`=== DIFF GLB: ${d.base.id} -> ${d.target.id} ===`);
  console.log(`Grado:       ${d.deltas.gradeTransition}`);
  console.log(`Peso:        ${d.deltas.sizeMB >= 0 ? '+' : ''}${d.deltas.sizeMB} MB`);
  console.log(`Triángulos:  ${d.deltas.triangles >= 0 ? '+' : ''}${d.deltas.triangles}`);
  console.log(`DrawCalls:   ${d.deltas.mergedDrawCalls >= 0 ? '+' : ''}${d.deltas.mergedDrawCalls}`);
  console.log(`Reanchor:    ${d.recommendedReanchor ? 'RECOMENDADO (--reanchor)' : 'No necesario'}`);
  console.log(`Agregados:   ${d.pabellonChanges.added.map((x) => x.codigo).join(', ') || 'Ninguno'}`);
  console.log(`Eliminados:  ${d.pabellonChanges.removed.map((x) => x.codigo).join(', ') || 'Ninguno'}`);
  console.log(`Movidos:     ${d.pabellonChanges.moved.map((x) => `${x.codigo}(${x.distance}m)`).join(', ') || 'Ninguno'}`);
  console.log('');
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, arg1, arg2] = positional;

try {
  if (command === 'analyze') {
    const res = analyzeModel(arg1, { writeReport: !flags.noReport });
    if (flags.json) {
      emitJson({ ok: true, command, reportPath: res.reportPath, report: res.report });
    } else {
      printHumanAnalyze(res.report, res.reportPath);
    }
  } else if (command === 'diff') {
    const res = diffModels(arg1, arg2);
    if (flags.json) {
      emitJson({ ok: true, command, diff: res });
    } else {
      printHumanDiff(res);
    }
  } else if (command === 'apply') {
    const res = applyModel(arg1, {
      syncDb: flags.syncDb,
      reanchor: flags.reanchor,
      dryRun: flags.dryRun,
      id: flags.id,
      phpBin: flags.phpBin,
    });
    if (flags.json) {
      emitJson({ ok: true, command, ...res });
    } else {
      printHumanAnalyze(res.report, res.metaPath || null);
      console.log(`${res.dryRun ? '[DRY-RUN] ' : ''}Modelo aplicado: ${res.entry.id} -> ${res.entry.url}`);
      if (res.dbSync) {
        console.log(`BD MySQL: ${res.dbSync.updatedPabellones} pabellones procesados (${res.dbSync.reanchoredPabellones} re-anclados).`);
      }
    }
  } else if (command === 'list') {
    const manifest = listModels();
    if (flags.json) {
      emitJson({ ok: true, command, manifest });
    } else {
      console.log(`Modelo activo: ${manifest.active || 'ninguno'}`);
      for (const m of manifest.models) {
        const mark = m.id === manifest.active ? '*' : ' ';
        console.log(`${mark} ${m.id} | ${m.file} | ${m.sizeMB} MB | ${m.grade} | ${m.stats?.triangles || 0} tris | #${m.hash}`);
      }
    }
  } else if (command === 'use') {
    const res = activateModel(arg1);
    if (flags.json) {
      emitJson({ ok: true, command, ...res });
    } else {
      console.log(`Modelo activo cambiado a "${res.active}" (${res.activeModel.url}).`);
    }
  } else if (command === 'verify') {
    const res = verifyActiveModel();
    if (flags.json) {
      emitJson({ ok: true, command, ...res });
    } else {
      console.log(`VERIFY OK: ${res.id} (${res.file}, ${res.sizeMB} MB, grado ${res.grade}, hash ${res.hash}).`);
    }
  } else if (command === 'watch') {
    const watchDir = path.resolve(arg1 || PATHS.blenderExportsDir);
    fs.mkdirSync(watchDir, { recursive: true });
    if (!flags.json) {
      console.log(`Vigilando .glb en ${watchDir} (Ctrl+C para salir)...`);
    }
    const timers = new Map();
    fs.watch(watchDir, (_evt, filename) => {
      if (!filename || !filename.toLowerCase().endsWith('.glb')) return;
      const fullPath = path.join(watchDir, filename);
      clearTimeout(timers.get(fullPath));
      timers.set(
        fullPath,
        setTimeout(() => {
          timers.delete(fullPath);
          if (!fs.existsSync(fullPath)) return;
          try {
            const res = applyModel(fullPath, {
              syncDb: flags.syncDb,
              reanchor: flags.reanchor,
              dryRun: flags.dryRun,
              phpBin: flags.phpBin,
            });
            if (flags.json) emitJson({ ok: true, event: 'watch_apply', ...res });
            else console.log(`[WATCH OK] ${res.entry.id} (${res.entry.grade}, ${res.entry.sizeMB} MB)`);
          } catch (err) {
            if (flags.json) emitJson({ ok: false, event: 'watch_error', error: err.message });
            else console.error(`[WATCH ERROR] ${err.message}`);
          }
        }, 1200)
      );
    });
  } else {
    const msg = 'Uso: node glb-pipeline/cli.mjs <analyze|diff|apply|list|use|verify|watch> [args] [--json] [--sync-db] [--reanchor] [--dry-run]';
    if (flags.json) {
      emitJson({ ok: false, error: msg, code: 'INVALID_COMMAND' });
    } else {
      console.error(msg);
    }
    process.exit(1);
  }
} catch (err) {
  const exitCode = Number.isInteger(err.exitCode) ? err.exitCode : 1;
  if (flags.json) {
    emitJson({
      ok: false,
      command: command || null,
      code: err.code || 'ERROR',
      exitCode,
      error: err.message,
    });
  } else {
    console.error(`Error [${err.code || 'ERROR'}]: ${err.message}`);
  }
  process.exit(exitCode);
}
