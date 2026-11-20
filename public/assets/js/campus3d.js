import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GlbEngine } from './glb-engine.js';

/**
 * Croquis 3D dinámico del IESTP "Cap. FAP José Abelardo Quiñones" (Av. Tumbes Norte N° 1228).
 * Modela los pabellones reales, Paseo Central, Plaza Cívica, 6 Laboratorios, 10 Oficinas,
 * antenas WiFi con alcance real a escala (metros) y sonda interactiva de señal.
 * Soporta carga directa de modelos Blender (.glb) con fallback procedural.
 */
export class Campus3D {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.mode = 'neon'; // 'neon' | 'real'
    this.floorFilter = 0; // 0 = todos, 1..3 = piso máximo destacado
    this.showCoverage = true;
    this.showLabels = true;
    this.probeMode = false;
    this.pickMode = null; // { radius, onPick }

    this.modelGlbUrl = callbacks.modelGlbUrl || (typeof window !== 'undefined' && window.APP_CONFIG?.modelGlbUrl) || '/assets/models/tecno-v1.glb';
    this.hasCustomModel = false;
    this.customModelScene = null;
    this.customMeshMap = new Map();
    this.glbEngine = new GlbEngine();
    this.manifest = null;
    this.activeCameraPreset = {
      position: [28, 92, 48],
      target: [0, 4, -58],
      minDistance: 12,
      maxDistance: 280,
      far: 550,
      fogDensity: 0.0022,
    };
    this.activeGroundPlane = { centerX: 0, centerZ: -58, size: 280 };

    this.data = null;
    this.selectedWifiId = null;

    this.pinInteractables = [];
    this.buildingInteractables = [];
    this.wifiVisuals = new Map();
    this.labVisuals = new Map();
    this.careerVisuals = new Map();
    this.buildingFloorMeshes = [];
    this.labelSprites = [];
    this.probeMarker = null;
    this.pickPreview = null;

    this.flyState = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerDownPos = { x: 0, y: 0 };

    // Control de energía y rendimiento
    this.isPaused = false;
    this.isInView = true;
    this.isTabVisible = typeof document !== 'undefined' ? !document.hidden : true;
    this.isInteracting = false;
    this.needsRender = true;
    this.lastHoverAt = 0;
    this.lastRenderAt = 0;

