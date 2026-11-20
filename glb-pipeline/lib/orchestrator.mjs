import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeGlbFile, GlbValidationError } from './glb-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIPELINE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(PIPELINE_DIR, '..');

export const PATHS = {
  rootDir: ROOT_DIR,
  pipelineDir: PIPELINE_DIR,
  configPath: path.join(PIPELINE_DIR, 'mapping.config.json'),
  reportsDir: path.join(PIPELINE_DIR, 'reports'),
  syncPhpPath: path.join(PIPELINE_DIR, 'sync-glb-db.php'),
  modelsDir: path.join(ROOT_DIR, 'public', 'assets', 'models'),
  manifestPath: path.join(ROOT_DIR, 'public', 'assets', 'models', 'manifest.json'),
  envPath: path.join(ROOT_DIR, '.env'),
  blenderExportsDir: path.join(ROOT_DIR, 'blender-exports'),
};

export class PipelineError extends Error {
  constructor(message, exitCode = 1, code = 'PIPELINE_ERROR') {
    super(message);
    this.name = 'PipelineError';
    this.exitCode = exitCode;
    this.code = code;
  }
}

export function loadMappingConfig() {
  return JSON.parse(fs.readFileSync(PATHS.configPath, 'utf8'));
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadManifest() {
  if (!fs.existsSync(PATHS.manifestPath)) {
    return { schemaVersion: 1, active: null, updatedAt: null, models: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(PATHS.manifestPath, 'utf8'));
  } catch {
    return { schemaVersion: 1, active: null, updatedAt: null, models: [] };
  }
}

function readEnvValue(key) {
  if (!fs.existsSync(PATHS.envPath)) return null;
  const raw = fs.readFileSync(PATHS.envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

export function resolvePhpBin(explicitBin = null) {
  const candidates = [];
  if (explicitBin) candidates.push(explicitBin);
  if (process.env.PHP_BIN) candidates.push(process.env.PHP_BIN);
  const envPhp = readEnvValue('PHP_BIN');
  if (envPhp) candidates.push(envPhp);

  // Auto-detección de PHP 8.2 en Laragon sin hardcodear una subversión exacta
  const laragonPhpRoot = 'C:\\laragon\\bin\\php';
  if (fs.existsSync(laragonPhpRoot)) {
    const dirs = fs.readdirSync(laragonPhpRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('php-8.2'))
      .map((d) => path.join(laragonPhpRoot, d.name, 'php.exe'))
      .sort()
      .reverse();
    candidates.push(...dirs);
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'php';
}

function updateEnvModelUrl(modelRelUrl) {
  if (!fs.existsSync(PATHS.envPath)) return false;
  const raw = fs.readFileSync(PATHS.envPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (/^\s*MODEL_GLB_URL\s*=/.test(line)) {
      replaced = true;
      return `MODEL_GLB_URL=${modelRelUrl}`;
    }
    return line;
  });
  if (!replaced) {
    nextLines.push(`MODEL_GLB_URL=${modelRelUrl}`);
  }
  fs.writeFileSync(PATHS.envPath, nextLines.join('\n'), 'utf8');
  return true;
}

function sanitizeId(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\.glb$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'modelo';
}

function runDbSync(metaPath, { reanchor = false, dryRun = false, phpBin = null } = {}) {
  const bin = resolvePhpBin(phpBin);
  const args = [PATHS.syncPhpPath, metaPath, '--json'];
  if (reanchor) args.push('--reanchor');
  if (dryRun) args.push('--dry-run');

  try {
    const stdout = execFileSync(bin, args, { encoding: 'utf8' });
    return JSON.parse(stdout.trim());
  } catch (err) {
    const detail = err.stdout?.toString() || err.stderr?.toString() || err.message;
    throw new PipelineError(`Fallo en sincronización MySQL (${bin}): ${detail}`, 1, 'DB_SYNC_ERROR');
  }
}

export function analyzeModel(filePath, { writeReport = true } = {}) {
  if (!filePath) {
    throw new PipelineError('Indica la ruta del archivo .glb.', 1, 'MISSING_ARG');
  }
  const config = loadMappingConfig();
  const report = analyzeGlbFile(filePath, config);
  let reportPath = null;

  if (writeReport) {
    fs.mkdirSync(PATHS.reportsDir, { recursive: true });
    const baseName = path.basename(filePath, path.extname(filePath));
    reportPath = path.join(PATHS.reportsDir, `${baseName}.report.json`);
    writeJsonAtomic(reportPath, report);
  }

  return { report, reportPath };
}

function resolveModelReport(refOrPath, config) {
  const manifest = loadManifest();
  const byId = manifest.models.find(
    (m) => m.id === refOrPath || m.file.toLowerCase() === String(refOrPath).toLowerCase()
  );
  if (byId) {
    const metaPath = path.join(PATHS.modelsDir, byId.metaFile);
    if (fs.existsSync(metaPath)) {
      return { id: byId.id, report: JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
    }
    const glbPath = path.join(PATHS.modelsDir, byId.file);
    return { id: byId.id, report: analyzeGlbFile(glbPath, config) };
  }
  return { id: path.basename(refOrPath), report: analyzeGlbFile(refOrPath, config) };
}

export function diffModels(baseRef, targetRef) {
  if (!baseRef || !targetRef) {
    throw new PipelineError('Uso: diff <baseIdOrGlb> <newGlb>', 1, 'MISSING_ARG');
  }
  const config = loadMappingConfig();
  const base = resolveModelReport(baseRef, config);
  const next = resolveModelReport(targetRef, config);

  const basePabs = new Map((base.report.detectedPabellones || []).map((p) => [p.codigo, p]));
  const nextPabs = new Map((next.report.detectedPabellones || []).map((p) => [p.codigo, p]));

  const added = [];
  const removed = [];
  const moved = [];
  const resized = [];

  for (const [code, np] of nextPabs.entries()) {
    if (!basePabs.has(code)) {
      added.push({ codigo: code, center: np.center, size: np.size });
      continue;
    }
    const bp = basePabs.get(code);
    const dx = Number((np.center[0] - bp.center[0]).toFixed(2));
    const dy = Number((np.center[1] - bp.center[1]).toFixed(2));
    const dz = Number((np.center[2] - bp.center[2]).toFixed(2));
    const dist = Number(Math.hypot(dx, dy, dz).toFixed(2));
    if (dist > 0.25) {
      moved.push({ codigo: code, delta: [dx, dy, dz], distance: dist });
    }

    const dw = Number((np.size[0] - bp.size[0]).toFixed(2));
    const dh = Number((np.size[1] - bp.size[1]).toFixed(2));
    const dd = Number((np.size[2] - bp.size[2]).toFixed(2));
    if (Math.abs(dw) > 0.25 || Math.abs(dh) > 0.25 || Math.abs(dd) > 0.25) {
      resized.push({ codigo: code, deltaSize: [dw, dh, dd] });
    }
  }

  for (const code of basePabs.keys()) {
    if (!nextPabs.has(code)) {
      removed.push({ codigo: code });
    }
  }

  const recommendedReanchor = moved.some((m) => m.distance > 1.5);

  return {
    base: { id: base.id, file: base.report.fileName, hash: base.report.shortHash },
    target: { id: next.id, file: next.report.fileName, hash: next.report.shortHash },
    deltas: {
      bytes: next.report.sizeBytes - base.report.sizeBytes,
      sizeMB: Number((next.report.sizeMB - base.report.sizeMB).toFixed(2)),
      triangles: next.report.stats.triangles - base.report.stats.triangles,
      rawDrawCalls: next.report.stats.rawDrawCalls - base.report.stats.rawDrawCalls,
      mergedDrawCalls: next.report.stats.mergedDrawCalls - base.report.stats.mergedDrawCalls,
      gradeTransition: `${base.report.grade} -> ${next.report.grade}`,
    },
    pabellonChanges: { added, removed, moved, resized },
    recommendedReanchor,
  };
}

export function applyModel(filePath, { syncDb = false, reanchor = false, dryRun = false, id = null, phpBin = null } = {}) {
  if (!filePath) {
    throw new PipelineError('Indica la ruta del archivo .glb a aplicar.', 1, 'MISSING_ARG');
  }
  const config = loadMappingConfig();
  const report = analyzeGlbFile(filePath, config);

  if (report.blockingErrors.length > 0) {
    throw new GlbValidationError(report.blockingErrors.join(' | '), 'GLB_BLOCKING_ERRORS');
  }

  const destFile = path.basename(report.sourcePath);
  const destPath = path.join(PATHS.modelsDir, destFile);
  const baseName = path.basename(destFile, path.extname(destFile));
  const metaFile = `${baseName}.meta.json`;
  const metaPath = path.join(PATHS.modelsDir, metaFile);
  const modelId = sanitizeId(id || baseName);

  const entry = {
    id: modelId,
    file: destFile,
    metaFile,
    url: `/assets/models/${destFile}`,
    hash: report.shortHash,
    sha256: report.sha256,
    sizeBytes: report.sizeBytes,
    sizeMB: report.sizeMB,
    grade: report.grade,
    stats: report.stats,
    coordinateSystem: report.coordinateSystem,
    campusBounds: report.campusBounds,
    camera: report.camera,
    groundHitPlane: report.groundHitPlane,
    detectedPabellones: report.detectedPabellones.map((p) => p.codigo),
    warnings: report.warnings,
    recommendations: report.recommendations,
    pabellonAliases: report.pabellonAliases,
    registeredAt: new Date().toISOString(),
  };

  let dbSyncResult = null;

  if (dryRun) {
    if (syncDb) {
      const tmpMeta = path.join(os.tmpdir(), `tecno-dry-${process.pid}-${Date.now()}.meta.json`);
      fs.writeFileSync(tmpMeta, JSON.stringify(report), 'utf8');
      try {
        dbSyncResult = runDbSync(tmpMeta, { reanchor, dryRun: true, phpBin });
      } finally {
        fs.rmSync(tmpMeta, { force: true });
      }
    }

    return {
      dryRun: true,
      entry,
      wouldCopyTo: path.resolve(report.sourcePath).toLowerCase() !== path.resolve(destPath).toLowerCase() ? destPath : null,
      wouldWriteMeta: metaPath,
      wouldUpdateManifest: PATHS.manifestPath,
      wouldUpdateEnv: entry.url,
      report,
      dbSync: dbSyncResult,
    };
  }

  fs.mkdirSync(PATHS.modelsDir, { recursive: true });
  if (path.resolve(report.sourcePath).toLowerCase() !== path.resolve(destPath).toLowerCase()) {
    fs.copyFileSync(report.sourcePath, destPath);
  }
  writeJsonAtomic(metaPath, report);

  const manifest = loadManifest();
  manifest.models = (manifest.models || []).filter((m) => m.id !== modelId && m.file !== destFile);
  manifest.models.unshift(entry);
  manifest.active = modelId;
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(PATHS.manifestPath, manifest);

  updateEnvModelUrl(entry.url);

  if (syncDb) {
    dbSyncResult = runDbSync(metaPath, { reanchor, dryRun: false, phpBin });
  }

  return {
    dryRun: false,
    entry,
    metaPath,
    manifestPath: PATHS.manifestPath,
    report,
    dbSync: dbSyncResult,
  };
}

export function listModels() {
  return loadManifest();
}

export function activateModel(target) {
  if (!target) {
    throw new PipelineError('Indica el ID o nombre de archivo a activar.', 1, 'MISSING_ARG');
  }
  const manifest = loadManifest();
  const found = (manifest.models || []).find(
    (m) => m.id === target || m.file.toLowerCase() === String(target).toLowerCase()
  );
  if (!found) {
    throw new PipelineError(`Modelo "${target}" no existe en manifest.json.`, 1, 'MODEL_NOT_FOUND');
  }
  const modelPath = path.join(PATHS.modelsDir, found.file);
  if (!fs.existsSync(modelPath)) {
    throw new PipelineError(`Falta el archivo físico ${modelPath}.`, 3, 'MODEL_FILE_MISSING');
  }

  manifest.active = found.id;
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(PATHS.manifestPath, manifest);
  updateEnvModelUrl(found.url);

  return { active: found.id, activeModel: found };
}

export function verifyActiveModel() {
  const manifest = loadManifest();
  if (!manifest.active) {
    throw new PipelineError('No hay modelo activo en manifest.json.', 3, 'NO_ACTIVE_MODEL');
  }
  const active = (manifest.models || []).find((m) => m.id === manifest.active);
  if (!active) {
    throw new PipelineError(`El ID activo "${manifest.active}" no figura en models[].`, 3, 'BROKEN_MANIFEST');
  }

  const modelPath = path.join(PATHS.modelsDir, active.file);
  const metaPath = path.join(PATHS.modelsDir, active.metaFile);
  if (!fs.existsSync(modelPath)) {
    throw new PipelineError(`Falta archivo .glb: ${modelPath}`, 3, 'MISSING_GLB');
  }
  if (!fs.existsSync(metaPath)) {
    throw new PipelineError(`Falta archivo .meta.json: ${metaPath}`, 3, 'MISSING_META');
  }

  const config = loadMappingConfig();
  const live = analyzeGlbFile(modelPath, config);
  if (live.sha256 !== active.sha256) {
    throw new PipelineError(
      `Hash desincronizado para ${active.file} (esperado ${active.hash}, actual ${live.shortHash}). Ejecuta apply.`,
      3,
      'HASH_MISMATCH'
    );
  }

  return {
    verified: true,
    id: active.id,
    file: active.file,
    sizeMB: active.sizeMB,
    grade: active.grade,
    hash: active.hash,
  };
}
