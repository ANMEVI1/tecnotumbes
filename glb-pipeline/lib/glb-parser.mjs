import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Motor puro de análisis binario glTF 2.0 (.glb) sin dependencias externas.
 * Diseñado para consumo humano y por agentes IA: calcula jerarquía 4x4,
 * bounds mundiales reales, alturas sugeridas por piso, landmarks y grupos no mapeados.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

export class GlbValidationError extends Error {
  constructor(message, code = 'GLB_INVALID') {
    super(message);
    this.name = 'GlbValidationError';
    this.code = code;
    this.exitCode = 2;
  }
}

function mat4Identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4]     = a[0] * b0 + a[4] * b1 + a[8] * b2  + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2  + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4FromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const [sx, sy, sz] = s;

  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx,       (xz - wy) * sx,       0,
    (xy - wz) * sy,       (1 - (xx + zz)) * sy, (yz + wx) * sy,       0,
    (xz + wy) * sz,       (yz - wx) * sz,       (1 - (xx + yy)) * sz, 0,
    t[0],                 t[1],                 t[2],                 1,
  ];
}

function nodeLocalMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix;
  }
  return mat4FromTRS(
    node.translation || [0, 0, 0],
    node.rotation || [0, 0, 0, 1],
    node.scale || [1, 1, 1]
  );
}

function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z  + m[12],
    m[1] * x + m[5] * y + m[9] * z  + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function emptyBox() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function expandBoxPoint(box, p) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < box.min[i]) box.min[i] = p[i];
    if (p[i] > box.max[i]) box.max[i] = p[i];
  }
}

function expandBoxTransformedAABB(box, localMin, localMax, matrix) {
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        const corner = [
          ix ? localMax[0] : localMin[0],
          iy ? localMax[1] : localMin[1],
          iz ? localMax[2] : localMin[2],
        ];
        expandBoxPoint(box, transformPoint(matrix, corner));
      }
    }
  }
}

function finalizeBox(box) {
  if (!Number.isFinite(box.min[0])) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
    };
  }
  const round2 = (n) => Number(n.toFixed(2));
  const min = box.min.map(round2);
  const max = box.max.map(round2);
  const size = max.map((v, i) => round2(v - min[i]));
  const center = min.map((v, i) => round2((v + max[i]) / 2));
  return { min, max, size, center };
}

function resolvePabellonCode(name, aliases = []) {
  const upper = (name || '').toUpperCase();
  if (!upper) return null;
  for (const rule of aliases) {
    if (upper.startsWith(String(rule.prefix || '').toUpperCase())) {
      return rule.codigo;
    }
  }
  return null;
}

function computePrimitiveTriangles(prim, accessors) {
  const mode = prim.mode !== undefined ? prim.mode : 4; // 4 = TRIANGLES
  const posIdx = prim.attributes?.POSITION;
  if (posIdx === undefined) return { vertices: 0, triangles: 0 };

  const posAcc = accessors[posIdx];
  const vertices = posAcc?.count || 0;
  const count = prim.indices !== undefined ? (accessors[prim.indices]?.count || 0) : vertices;

  let triangles = 0;
  if (mode === 4) triangles = Math.floor(count / 3);
  else if (mode === 5 || mode === 6) triangles = Math.max(0, count - 2);
  return { vertices, triangles };
}

