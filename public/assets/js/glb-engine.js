import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEFAULT_ALIASES = [
  { prefix: 'PAB_ADMIN', codigo: 'PAB-ADM' },
  { prefix: 'PAB_NARANJA', codigo: 'PAB-NAR' },
  { prefix: 'PAB_U_3P', codigo: 'PAB-VER' },
  { prefix: 'PAB_INTERIOR', codigo: 'PAB-INT' },
  { prefix: 'PAB_BIBLIO', codigo: 'PAB-BIB' },
  { prefix: 'PAB_FONDO', codigo: 'PAB-POST' },
  { prefix: 'AUDITORIO', codigo: 'PAB-AUD' },
  { prefix: 'TORRE', codigo: 'PAB-TOR' },
  { prefix: 'LAB_NAVE1', codigo: 'PAB-TAL1' },
  { prefix: 'LAB_NAVE2', codigo: 'PAB-TAL2' },
  { prefix: 'LAB_NAVE3', codigo: 'PAB-TAL3' },
  { prefix: 'CANCHA', codigo: 'PAB-DEP' },
  { prefix: 'TRIBUNA', codigo: 'PAB-DEP' },
];

/**
 * Ejecutor runtime de modelos Blender (.glb) para Three.js.
 * Gestiona manifiesto de versiones, fusión de geometrías (batching),
 * cálculo automático de cámara/suelo y limpieza segura de VRAM.
 */
export class GlbEngine {
  constructor(aliases = DEFAULT_ALIASES) {
    this.loader = new GLTFLoader();
    this.aliases = Array.isArray(aliases) && aliases.length ? aliases : DEFAULT_ALIASES;
    this.lastTelemetry = null;
  }

  async fetchManifest(assetBase = '') {
    try {
      const apiRes = await fetch('/api/modelos', { credentials: 'same-origin' });
      if (apiRes.ok) {
        const json = await apiRes.json();
        if (json.ok && json.data) return json.data;
      }
    } catch {
      // Fallback directo al archivo estático si está corriendo sin backend PHP
    }

    const staticUrl = `${assetBase || ''}/assets/models/manifest.json`;
    const res = await fetch(staticUrl);
    if (!res.ok) return null;
    const manifest = await res.json();
    const activeModel = (manifest.models || []).find((m) => m.id === manifest.active) || null;
    return { ...manifest, activeModel };
  }

  resolveUrl(entry, assetBase = '') {
    if (!entry?.url) return '';
    const base = assetBase ? String(assetBase).replace(/\/$/, '') : '';
    const v = entry.hash ? `?v=${encodeURIComponent(entry.hash)}` : '';
    return `${base}${entry.url}${v}`;
  }

  resolvePabCode(rawName, customAliases = null) {
    const name = String(rawName || '').toUpperCase();
    if (!name) return null;
    const rules = Array.isArray(customAliases) && customAliases.length ? customAliases : this.aliases;
    for (const rule of rules) {
      if (name.startsWith(String(rule.prefix || '').toUpperCase())) {
        return rule.codigo;
      }
    }
    return null;
  }