    this._initScene();
    this._bindEvents();
    this._animate(0);
    this._bootModel();
  }

  _initScene() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 620;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x041b2d, 0.0022);

    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.5, 550);
    this.camera.position.set(28, 92, 48);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.465;
    this.controls.minPolarAngle = 0.12;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 280;
    this.controls.target.set(0, 4, -58);

    this.controls.addEventListener('start', () => {
      this.isInteracting = true;
      this.needsRender = true;
    });
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    this.controls.addEventListener('end', () => {
      this.isInteracting = false;
    });

    // Luces ligeras sin ShadowMap pesado
    this.ambientLight = new THREE.AmbientLight(0xbbeeff, 1.18);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x06283d, 1.0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xf0faff, 1.65);
    this.dirLight.position.set(48, 95, 20);
    this.dirLight.castShadow = false;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    this.fillLight.position.set(-55, 45, -90);
    this.scene.add(this.fillLight);

    this.accentLight = new THREE.PointLight(0xff1e56, 1.4, 110, 1.6);
    this.accentLight.position.set(-15, 14, -22);
    this.scene.add(this.accentLight);

    // Grupos principales
    this.envGroup = new THREE.Group();
    this.buildingsGroup = new THREE.Group();
    this.customModelGroup = new THREE.Group();
    this.labelsGroup = new THREE.Group();
    this.wifiGroup = new THREE.Group();
    this.markersGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();

    this.scene.add(
      this.envGroup,
      this.buildingsGroup,
      this.customModelGroup,
      this.labelsGroup,
      this.wifiGroup,
      this.markersGroup,
      this.overlayGroup
    );

    this._buildCampusBase();
  }

  _buildCampusBase() {
    this._clearGroup(this.envGroup);

    const isNeon = this.mode === 'neon';
    const gp = this.activeGroundPlane || { centerX: 0, centerZ: -58, size: 280 };

    // Plano invisible para raycasting exacto del suelo (y=0) adaptado al tamaño real del modelo
    const hitGeo = new THREE.PlaneGeometry(gp.size, gp.size);
    hitGeo.rotateX(-Math.PI / 2);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.groundHitMesh = new THREE.Mesh(hitGeo, hitMat);
    this.groundHitMesh.position.set(gp.centerX, 0, gp.centerZ);
    this.groundHitMesh.name = 'ground-plane';
    this.envGroup.add(this.groundHitMesh);

    // Si el modelo Blender está activo, no duplicamos árboles ni obeliscos procedurales
    if (this.hasCustomModel) {
      const surround = new THREE.Mesh(
        new THREE.BoxGeometry(gp.size, 0.4, gp.size),
        new THREE.MeshStandardMaterial({
          color: isNeon ? 0x031422 : 0xcbd5e1,
          roughness: 0.95,
        })
      );
      surround.position.set(gp.centerX, -0.35, gp.centerZ);
      this.envGroup.add(surround);
      return;
    }

    // Suelo principal del campus (modo fallback sin GLB)
    const groundGeo = new THREE.BoxGeometry(160, 0.8, 170);
    const groundMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x052136 : 0xd8dee6,
      roughness: 0.92,
      metalness: isNeon ? 0.15 : 0.04,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.45, -4);
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    // Grilla métrica sutil
    const grid = new THREE.GridHelper(
      120,
      24,
      isNeon ? 0x22d3ee : 0x64748b,
      isNeon ? 0x0c3c5c : 0xcbd5e1
    );
    grid.position.set(0, 0.01, -4);
    grid.material.transparent = true;
    grid.material.opacity = isNeon ? 0.24 : 0.18;
    this.envGroup.add(grid);

    // Av. Tumbes Norte (frente del campus, z = +56)
    const roadMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x031422 : 0x334155,
      roughness: 0.9,
    });
    const road = new THREE.Mesh(new THREE.BoxGeometry(132, 0.2, 11), roadMat);
    road.position.set(0, -0.05, 57);
    this.envGroup.add(road);

    // Línea central de avenida
    const lineMat = new THREE.MeshBasicMaterial({
      color: isNeon ? 0x38bdf8 : 0xfacc15,
      transparent: true,
      opacity: isNeon ? 0.45 : 0.85,
    });
    for (let x = -54; x <= 54; x += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(4, 0.06, 0.35), lineMat);
      dash.position.set(x, 0.07, 57);
      this.envGroup.add(dash);
    }

    // Paseo Central (eje X=0 desde portada z=+48 hasta fondo z=-56)
    const walkMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x0b3959 : 0xe2e8f0,
      roughness: 0.85,
    });
    const paseo = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.12, 106), walkMat);
    paseo.position.set(0, 0.04, -4);
    paseo.receiveShadow = true;
    this.envGroup.add(paseo);

    // Bordes celeste sutiles del paseo central
    const edgeMat = new THREE.MeshBasicMaterial({
      color: isNeon ? 0x22d3ee : 0x94a3b8,
      transparent: true,
      opacity: isNeon ? 0.45 : 0.5,
    });
    for (const sx of [-4.75, 4.75]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 106), edgeMat);
      strip.position.set(sx, 0.06, -4);
      this.envGroup.add(strip);
    }

    // Cerco frontal, caseta de vigilancia y portón (Av. Tumbes Norte N° 1228)
    const wallMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x0e4163 : 0xf1f5f9,
      roughness: 0.7,
    });
    const accentWallMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0xff1e56 : 0xea580c,
      roughness: 0.55,
      emissive: isNeon ? 0xff1e56 : 0x000000,
      emissiveIntensity: isNeon ? 0.25 : 0,
    });

    // Muro derecho institucional (donde va el nombre)
    const frontWallR = new THREE.Mesh(new THREE.BoxGeometry(30, 2.4, 0.6), wallMat);
    frontWallR.position.set(19, 1.2, 48.5);
    this.envGroup.add(frontWallR);
    const frontBaseR = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 0.7), accentWallMat);
    frontBaseR.position.set(19, 0.3, 48.5);
    this.envGroup.add(frontBaseR);

    // Caseta de vigilancia y portón central
    const caseta = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.0, 3.0), wallMat);
    caseta.position.set(-5.2, 1.5, 48.5);
    this.envGroup.add(caseta);

    const gateMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x38bdf8 : 0x475569,
      metalness: 0.5,
      roughness: 0.4,
    });
    const gate = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.5, 0.25), gateMat);
    gate.position.set(0.5, 1.25, 48.8);
    this.envGroup.add(gate);

    // Plaza Cívica Circular (frente izquierdo, junto a Pabellón Administrativo)
    const plazaPos = new THREE.Vector3(-8.5, 0.05, 31.5);
    for (let step = 0; step < 3; step++) {
      const r = 5.4 - step * 1.1;
      const disk = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r + 0.2, 0.25, 32),
        new THREE.MeshStandardMaterial({
          color: isNeon ? 0x0f496f : 0xcbd5e1,
          roughness: 0.75,
        })
      );
      disk.position.set(plazaPos.x, 0.12 + step * 0.22, plazaPos.z);
      this.envGroup.add(disk);
    }
    const obelisk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.7, 3.0, 8),
      accentWallMat
    );
    obelisk.position.set(plazaPos.x, 2.1, plazaPos.z);
    this.envGroup.add(obelisk);

    // 3 Astas de bandera detrás de la plaza cívica
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.25 });
    for (let i = -1; i <= 1; i++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7.2, 8), poleMat);
      pole.position.set(plazaPos.x + i * 2.2, 3.6, plazaPos.z - 5.2);
      this.envGroup.add(pole);
    }

    // Áreas verdes y palmeras estilizadas en Paseo Central y Plaza Derecha
    const grassMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x0a4b49 : 0x22c55e,
      roughness: 0.9,
    });
    const greenPatches = [
      [-10, 12, 5, 12],
      [7.5, 22, 5, 14],
      [-10, -16, 5, 18],
      [7.5, -8, 4.5, 16],
      [7.5, -34, 4.5, 16],
    ];
    for (const [gx, gz, gw, gd] of greenPatches) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.1, gd), grassMat);
      patch.position.set(gx, 0.05, gz);
      this.envGroup.add(patch);
    }

    const palmCoords = [
      [8.2, 26], [8.2, 18], [8.2, 10], [8.2, -4], [8.2, -16], [8.2, -32],
      [-6.5, 21], [-6.5, 4], [-6.5, -18],
    ];
    const trunkMat = new THREE.MeshStandardMaterial({ color: isNeon ? 0x1e4e68 : 0x92400e });
    const leafMat = new THREE.MeshStandardMaterial({
      color: isNeon ? 0x10b981 : 0x16a34a,
      emissive: isNeon ? 0x059669 : 0x000000,
      emissiveIntensity: isNeon ? 0.22 : 0,
    });

    for (const [px, pz] of palmCoords) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 4.4, 6), trunkMat);
      trunk.position.set(px, 2.2, pz);
      this.envGroup.add(trunk);

      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.65, 1.5, 7), leafMat);
      crown.position.set(px, 4.7, pz);
      this.envGroup.add(crown);
    }

    // Postes de iluminación a lo largo del Paseo Central
    for (let z = 40; z >= -48; z -= 16) {
      for (const sx of [-4.4, 4.4]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.4, 6), poleMat);
        lamp.position.set(sx, 3.2, z);
        this.envGroup.add(lamp);

        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 10, 10),
          new THREE.MeshBasicMaterial({ color: isNeon ? 0x22d3ee : 0xfef08a })
        );
        bulb.position.set(sx, 6.4, z);
        this.envGroup.add(bulb);
      }
    }

    if (this.showLabels) {
      const roadLabel = this._makeTextSprite('AV. TUMBES NORTE N° 1228', '#7DD3FC', 'rgba(4, 27, 45, 0.78)');
      roadLabel.position.set(0, 3.6, 52);
      roadLabel.scale.set(14, 3.2, 1);
      this.envGroup.add(roadLabel);
    }
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    if (!this.isPaused) {
      this.needsRender = true;
      this.lastRenderAt = 0;
    }
  }

  setData(campusData) {
    this.data = campusData;
    if (!this.hasCustomModel) {
      this._rebuildBuildings();
    }
    this.buildingsGroup.visible = !this.hasCustomModel;
    this._rebuildLabels();
    this._rebuildWifis();
    this._rebuildMarkers();
    this.applyFloorFilter(this.floorFilter);
    this.needsRender = true;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const isNeon = mode === 'neon';
    this.scene.fog.color.setHex(isNeon ? 0x041b2d : 0x0e3b5c);
    this.ambientLight.intensity = isNeon ? 1.18 : 1.45;
    this.hemiLight.intensity = isNeon ? 1.0 : 1.2;
    this.dirLight.intensity = isNeon ? 1.65 : 2.0;
    this.fillLight.intensity = isNeon ? 0.75 : 0.9;
    this.accentLight.intensity = isNeon ? 1.4 : 0.45;
    this._buildCampusBase();
    this.buildingsGroup.visible = !this.hasCustomModel;
    if (this.data) {
      if (!this.hasCustomModel) this._rebuildBuildings();
      this._rebuildLabels();
      this._rebuildWifis();
      this._rebuildMarkers();
      this.applyFloorFilter(this.floorFilter);
    }
    this.needsRender = true;
  }

  setCoverageVisible(visible) {
    this.showCoverage = visible;
    for (const v of this.wifiVisuals.values()) {
      v.coverageGroup.visible = visible;
    }
    this.needsRender = true;
  }

  setLabelsVisible(visible) {
    this.showLabels = Boolean(visible);
    this.labelsGroup.visible = this.showLabels;
    if (!this.hasCustomModel) {
      this._buildCampusBase();
      if (this.data) this._rebuildBuildings();
    }
    if (this.data) this._rebuildLabels();
    this.needsRender = true;
  }

  _rebuildLabels() {
    this._clearGroup(this.labelsGroup);
    this.labelsGroup.visible = this.showLabels;
    if (!this.showLabels || !this.data) return;
    const isNeon = this.mode === 'neon';
    const fg = isNeon ? '#7DD3FC' : '#F8FAFC';
    const bg = isNeon ? 'rgba(4, 27, 45, 0.84)' : 'rgba(15, 23, 42, 0.84)';
    for (const pab of this.data.pabellones) {
      const lbl = this._makeTextSprite(pab.codigo, fg, bg);
      lbl.position.set(pab.pos_x, (pab.alto || 4) + 3.5, pab.pos_z);
      lbl.scale.set(8.5, 2.4, 1);
      this.labelsGroup.add(lbl);
    }
  }

  applyFloorFilter(floor) {
    this.floorFilter = Number(floor) || 0;
    for (const entry of this.buildingFloorMeshes) {
      const active = this.floorFilter === 0 || entry.floor <= this.floorFilter;
      entry.mesh.material.opacity = active ? entry.baseOpacity : 0.16;
      entry.mesh.material.transparent = !active || entry.baseOpacity < 1;
      if (entry.bandMesh) {
        entry.bandMesh.material.opacity = active ? 0.95 : 0.18;
        entry.bandMesh.material.transparent = !active;
      }
    }

    for (const [id, vis] of this.wifiVisuals.entries()) {
      const match = this.floorFilter === 0 || vis.wifi.piso === this.floorFilter;
      vis.group.visible = match || id === this.selectedWifiId;
      vis.coverageGroup.visible = this.showCoverage && (match || id === this.selectedWifiId);
    }
    this.needsRender = true;
  }

  selectWifi(id, fly = true) {
    this.selectedWifiId = id ? Number(id) : null;
    for (const [wid, vis] of this.wifiVisuals.entries()) {
      const isSelected = wid === this.selectedWifiId;
      const isMaint = vis.wifi.estado === 'mantenimiento';
      const baseHex = isSelected || isMaint ? 0xff1e56 : new THREE.Color(vis.wifi.color_senal || '#22D3EE').getHex();
      vis.coreMat.color.setHex(baseHex);
      vis.domeMat.color.setHex(baseHex);
      vis.ringMat.color.setHex(baseHex);
      vis.domeMat.opacity = isSelected ? 0.24 : 0.11;
      vis.ringMat.opacity = isSelected ? 0.88 : 0.45;
    }
    if (fly && this.selectedWifiId && this.wifiVisuals.has(this.selectedWifiId)) {
      const w = this.wifiVisuals.get(this.selectedWifiId).wifi;
      this.flyTo(w.pos_x, w.pos_y, w.pos_z, Math.max(24, w.alcance_metros * 1.1));
    }
    this.needsRender = true;
  }

  flyTo(x, y, z, distance = 30) {
    const target = new THREE.Vector3(Number(x), Math.max(1.5, Number(y)), Number(z));
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1) dir.set(0.4, 0.75, 0.9);
    dir.normalize();
    const nextPos = target.clone().add(dir.multiplyScalar(distance));
    nextPos.y = Math.max(14, Math.min(78, target.y + distance * 0.65));

    this.flyState = {
      startPos: this.camera.position.clone(),
      endPos: nextPos,
      startTarget: this.controls.target.clone(),
      endTarget: target,
      t: 0,
    };
    this.needsRender = true;
  }

  resetCamera() {
    const pos = this.activeCameraPreset?.position || [28, 92, 48];
    const tgt = this.activeCameraPreset?.target || [0, 4, -58];
    this.flyState = {
      startPos: this.camera.position.clone(),
      endPos: new THREE.Vector3(pos[0], pos[1], pos[2]),
      startTarget: this.controls.target.clone(),
      endTarget: new THREE.Vector3(tgt[0], tgt[1], tgt[2]),
      t: 0,
    };
    this.needsRender = true;
  }

  setProbeMode(enabled) {
    this.probeMode = Boolean(enabled);
    if (!this.probeMode && this.probeMarker) {
      this.overlayGroup.remove(this.probeMarker);
      this.probeMarker = null;
    }
    this.renderer.domElement.style.cursor = this.probeMode || this.pickMode ? 'crosshair' : 'grab';
  }

  startPickPosition(radius, onPick) {
    this.pickMode = { radius: Number(radius) || 25, onPick };
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  cancelPickPosition() {
    this.pickMode = null;
    if (this.pickPreview) {
      this.overlayGroup.remove(this.pickPreview);
      this.pickPreview = null;
    }
    this.renderer.domElement.style.cursor = this.probeMode ? 'crosshair' : 'grab';
  }

  _rebuildBuildings() {
    this._clearGroup(this.buildingsGroup);
    this.buildingFloorMeshes = [];
    const isNeon = this.mode === 'neon';

    for (const pab of this.data.pabellones) {
      const g = new THREE.Group();
      g.position.set(pab.pos_x, pab.pos_y, pab.pos_z);
      g.rotation.y = pab.rotacion_y || 0;

      if (pab.forma_techo === 'cancha') {
        const court = new THREE.Mesh(
          new THREE.BoxGeometry(pab.ancho, 0.35, pab.profundidad),
          new THREE.MeshStandardMaterial({
            color: isNeon ? 0x0b5345 : 0x16a34a,
            roughness: 0.8,
          })
        );
        court.position.y = 0.2;
        g.add(court);

        const border = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(pab.ancho - 1.2, 0.4, pab.profundidad - 1.4)),
          new THREE.LineBasicMaterial({ color: isNeon ? 0x22d3ee : 0xf8fafc })
        );
        border.position.y = 0.24;
        g.add(border);
      } else {
        const floors = Math.max(1, pab.pisos || 1);
        const floorH = pab.alto / floors;
        const bodyColor = isNeon ? 0x0b3250 : 0xe2e8f0;
        const accentColor = new THREE.Color(pab.color_acento || '#38BDF8');

        for (let f = 1; f <= floors; f++) {
          const boxGeo = new THREE.BoxGeometry(pab.ancho, floorH - 0.14, pab.profundidad);
          const mat = new THREE.MeshStandardMaterial({
            color: bodyColor,
            roughness: isNeon ? 0.55 : 0.72,
            metalness: isNeon ? 0.22 : 0.05,
            transparent: isNeon,
            opacity: isNeon ? 0.88 : 1,
          });
          const mesh = new THREE.Mesh(boxGeo, mat);
          const cy = (f - 0.5) * floorH;
          mesh.position.y = cy;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          g.add(mesh);

          // Banda cromática por piso (fiel a las franjas naranja, verde, azul y rojo de las fotos)
          const bandMat = new THREE.MeshStandardMaterial({
            color: accentColor,
            emissive: isNeon ? accentColor : new THREE.Color(0x000000),
            emissiveIntensity: isNeon ? 0.22 : 0,
            roughness: 0.45,
          });
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(pab.ancho + 0.16, Math.min(0.7, floorH * 0.24), pab.profundidad + 0.16),
            bandMat
          );
          band.position.y = cy + floorH * 0.28;
          g.add(band);

          // Aristas celeste suaves en Modo Neón
          if (isNeon) {
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(boxGeo),
              new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.34 })
            );
            edges.position.y = cy;
            g.add(edges);
          }

          // Ventanas estilizadas en los costados frontales/laterales
          const winCount = Math.max(3, Math.floor(pab.ancho / 3.4));
          const winMat = new THREE.MeshBasicMaterial({
            color: isNeon ? 0x7dd3fc : 0x334155,
            transparent: true,
            opacity: isNeon ? 0.45 : 0.72,
          });
          for (let wi = 0; wi < winCount; wi++) {
            const wx = -pab.ancho * 0.42 + (wi / Math.max(1, winCount - 1)) * (pab.ancho * 0.84);
            for (const wz of [pab.profundidad * 0.505, -pab.profundidad * 0.505]) {
              const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, floorH * 0.38), winMat);
              win.position.set(wx, cy - floorH * 0.05, wz);
              if (wz < 0) win.rotation.y = Math.PI;
              g.add(win);
            }
          }

          this.buildingFloorMeshes.push({
            floor: f,
            mesh,
            bandMesh: band,
            baseOpacity: isNeon ? 0.88 : 1,
          });
        }

        // Techo característico según edificio real
        if (pab.forma_techo === 'escalonado') {
          // Nave industrial con doble volumen y lucernario (Talleres 1, 2 y 3)
          const roofMat = new THREE.MeshStandardMaterial({
            color: isNeon ? 0x164e78 : 0x7ba7c9,
            roughness: 0.42,
            metalness: 0.35,
          });
          const ridge = new THREE.Mesh(
            new THREE.BoxGeometry(pab.ancho * 0.84, 1.4, pab.profundidad * 0.48),
            roofMat
          );
          ridge.position.y = pab.alto + 0.6;
          ridge.castShadow = true;
          g.add(ridge);

          const ridge2 = new THREE.Mesh(
            new THREE.BoxGeometry(pab.ancho * 0.76, 0.9, pab.profundidad * 0.22),
            roofMat
          );
          ridge2.position.y = pab.alto + 1.5;
          g.add(ridge2);
        } else if (pab.forma_techo === 'torre') {
          const cap = new THREE.Mesh(
            new THREE.BoxGeometry(pab.ancho + 0.5, 0.6, pab.profundidad + 0.5),
            new THREE.MeshStandardMaterial({ color: isNeon ? 0x22d3ee : 0x94a3b8 })
          );
          cap.position.y = pab.alto + 0.3;
          g.add(cap);
        } else {
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(pab.ancho + 0.6, 0.45, pab.profundidad + 0.6),
            new THREE.MeshStandardMaterial({
              color: isNeon ? 0x103c5e : 0x94a3b8,
              roughness: 0.6,
            })
          );
          roof.position.y = pab.alto + 0.22;
          g.add(roof);
        }
      }

      this.buildingsGroup.add(g);
    }
  }

  _rebuildWifis() {
    this._clearGroup(this.wifiGroup);
    this.wifiVisuals.clear();
    this.pinInteractables = this.pinInteractables.filter((m) => m.userData.kind !== 'wifi');

    for (const w of this.data.redes_wifi) {
      const isSelected = w.id === this.selectedWifiId;
      const isMaint = w.estado === 'mantenimiento';
      const isOff = w.estado === 'inactiva';
      const colorHex = isSelected || isMaint
        ? 0xff1e56
        : (isOff ? 0x64748b : new THREE.Color(w.color_senal || '#22D3EE').getHex());

      const group = new THREE.Group();
      group.position.set(w.pos_x, w.pos_y, w.pos_z);

      // Mástil y núcleo emisor de la antena WiFi
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.2, 1.5, 6),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6, roughness: 0.3 })
      );
      mast.position.y = -0.5;
      group.add(mast);

      const coreMat = new THREE.MeshBasicMaterial({ color: colorHex });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 12), coreMat);
      core.position.y = 0.4;
      core.userData = { kind: 'wifi', item: w };
      group.add(core);
      this.pinInteractables.push(core);

      // Halo exterior de la antena
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 12, 12),
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.28 })
      );
      halo.position.y = 0.4;
      group.add(halo);

      // Grupo de alcance real en metros (Domo + Anillo suelo + Onda pulsante)
      const coverageGroup = new THREE.Group();
      coverageGroup.position.set(w.pos_x, 0.08, w.pos_z);
      coverageGroup.visible = this.showCoverage;

      const r = Math.max(5, Number(w.alcance_metros) || 24);
      const domeMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: isSelected ? 0.24 : 0.11,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
        domeMat
      );
      dome.scale.y = 0.52;
      coverageGroup.add(dome);

      const ringMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: isSelected ? 0.88 : 0.45,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.32, r, 36), ringMat);
      ring.rotation.x = -Math.PI / 2;
      coverageGroup.add(ring);

      const pulseMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.35, 32), pulseMat);
      pulseRing.rotation.x = -Math.PI / 2;
      coverageGroup.add(pulseRing);

      this.wifiGroup.add(group);
      this.wifiGroup.add(coverageGroup);

      this.wifiVisuals.set(w.id, {
        wifi: w,
        group,
        coverageGroup,
        core,
        halo,
        coreMat,
        domeMat,
        ringMat,
        pulseRing,
        pulseMat,
        radius: r,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  _rebuildMarkers() {
    this._clearGroup(this.markersGroup);
    this.labVisuals.clear();
    this.careerVisuals.clear();
    this.pinInteractables = this.pinInteractables.filter((m) => m.userData.kind === 'wifi');

    // Marcadores de los 6 Laboratorios de Cómputo
    for (const lab of this.data.laboratorios) {
      const color = lab.estado === 'mantenimiento' ? 0xff1e56 : (lab.estado === 'ocupado' ? 0xfbbf24 : 0x38bdf8);
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.85, 0),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.45,
          roughness: 0.2,
        })
      );
      mesh.position.set(lab.pos_x, lab.pos_y + 1.8, lab.pos_z);
      mesh.userData = { kind: 'lab', item: lab };
      this.markersGroup.add(mesh);
      this.pinInteractables.push(mesh);
      this.labVisuals.set(lab.id, mesh);
    }

    // Marcadores discretos de las 10 Oficinas de Carreras
    for (const car of this.data.oficinas_carreras) {
      const color = car.area === 'Salud' ? 0x22d3ee : (car.area === 'Gestión' ? 0x7dd3fc : 0xff2e63);
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.55, 0),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
          roughness: 0.3,
        })
      );
      mesh.position.set(car.pos_x, car.pos_y + 1.2, car.pos_z);
      mesh.userData = { kind: 'career', item: car };
      this.markersGroup.add(mesh);
      this.pinInteractables.push(mesh);
      this.careerVisuals.set(car.id, mesh);
    }
  }

  _bindEvents() {
    const dom = this.renderer.domElement;

    if ('IntersectionObserver' in window) {
      this._io = new IntersectionObserver(
        (entries) => {
          this.isInView = entries[0]?.isIntersecting ?? true;
          if (this.isInView && !this.isPaused) {
            this.needsRender = true;
          }
        },
        { threshold: 0.02 }
      );
      this._io.observe(this.container);
    }

    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = !document.hidden;
      if (this.isTabVisible && !this.isPaused) {
        this.needsRender = true;
      }
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    dom.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - this.lastHoverAt < 50) return;
      this.lastHoverAt = now;

      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (this.pickMode) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObject(this.groundHitMesh, false);
        if (hits.length) {
          this._showPickPreview(hits[0].point.x, hits[0].point.z, this.pickMode.radius);
          this.needsRender = true;
        }
        return;
      }

      if (!this.probeMode && this.pinInteractables.length) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.pinInteractables, false);
        dom.style.cursor = hits.length ? 'pointer' : 'grab';
      }
    });

    dom.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (moved > 6) return;

      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);

      if (this.pickMode) {
        const hits = this.raycaster.intersectObject(this.groundHitMesh, false);
        if (hits.length) {
          const p = hits[0].point;
          const cb = this.pickMode.onPick;
          this.cancelPickPosition();
          cb({ x: Number(p.x.toFixed(2)), z: Number(p.z.toFixed(2)) });
        }
        return;
      }

      if (this.probeMode) {
        const hits = this.raycaster.intersectObject(this.groundHitMesh, false);
        if (hits.length) {
          this._runSignalProbe(hits[0].point);
          this.needsRender = true;
        }
        return;
      }

      let hits = this.raycaster.intersectObjects(this.pinInteractables, false);
      if (!hits.length && this.buildingInteractables.length) {
        hits = this.raycaster.intersectObjects(this.buildingInteractables, false);
      }

      if (hits.length) {
        const { kind, item, pabCode } = hits[0].object.userData;
        if (kind === 'wifi') {
          this.selectWifi(item.id, true);
          this.callbacks.onSelect?.(kind, item);
        } else if (kind === 'custom_mesh') {
          const pab = pabCode ? this.data?.pabellones?.find((p) => p.codigo === pabCode) : null;
          if (pab) {
            this.flyTo(pab.pos_x, (pab.alto || 4) * 0.5, pab.pos_z, 34);
            this.callbacks.onSelect?.('pabellon', pab);
          } else {
            this.callbacks.onToast?.('Estructura del campus seleccionada');
          }
        } else {
          this.flyTo(item.pos_x, item.pos_y, item.pos_z, 26);
          this.callbacks.onSelect?.(kind, item);
        }
      }
    });

    // Soporte Drag & Drop de archivo .glb de Blender directamente al visor
    dom.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.style.cursor = 'copy';
    });
    dom.addEventListener('dragleave', () => {
      dom.style.cursor = 'grab';
    });
    dom.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.style.cursor = 'grab';
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf'))) {
        const objectUrl = URL.createObjectURL(file);
        this.callbacks.onToast?.(`Cargando modelo Blender: ${file.name}...`);
        this.loadFromBlob(objectUrl, file.name);
      }
    });

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 620;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _runSignalProbe(point) {
    if (this.probeMarker) {
      this.overlayGroup.remove(this.probeMarker);
    }
    const marker = new THREE.Group();
    marker.position.set(point.x, 0.15, point.z);

    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.05, 3.8, 12),
      new THREE.MeshBasicMaterial({ color: 0xff1e56 })
    );
    pin.position.y = 1.9;
    marker.add(pin);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff1e56 })
    );
    head.position.y = 3.9;
    marker.add(head);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.9, 32),
      new THREE.MeshBasicMaterial({ color: 0xff1e56, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    marker.add(ring);

    this.probeMarker = marker;
    this.overlayGroup.add(marker);

    // Calcular todas las redes activas que alcanzan este punto
    const activeFloor = this.floorFilter || 1;
    const matches = [];
    for (const w of this.data?.redes_wifi || []) {
      if (w.estado === 'inactiva') continue;
      const dist = Math.hypot(point.x - w.pos_x, point.z - w.pos_z);
      if (dist <= w.alcance_metros) {
        const floorDiff = Math.abs(activeFloor - w.piso);
        const estDbm = Math.round(w.potencia_dbm - 14 * Math.log10(Math.max(1, dist / 2)) - floorDiff * 5);
        const pct = Math.max(8, Math.min(100, Math.round(((estDbm + 90) / 55) * 100)));
        matches.push({
          wifi: w,
          dist: Number(dist.toFixed(1)),
          estDbm,
          pct,
        });
      }
    }
    matches.sort((a, b) => b.pct - a.pct);
    this.callbacks.onProbe?.({
      x: Number(point.x.toFixed(1)),
      z: Number(point.z.toFixed(1)),
      matches,
    });
  }

  _showPickPreview(x, z, radius) {
    if (!this.pickPreview) {
      const grp = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xff1e56 })
      );
      sphere.position.y = 2.6;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(4, radius - 0.35), Math.max(4.4, radius), 48),
        new THREE.MeshBasicMaterial({ color: 0xff1e56, side: THREE.DoubleSide, transparent: true, opacity: 0.78 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.14;
      grp.add(sphere, ring);
      this.pickPreview = grp;
      this.overlayGroup.add(grp);
    }
    this.pickPreview.position.set(x, 0, z);
  }

  _animate(now = 0) {
    requestAnimationFrame((ts) => this._animate(ts));

    if (this.isPaused || !this.isInView || !this.isTabVisible) {
      return;
    }

    const activeMotion = this.isInteracting || this.flyState !== null || this.pickMode !== null || this.needsRender;
    // En reposo renderiza a ~20 FPS (cada 50ms); interactuando va a 60 FPS
    if (!activeMotion && now - this.lastRenderAt < 50) {
      return;
    }

    this.lastRenderAt = now;
    this.needsRender = false;
    const t = this.clock.getElapsedTime();

    if (this.flyState) {
      this.flyState.t = Math.min(1, this.flyState.t + 0.055);
      const k = 1 - Math.pow(1 - this.flyState.t, 3); // Ease out cubic
      this.camera.position.lerpVectors(this.flyState.startPos, this.flyState.endPos, k);
      this.controls.target.lerpVectors(this.flyState.startTarget, this.flyState.endTarget, k);
      if (this.flyState.t >= 1) this.flyState = null;
    }

    // Ondas suaves en cada antena WiFi
    for (const vis of this.wifiVisuals.values()) {
      const wave = ((t * 0.45 + vis.phase) % 1);
      const scale = 0.12 + wave * (vis.radius * 0.85);
      vis.pulseRing.scale.set(scale, scale, 1);
      vis.pulseMat.opacity = (1 - wave) * 0.5;
      vis.halo.scale.setScalar(0.92 + Math.sin(t * 2.6 + vis.phase) * 0.14);
    }

    // Rotación sutil de marcadores de laboratorios
    for (const mesh of this.labVisuals.values()) {
      mesh.rotation.y = t * 0.9;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _makeTextSprite(text, fg, bg) {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 84;
    const ctx = canvas.getContext('2d');

    // Cápsula pill redondeada
    ctx.fillStyle = bg;
    const r = 36;
    ctx.beginPath();
    ctx.roundRect(8, 8, 344, 68, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.font = '700 28px "Space Grotesk", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 180, 43);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  }

  async _bootModel() {
    const assetBase = typeof window !== 'undefined' ? (window.APP_CONFIG?.assetBase || '') : '';
    try {
      const manifest = await this.glbEngine.fetchManifest(assetBase);
      if (manifest?.activeModel) {
        this.manifest = manifest;
        await this.switchModelByEntry(manifest.activeModel, true);
        return;
      }
    } catch {
      // Continuar con fallback directo por URL
    }

    if (!this.modelGlbUrl) return;
    try {
      const res = await fetch(this.modelGlbUrl, { method: 'HEAD' });
      if (res.ok) {
        await this.loadGlbModel(this.modelGlbUrl, null, true);
      }
    } catch {
      // Sin .glb cargado aún; se mantiene la maqueta procedural base
    }
  }

  async switchModelByEntry(entry, immediateCamera = false) {
    if (!entry) return null;
    const assetBase = typeof window !== 'undefined' ? (window.APP_CONFIG?.assetBase || '') : '';
    const url = this.glbEngine.resolveUrl(entry, assetBase);
    return this.loadGlbModel(url, entry, immediateCamera);
  }

  async loadFromBlob(objectUrl, filename) {
    try {
      const res = await this.loadGlbModel(objectUrl, { id: 'preview', file: filename }, false);
      return res;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async loadGlbModel(url, metaEntry = null, immediateCamera = false) {
    try {
      const result = await this.glbEngine.load(url, metaEntry);
      this.glbEngine.disposeGroup(this.customModelGroup);
      this.buildingInteractables = result.buildingInteractables;
      this.customModelGroup.add(result.root);
      this.customModelScene = result.root;
      this.hasCustomModel = true;

      this.activeCameraPreset = result.camera;
      this.activeGroundPlane = result.groundHitPlane;

      this.camera.far = result.camera.far || 550;
      this.camera.updateProjectionMatrix();
      this.scene.fog.density = result.camera.fogDensity ?? 0.0022;
      this.controls.minDistance = result.camera.minDistance ?? 12;
      this.controls.maxDistance = result.camera.maxDistance ?? 280;

      if (immediateCamera) {
        const [px, py, pz] = result.camera.position;
        const [tx, ty, tz] = result.camera.target;
        this.camera.position.set(px, py, pz);
        this.controls.target.set(tx, ty, tz);
      } else {
        this.resetCamera();
      }

      this.buildingsGroup.visible = false;
      this._buildCampusBase();
      if (this.data) {
        this._rebuildLabels();
      }
      this.needsRender = true;
      this.callbacks.onModelLoaded?.(result.telemetry);
      return result.telemetry;
    } catch (err) {
      console.warn('Aviso GLB:', err);
      if (!this.hasCustomModel) {
        this.buildingsGroup.visible = true;
      }
      this.callbacks.onToast?.(`No se pudo cargar modelo 3D: ${err.message}`, true);
      return null;
    }
  }

  getTelemetry() {
    return this.glbEngine.lastTelemetry;
  }

  _clearGroup(group) {
    this.glbEngine.disposeGroup(group);
  }
}