function readBinPositionMinMax(accessor, gltf, binBuffer) {
  if (Array.isArray(accessor.min) && Array.isArray(accessor.max)) {
    return { min: accessor.min, max: accessor.max };
  }
  if (!binBuffer || accessor.componentType !== 5126 || accessor.bufferView === undefined) {
    return null;
  }
  const bv = gltf.bufferViews?.[accessor.bufferView];
  if (!bv) return null;
  const baseOffset = (bv.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = bv.byteStride || 12;
  const b = emptyBox();
  for (let i = 0; i < accessor.count; i++) {
    const off = baseOffset + i * stride;
    if (off + 12 > binBuffer.length) break;
    expandBoxPoint(b, [
      binBuffer.readFloatLE(off),
      binBuffer.readFloatLE(off + 4),
      binBuffer.readFloatLE(off + 8),
    ]);
  }
  return Number.isFinite(b.min[0]) ? b : null;
}

function computeCameraPreset(bounds) {
  const [sx, sy, sz] = bounds.size;
  const [cx, , cz] = bounds.center;
  const spanXZ = Math.max(30, Math.hypot(sx, sz));
  const targetY = Number(Math.max(2, bounds.min[1] + Math.min(4.5, sy * 0.25)).toFixed(2));
  const posX = Number((cx + spanXZ * 0.14).toFixed(2));
  const posY = Number(Math.max(24, spanXZ * 0.44).toFixed(2));
  const posZ = Number((bounds.max[2] + spanXZ * 0.18).toFixed(2));
  const maxDist = Number(Math.max(160, spanXZ * 1.45).toFixed(0));

  return {
    position: [posX, posY, posZ],
    target: [Number(cx.toFixed(2)), targetY, Number(cz.toFixed(2))],
    minDistance: 12,
    maxDistance: maxDist,
    far: Math.max(450, Math.round(maxDist * 2.2)),
    fogDensity: Number((0.42 / Math.max(120, spanXZ)).toFixed(4)),
  };
}

function computeGrade({ sizeMB, triangles, mergedDrawCalls, rawMeshes, blockingErrors, unappliedScaleNodes }, thresholds) {
  if (blockingErrors.length > 0) return 'D';
  let penalties = 0;
  if (sizeMB > thresholds.maxSizeMB) penalties += 3;
  else if (sizeMB > thresholds.warnSizeMB) penalties += 1;

  if (triangles > thresholds.maxTriangles) penalties += 3;
  else if (triangles > thresholds.warnTriangles) penalties += 1;

  if (mergedDrawCalls > thresholds.maxMergedDrawCalls) penalties += 2;
  if (rawMeshes > thresholds.warnRawMeshes * 3) penalties += 1;
  if (unappliedScaleNodes.length > 0) penalties += 1;

  if (penalties === 0) return 'A+';
  if (penalties === 1) return 'A';
  if (penalties === 2) return 'B';
  if (penalties <= 4) return 'C';
  return 'D';
}

export function analyzeGlbFile(filePath, mappingConfig) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new GlbValidationError(`Archivo GLB no encontrado: ${absPath}`, 'GLB_NOT_FOUND');
  }

  const buf = fs.readFileSync(absPath);
  if (buf.length < 20) {
    throw new GlbValidationError('El archivo es demasiado pequeño para ser un GLB 2.0 válido.');
  }

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  if (magic !== GLB_MAGIC || version !== 2) {
    throw new GlbValidationError(`Cabecera inválida (se esperaba glTF v2, recibido version=${version}).`);
  }

  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== CHUNK_JSON || 20 + jsonLen > buf.length) {
    throw new GlbValidationError('Chunk JSON corrupto o incompleto dentro del GLB.');
  }

  let gltf;
  try {
    gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  } catch (err) {
    throw new GlbValidationError(`JSON glTF inválido: ${err.message}`);
  }

  let binBuffer = null;
  const binHeaderOffset = 20 + jsonLen;
  if (binHeaderOffset + 8 <= buf.length) {
    const binLen = buf.readUInt32LE(binHeaderOffset);
    const binType = buf.readUInt32LE(binHeaderOffset + 4);
    if (binType === CHUNK_BIN) {
      binBuffer = buf.subarray(binHeaderOffset + 8, Math.min(buf.length, binHeaderOffset + 8 + binLen));
    }
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const sizeBytes = buf.length;
  const sizeMB = Number((sizeBytes / (1024 * 1024)).toFixed(2));

  const aliases = mappingConfig.pabellonAliases || [];
  const ignorePrefixes = (mappingConfig.ignoreUnmappedPrefixes || []).map((s) => s.toUpperCase());
  const landmarkKeys = (mappingConfig.landmarks || []).map((s) => s.toUpperCase());
  const thresholds = mappingConfig.thresholds || {
    maxSizeMB: 8,
    warnSizeMB: 4,
    maxTriangles: 150000,
    warnTriangles: 60000,
    maxMergedDrawCalls: 120,
    warnRawMeshes: 400,
  };

  const nodes = gltf.nodes || [];
  const meshes = gltf.meshes || [];
  const accessors = gltf.accessors || [];
  const materials = gltf.materials || [];
  const textures = gltf.textures || [];
  const sceneIdx = gltf.scene !== undefined ? gltf.scene : 0;
  const rootNodes = gltf.scenes?.[sceneIdx]?.nodes || nodes.map((_, i) => i);

  const campusBox = emptyBox();
  const pabBoxes = new Map();
  const landmarkBoxes = new Map();
  const unmappedBoxes = new Map();
  const mergedBuckets = new Set();
  const unappliedScaleNodes = [];

  let rawMeshes = 0;
  let rawDrawCalls = 0;
  let totalVertices = 0;
  let totalTriangles = 0;

  function addSpatialEntry(map, key, bounds, world, triCount) {
    if (!map.has(key)) {
      map.set(key, { box: emptyBox(), meshCount: 0, triangles: 0 });
    }
    const entry = map.get(key);
    entry.meshCount++;
    entry.triangles += triCount;
    expandBoxTransformedAABB(entry.box, bounds.min, bounds.max, world);
  }

  function visitNode(nodeIdx, parentWorld, inheritedPabCode) {
    const node = nodes[nodeIdx];
    if (!node) return;

    if (Array.isArray(node.scale)) {
      const [sx, sy, sz] = node.scale;
      if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01 || Math.abs(sz - 1) > 0.01) {
        unappliedScaleNodes.push(node.name || `node_${nodeIdx}`);
      }
    }

    const world = mat4Multiply(parentWorld, nodeLocalMatrix(node));
    const nodeUpper = (node.name || '').toUpperCase();
    const ownPab = resolvePabellonCode(node.name, aliases);
    const activePab = ownPab || inheritedPabCode;
    const matchedLandmark = landmarkKeys.find((lm) => nodeUpper.includes(lm)) || null;

    if (node.mesh !== undefined && meshes[node.mesh]) {
      rawMeshes++;
      const meshDef = meshes[node.mesh];
      const meshPab = activePab || resolvePabellonCode(meshDef.name, aliases);

      let meshTriSum = 0;
      const primBoundsList = [];

      for (const prim of meshDef.primitives || []) {
        rawDrawCalls++;
        const matKey = prim.material !== undefined ? prim.material : 'default';
        mergedBuckets.add(`${meshPab || 'ENV'}::${matKey}`);

        const counts = computePrimitiveTriangles(prim, accessors);
        totalVertices += counts.vertices;
        totalTriangles += counts.triangles;
        meshTriSum += counts.triangles;

        const posIdx = prim.attributes?.POSITION;
        if (posIdx !== undefined && accessors[posIdx]) {
          const bounds = readBinPositionMinMax(accessors[posIdx], gltf, binBuffer);
          if (bounds) {
            expandBoxTransformedAABB(campusBox, bounds.min, bounds.max, world);
            primBoundsList.push({ bounds, triangles: counts.triangles });
            if (meshPab) {
              addSpatialEntry(pabBoxes, meshPab, bounds, world, counts.triangles);
            }
            if (matchedLandmark) {
              addSpatialEntry(landmarkBoxes, matchedLandmark, bounds, world, counts.triangles);
            }
          }
        }
      }

      if (!meshPab && node.name) {
        const isIgnored = ignorePrefixes.some((p) => nodeUpper.startsWith(p));
        if (!isIgnored && primBoundsList.length) {
          const prefix = node.name.split('_').slice(0, 2).join('_');
          for (const pb of primBoundsList) {
            addSpatialEntry(unmappedBoxes, prefix, pb.bounds, world, pb.triangles);
          }
        } else if (!isIgnored && !unmappedBoxes.has(node.name)) {
          const prefix = node.name.split('_').slice(0, 2).join('_');
          if (!unmappedBoxes.has(prefix)) {
            unmappedBoxes.set(prefix, { box: emptyBox(), meshCount: 0, triangles: 0 });
          }
          const e = unmappedBoxes.get(prefix);
          e.meshCount++;
          e.triangles += meshTriSum;
        }
      }
    }

    for (const childIdx of node.children || []) {
      visitNode(childIdx, world, activePab);
    }
  }

  for (const rootIdx of rootNodes) {
    visitNode(rootIdx, mat4Identity(), null);
  }

  const campusBounds = finalizeBox(campusBox);
  const coordinateSystem = {
    upAxis: '+Y',
    units: 'meters',
    groundY: campusBounds.min[1],
  };

  const detectedPabellones = [];
  for (const [codigo, info] of pabBoxes.entries()) {
    const b = finalizeBox(info.box);
    const pisosEstimados = Math.max(1, Math.round(b.size[1] / 3.6));
    const floorStep = b.size[1] / pisosEstimados;
    const floorHeights = [];
    for (let f = 0; f < pisosEstimados; f++) {
      floorHeights.push(Number((b.min[1] + (f + 0.5) * floorStep).toFixed(2)));
    }
    detectedPabellones.push({
      codigo,
      meshCount: info.meshCount,
      triangles: info.triangles,
      min: b.min,
      max: b.max,
      size: b.size,
      center: b.center,
      roofY: b.max[1],
      pisosEstimados,
      floorHeights,
    });
  }
  detectedPabellones.sort((a, b) => a.codigo.localeCompare(b.codigo));

  const landmarks = [];
  for (const [key, info] of landmarkBoxes.entries()) {
    const b = finalizeBox(info.box);
    landmarks.push({
      key,
      meshCount: info.meshCount,
      min: b.min,
      max: b.max,
      size: b.size,
      center: b.center,
    });
  }
  landmarks.sort((a, b) => a.key.localeCompare(b.key));

  const unmappedGroups = [];
  for (const [prefix, info] of unmappedBoxes.entries()) {
    const b = finalizeBox(info.box);
    unmappedGroups.push({
      prefix,
      meshCount: info.meshCount,
      triangles: info.triangles,
      min: b.min,
      max: b.max,
      size: b.size,
      center: b.center,
    });
  }
  unmappedGroups.sort((a, b) => b.triangles - a.triangles || a.prefix.localeCompare(b.prefix));

  const extensionsUsed = gltf.extensionsUsed || [];
  const extensionsRequired = gltf.extensionsRequired || [];
  const unsupportedExtensions = extensionsRequired.filter((ext) =>
    ['KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'].includes(ext)
  );

  const blockingErrors = [];
  if (rawMeshes === 0) {
    blockingErrors.push('El modelo GLB no contiene ninguna malla renderizable.');
  }
  if (unsupportedExtensions.length > 0) {
    blockingErrors.push(
      `Requiere extensiones sin decodificador habilitado: ${unsupportedExtensions.join(', ')}`
    );
  }

  const camera = computeCameraPreset(campusBounds);
  const spanXZ = Math.max(160, Math.max(campusBounds.size[0], campusBounds.size[2]) * 1.8);
  const groundHitPlane = {
    centerX: campusBounds.center[0],
    centerZ: campusBounds.center[2],
    size: Number(spanXZ.toFixed(0)),
  };

  const mergedDrawCalls = mergedBuckets.size;
  const grade = computeGrade(
    {
      sizeMB,
      triangles: totalTriangles,
      mergedDrawCalls,
      rawMeshes,
      blockingErrors,
      unappliedScaleNodes,
    },
    thresholds
  );

  const warnings = [];
  const recommendations = [];

  if (blockingErrors.length > 0) {
    warnings.push(...blockingErrors);
    recommendations.push('Exporta desde Blender como glTF Binary (.glb) estándar sin compresión Draco/KTX2.');
  }
  if (sizeMB > thresholds.warnSizeMB) {
    warnings.push(`Peso elevado (${sizeMB} MB > ${thresholds.warnSizeMB} MB recomendados para web gratuita).`);
    recommendations.push('Usa materiales PBR planos sin texturas pesadas o reduce subdivisión en Blender.');
  }
  if (totalTriangles > thresholds.warnTriangles) {
    warnings.push(`Alta densidad poligonal (${totalTriangles.toLocaleString('es-PE')} triángulos).`);
    recommendations.push('Aplica Decimate / simplifica detalles repetitivos (adoquines, celosías) en Blender.');
  }
  if (rawMeshes > thresholds.warnRawMeshes) {
    warnings.push(`${rawMeshes} objetos separados en Blender; en runtime se fusionan a ${mergedDrawCalls} draw calls.`);
    recommendations.push('En Blender puedes unir mallas estáticas por material (Ctrl+J) para acelerar la carga inicial.');
  }
  if (unappliedScaleNodes.length > 0) {
    warnings.push(`${unappliedScaleNodes.length} nodos tienen escala sin aplicar (ej. ${unappliedScaleNodes[0]}).`);
    recommendations.push('Selecciona todo en Blender y presiona Ctrl + A > All Transforms antes de exportar.');
  }
  if (unmappedGroups.length > 0) {
    const sample = unmappedGroups.slice(0, 6).map((u) => u.prefix).join(', ');
    warnings.push(`Prefijos nuevos sin mapear a pabellón: ${sample}`);
    recommendations.push('Revisa unmappedGroups[]. Si son edificios nuevos, mapéalos en glb-pipeline/mapping.config.json.');
  }

  return {
    schemaVersion: 2,
    analyzedAt: new Date().toISOString(),
    fileName: path.basename(absPath),
    sourcePath: absPath,
    sha256,
    shortHash: sha256.slice(0, 8),
    sizeBytes,
    sizeMB,
    grade,
    blockingErrors,
    coordinateSystem,
    stats: {
      nodesCount: nodes.length,
      rawMeshes,
      rawDrawCalls,
      mergedDrawCalls,
      reductionFactor: Number((rawDrawCalls / Math.max(1, mergedDrawCalls)).toFixed(1)),
      vertices: totalVertices,
      triangles: totalTriangles,
      materialsCount: materials.length,
      texturesCount: textures.length,
    },
    extensionsUsed,
    extensionsRequired,
    unsupportedExtensions,
    campusBounds,
    camera,
    groundHitPlane,
    detectedPabellones,
    landmarks,
    unmappedGroups,
    unappliedScaleCount: unappliedScaleNodes.length,
    warnings,
    recommendations,
    pabellonAliases: aliases,
  };
}