  load(url, metaEntry = null) {
    const startedAt = performance.now();
    const aliases = metaEntry?.pabellonAliases || this.aliases;

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const rawScene = gltf.scene;
          rawScene.updateMatrixWorld(true);

          const { root, buildingInteractables, stats, computedBounds } = this._buildBatchedScene(
            rawScene,
            aliases
          );

          const camera = metaEntry?.camera || this._computeCameraPreset(computedBounds);
          const spanXZ = Math.max(
            160,
            Math.max(computedBounds.size[0], computedBounds.size[2]) * 1.8
          );
          const groundHitPlane = metaEntry?.groundHitPlane || {
            centerX: computedBounds.center[0],
            centerZ: computedBounds.center[2],
            size: Math.round(spanXZ),
          };

          const telemetry = {
            id: metaEntry?.id || 'preview',
            file: metaEntry?.file || 'modelo.glb',
            grade: metaEntry?.grade || 'A',
            sizeMB: metaEntry?.sizeMB ?? null,
            hash: metaEntry?.hash || null,
            loadMs: Math.round(performance.now() - startedAt),
            rawMeshes: stats.rawMeshes,
            mergedDrawCalls: stats.mergedDrawCalls,
            triangles: metaEntry?.stats?.triangles ?? stats.triangles,
            warnings: metaEntry?.warnings || [],
            bounds: metaEntry?.campusBounds || computedBounds,
          };
          this.lastTelemetry = telemetry;

          resolve({
            root,
            buildingInteractables,
            camera,
            groundHitPlane,
            telemetry,
          });
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  _buildBatchedScene(rawScene, aliases) {
    const root = new THREE.Group();
    const buildingInteractables = [];
    const buckets = new Map();
    const box = new THREE.Box3();

    let rawMeshes = 0;
    let triangles = 0;

    rawScene.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      rawMeshes++;

      const pabCode = this.resolvePabCode(child.name, aliases);
      const geomRaw = child.geometry;
      const idxCount = geomRaw.index ? geomRaw.index.count : (geomRaw.attributes.position?.count || 0);
      triangles += Math.floor(idxCount / 3);

      if (Array.isArray(child.material)) {
        const clonedGeom = geomRaw.clone();
        clonedGeom.applyMatrix4(child.matrixWorld);
        const mesh = new THREE.Mesh(clonedGeom, child.material);
        box.expandByObject(mesh);
        if (pabCode) {
          mesh.userData = { kind: 'custom_mesh', pabCode, fromCustomModel: true };
          buildingInteractables.push(mesh);
        }
        root.add(mesh);
        geomRaw.dispose();
        return;
      }

      const mat = child.material;
      const key = `${pabCode || 'ENV'}::${mat.uuid}`;
      let g = geomRaw.clone();
      if (g.index) {
        const nonIdx = g.toNonIndexed();
        g.dispose();
        g = nonIdx;
      }
      g.applyMatrix4(child.matrixWorld);
      if (!g.attributes.normal) {
        g.computeVertexNormals();
      }
      g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);

      const keepUv =
        Boolean(mat.map || mat.normalMap || mat.roughnessMap) && Boolean(g.attributes.uv);
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && !(keepUv && attr === 'uv')) {
          g.deleteAttribute(attr);
        }
      }

      if (!buckets.has(key)) {
        buckets.set(key, { mat, pabCode, keepUv, geoms: [] });
      }
      const bucket = buckets.get(key);
      if (!keepUv && bucket.keepUv) bucket.keepUv = false;
      bucket.geoms.push(g);
      geomRaw.dispose();
    });

    let mergedDrawCalls = 0;
    for (const bucket of buckets.values()) {
      if (!bucket.keepUv) {
        for (const g of bucket.geoms) {
          if (g.attributes.uv) g.deleteAttribute('uv');
        }
      }

      let mergedGeom = null;
      try {
        mergedGeom = mergeGeometries(bucket.geoms, false);
      } catch {
        mergedGeom = null;
      }

      if (mergedGeom) {
        for (const g of bucket.geoms) g.dispose();
        const mesh = new THREE.Mesh(mergedGeom, bucket.mat);
        if (bucket.pabCode) {
          mesh.userData = { kind: 'custom_mesh', pabCode: bucket.pabCode, fromCustomModel: true };
          buildingInteractables.push(mesh);
        }
        root.add(mesh);
        mergedDrawCalls++;
      } else {
        for (const g of bucket.geoms) {
          const mesh = new THREE.Mesh(g, bucket.mat);
          if (bucket.pabCode) {
            mesh.userData = { kind: 'custom_mesh', pabCode: bucket.pabCode, fromCustomModel: true };
            buildingInteractables.push(mesh);
          }
          root.add(mesh);
          mergedDrawCalls++;
        }
      }
    }

    const sizeVec = new THREE.Vector3();
    const centerVec = new THREE.Vector3();
    if (!box.isEmpty()) {
      box.getSize(sizeVec);
      box.getCenter(centerVec);
    }

    const computedBounds = {
      min: [Number(box.min.x.toFixed(2)), Number(box.min.y.toFixed(2)), Number(box.min.z.toFixed(2))],
      max: [Number(box.max.x.toFixed(2)), Number(box.max.y.toFixed(2)), Number(box.max.z.toFixed(2))],
      size: [Number(sizeVec.x.toFixed(2)), Number(sizeVec.y.toFixed(2)), Number(sizeVec.z.toFixed(2))],
      center: [Number(centerVec.x.toFixed(2)), Number(centerVec.y.toFixed(2)), Number(centerVec.z.toFixed(2))],
    };

    return {
      root,
      buildingInteractables,
      stats: { rawMeshes, mergedDrawCalls, triangles },
      computedBounds,
    };
  }

  _computeCameraPreset(bounds) {
    const [sx, sy, sz] = bounds.size;
    const [cx, , cz] = bounds.center;
    const spanXZ = Math.max(30, Math.hypot(sx, sz));
    const targetY = Number(Math.max(2, bounds.min[1] + Math.min(4.5, sy * 0.25)).toFixed(2));
    const maxDistance = Math.max(160, Math.round(spanXZ * 1.45));

    return {
      position: [
        Number((cx + spanXZ * 0.14).toFixed(2)),
        Number(Math.max(24, spanXZ * 0.44).toFixed(2)),
        Number((bounds.max[2] + spanXZ * 0.18).toFixed(2)),
      ],
      target: [Number(cx.toFixed(2)), targetY, Number(cz.toFixed(2))],
      minDistance: 12,
      maxDistance,
      far: Math.max(450, Math.round(maxDistance * 2.2)),
      fogDensity: Number((0.42 / Math.max(120, spanXZ)).toFixed(4)),
    };
  }

  disposeGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
        }
      });
    }
  }
}
