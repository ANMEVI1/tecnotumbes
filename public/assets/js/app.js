import { Campus3D } from './campus3d.js';
import { initMotion } from './motion.js';
import { renderWifiQrSvg } from './qr.js';
import { mountAllTechTexts } from './tech-text.js';

const state = {
  campus: null,
  activeLabNum: 1,
  careerArea: 'all',
  wifiSearch: '',
  wifiFilter: 'all',
  tiTab: 'creds',
  tiVault: { authorized: false, persona: null, items: [] },
  tiRevealed: new Map(), // id -> plain password (solo en memoria mientras dure sesión)
  labRevealed: new Map(), // accountId -> plain password
  tiAuthorizedList: [],
  tiAuditList: [],
  tiCountdownTimer: null,
  draftWifi: null,
};

let scene3d = null;
let motion = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor' }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Error HTTP ${res.status}`);
  }
  return json.data;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast-pill');
  el.textContent = msg;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

async function copyText(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}: ${text}`);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
    toast(`${label}: ${text}`);
  }
}

function openModal(title, html, onReady) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-backdrop').classList.remove('is-hidden');
  onReady?.($('#modal-body'));
}

function closeModal() {
  $('#modal-backdrop').classList.add('is-hidden');
  $('#modal-body').innerHTML = '';
}

function showInspector(html) {
  const el = $('#stage-inspector');
  el.innerHTML = html;
  el.classList.remove('is-hidden');
}

function hideInspector() {
  $('#stage-inspector').classList.add('is-hidden');
}

async function loadAll(preserveSelection = true) {
  const [campus, tiVault] = await Promise.all([
    api('/api/campus'),
    api('/api/ti/credenciales'),
  ]);
  state.campus = campus;
  state.tiVault = tiVault;

  if (!tiVault.authorized) {
    state.tiRevealed.clear();
    state.labRevealed.clear();
  }

  renderMetrics();
  renderWifiList();
  renderLabs();
  renderCareers();
  renderTiSection();

  if (scene3d) {
    scene3d.setData(campus);
    if (!preserveSelection) scene3d.selectWifi(null, false);
  }
  motion?.refresh();
}

function renderMetrics() {
  const s = state.campus.stats;
  $('#hero-metrics').innerHTML = `
    <div class="metric-pill"><strong>${s.wifi_libres}</strong><span>WiFi Libres</span></div>
    <div class="metric-pill"><strong>${s.laboratorios_total}</strong><span>Laboratorios (${s.pcs_total} PCs)</span></div>
    <div class="metric-pill is-accent"><strong>${s.carreras_total}</strong><span>Carreras</span></div>
  `;
}

// =========================================================================
// 1. INSPECTOR 3D & SONDA DE SEÑAL
// =========================================================================
function handleSelect3D(kind, item) {
  if (kind === 'wifi') {
    showInspector(`
      <div class="inspector-head">
        <span class="inspector-tag ${item.estado === 'mantenimiento' ? 'is-red' : ''}">WiFi · ${esc(item.tipo_acceso)}</span>
        <button type="button" class="inspector-close" data-close-ins>×</button>
      </div>
      <h4 class="inspector-title">${esc(item.ssid)}</h4>
      <div class="inspector-meta">
        <div><strong>Clave:</strong> <code>${esc(item.contrasena || 'Sin clave')}</code></div>
        <div><strong>Ubicación:</strong> ${esc(item.pabellon_codigo || '')} · Piso ${item.piso}</div>
        <div><strong>Alcance:</strong> ${item.alcance_metros} m · ${esc(item.banda)} · ${item.velocidad_mbps} Mbps</div>
        <div>${esc(item.ubicacion_exacta)}</div>
      </div>
      <div class="inspector-actions">
        <button type="button" class="pill-btn is-active" data-ins-copy="${esc(item.contrasena)}">Copiar Clave</button>
        <button type="button" class="pill-btn is-outline" data-ins-qr="${item.id}">QR</button>
        <button type="button" class="pill-btn is-neon" data-ins-edit-wifi="${item.id}">Editar</button>
      </div>
    `);
  } else if (kind === 'lab') {
    state.activeLabNum = item.numero;
    renderLabs();
    showInspector(`
      <div class="inspector-head">
        <span class="inspector-tag">${esc(item.codigo)} · Piso ${item.piso}</span>
        <button type="button" class="inspector-close" data-close-ins>×</button>
      </div>
      <h4 class="inspector-title">${esc(item.nombre)}</h4>
      <div class="inspector-meta">
        <div><strong>Pabellón:</strong> ${esc(item.pabellon_nombre || '')}</div>
        <div><strong>Equipos:</strong> ${item.cantidad_pcs} PCs · ${esc(item.sistema_operativo)}</div>
        <div><strong>WiFi:</strong> ${esc(item.wifi_ssid || '—')}</div>
      </div>
      <div class="inspector-actions">
        <button type="button" class="pill-btn is-neon" data-goto-sec="sec-labs">Ver Cuentas del Lab</button>
      </div>
    `);
  } else if (kind === 'career') {
    showInspector(`
      <div class="inspector-head">
        <span class="inspector-tag">${esc(item.area)} · ${esc(item.numero_oficina)}</span>
        <button type="button" class="inspector-close" data-close-ins>×</button>
      </div>
      <h4 class="inspector-title">${esc(item.nombre_carrera)}</h4>
      <div class="inspector-meta">
        <div><strong>Coord.:</strong> ${esc(item.coordinador)}</div>
        <div><strong>Ubicación:</strong> ${esc(item.pabellon_nombre || '')} · Piso ${item.piso}</div>
        <div><strong>WiFi:</strong> ${esc(item.wifi_ssid || '—')} · ${esc(item.horario)}</div>
      </div>
      <div class="inspector-actions">
        <button type="button" class="pill-btn is-outline" data-goto-sec="sec-carreras">Ir a Oficinas</button>
      </div>
    `);
  } else if (kind === 'pabellon') {
    const wifis = (state.campus?.redes_wifi || []).filter((w) => w.pabellon_id === item.id);
    const wifiTags = wifis.length
      ? wifis.map((w) => `<span class="soft-chip">${esc(w.ssid)}</span>`).join(' ')
      : '<span class="row-sub">Sin APs propios asignados</span>';
    showInspector(`
      <div class="inspector-head">
        <span class="inspector-tag">${esc(item.codigo)} · ${item.pisos} piso(s)</span>
        <button type="button" class="inspector-close" data-close-ins>×</button>
      </div>
      <h4 class="inspector-title">${esc(item.nombre)}</h4>
      <div class="inspector-meta">
        <div>${esc(item.descripcion_corta)}</div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">${wifiTags}</div>
      </div>
      <div class="inspector-actions">
        <button type="button" class="pill-btn is-outline" data-goto-sec="sec-wifi">Ver WiFis</button>
      </div>
    `);
  }
}

function handleProbe3D(probe) {
  const listHtml = probe.matches.length
    ? probe.matches
        .map(
          (m) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:9999px;background:rgba(34,211,238,0.1);margin-top:8px;">
            <div>
              <strong style="color:#fff;font-size:0.88rem;">${esc(m.wifi.ssid)}</strong>
              <div style="font-size:0.75rem;color:var(--text-muted);">${m.pct}% · ${m.estDbm} dBm · a ${m.dist}m</div>
            </div>
            <button type="button" class="pill-btn is-active" style="padding:6px 12px;font-size:0.78rem;" data-ins-copy="${esc(m.wifi.contrasena)}">Clave</button>
          </div>`
        )
        .join('')
    : `<div style="margin-top:10px;color:#ff85a3;">Sin señal WiFi activa dentro del radio en este punto.</div>`;

  showInspector(`
    <div class="inspector-head">
      <span class="inspector-tag is-red">Sonda de Alcance (${probe.x}, ${probe.z})</span>
      <button type="button" class="inspector-close" data-close-ins>×</button>
    </div>
    <h4 class="inspector-title">${probe.matches.length} redes con cobertura</h4>
    <div class="inspector-meta">Haz clic en otro punto del campus 3D para medir.</div>
    ${listHtml}
  `);
}

// =========================================================================
// 2. WIFI & CONTRASEÑAS LIBRES
// =========================================================================
function renderWifiList() {
  const q = state.wifiSearch.trim().toLowerCase();
  const f = state.wifiFilter;

  const items = state.campus.redes_wifi.filter((w) => {
    if (f === 'libre' && w.tipo_acceso !== 'libre') return false;
    if (f === 'laboratorio' && w.tipo_acceso !== 'laboratorio') return false;
    if (f === 'mantenimiento' && w.estado !== 'mantenimiento') return false;
    if (!q) return true;
    return [w.ssid, w.pabellon_codigo, w.pabellon_nombre, w.ubicacion_exacta]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const list = $('#wifi-list');
  if (!items.length) {
    list.innerHTML = `<div class="flow-pill-row"><div class="row-title">No hay redes WiFi con ese filtro.</div></div>`;
    return;
  }

  list.innerHTML = items
    .map((w) => {
      const orbClass = w.estado === 'mantenimiento' ? 'is-red' : '';
      return `
      <div class="flow-pill-row ${w.estado === 'mantenimiento' ? 'is-maint' : ''}">
        <div class="row-main">
          <span class="signal-orb ${orbClass}"></span>
          <div>
            <div class="row-title">${esc(w.ssid)}</div>
            <div class="row-sub">${esc(w.pabellon_codigo || 'Campus')} · Piso ${w.piso} · ${esc(w.ubicacion_exacta)}</div>
          </div>
        </div>
        <div class="row-chips">
          <span class="soft-chip">${w.alcance_metros} m</span>
          <span class="soft-chip">${esc(w.banda)}</span>
          <span class="soft-chip is-pass">${esc(w.contrasena || 'Abierta')}</span>
        </div>
        <div class="row-actions">
          <button type="button" class="pill-btn is-active" data-wifi-copy="${w.id}">Copiar</button>
          <button type="button" class="pill-btn is-outline" data-wifi-qr="${w.id}">QR</button>
          <button type="button" class="pill-btn is-outline" data-wifi-fly="${w.id}">Ver 3D</button>
          <button type="button" class="pill-btn is-outline" data-wifi-edit="${w.id}">Editar</button>
          <button type="button" class="pill-btn is-outline" data-wifi-del="${w.id}">Eliminar</button>
        </div>
      </div>`;
    })
    .join('');
}

function openWifiQrModal(wifi) {
  const svg = renderWifiQrSvg(wifi.ssid, wifi.contrasena);
  openModal(`Conectar a ${wifi.ssid}`, `
    <div class="qr-stage">
      <div class="qr-svg-wrap">${svg}</div>
      <div class="soft-chip is-pass">Clave: ${esc(wifi.contrasena || 'Sin contraseña')}</div>
      <button type="button" class="pill-btn is-active" id="btn-qr-copy">Copiar Contraseña</button>
    </div>
  `, (root) => {
    $('#btn-qr-copy', root).addEventListener('click', () => copyText(wifi.contrasena || '', 'Clave WiFi'));
  });
}

function openWifiFormModal(wifi = null, presetCoords = null) {
  const w = wifi || state.draftWifi || {
    ssid: '',
    contrasena: '',
    tipo_acceso: 'libre',
    banda: '2.4 / 5 GHz',
    estado: 'activa',
    pabellon_id: state.campus.pabellones[0]?.id || '',
    piso: 1,
    ubicacion_exacta: '',
    pos_x: 0,
    pos_y: 3.2,
    pos_z: 0,
    alcance_metros: 26,
    potencia_dbm: -45,
    velocidad_mbps: 300,
    color_senal: '#22D3EE',
    notas: '',
  };
  if (presetCoords) {
    w.pos_x = presetCoords.x;
    w.pos_z = presetCoords.z;
  }

  const pabOpts = state.campus.pabellones
    .map((p) => `<option value="${p.id}" ${Number(w.pabellon_id) === p.id ? 'selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`)
    .join('');

  openModal(w.id ? `Editar WiFi · ${w.ssid}` : 'Nueva Red WiFi', `
    <form id="form-wifi" class="form-flow">
      <div class="form-row-2">
        <div class="field-group">
          <label>SSID (Nombre de red)</label>
          <input class="pill-input" name="ssid" required value="${esc(w.ssid)}">
        </div>
        <div class="field-group">
          <label>Contraseña Libre</label>
          <input class="pill-input" name="contrasena" value="${esc(w.contrasena)}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Tipo de Acceso</label>
          <select class="pill-select" name="tipo_acceso">
            <option value="libre" ${w.tipo_acceso === 'libre' ? 'selected' : ''}>Libre</option>
            <option value="laboratorio" ${w.tipo_acceso === 'laboratorio' ? 'selected' : ''}>Laboratorio</option>
            <option value="institucional" ${w.tipo_acceso === 'institucional' ? 'selected' : ''}>Institucional</option>
          </select>
        </div>
        <div class="field-group">
          <label>Estado</label>
          <select class="pill-select" name="estado">
            <option value="activa" ${w.estado === 'activa' ? 'selected' : ''}>Activa</option>
            <option value="mantenimiento" ${w.estado === 'mantenimiento' ? 'selected' : ''}>Mantenimiento</option>
            <option value="inactiva" ${w.estado === 'inactiva' ? 'selected' : ''}>Inactiva</option>
          </select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Pabellón</label>
          <select class="pill-select" name="pabellon_id">${pabOpts}</select>
        </div>
        <div class="field-group">
          <label>Piso</label>
          <input class="pill-input" type="number" min="1" max="4" name="piso" value="${w.piso}">
        </div>
      </div>
      <div class="field-group">
        <label>Ubicación exacta</label>
        <input class="pill-input" name="ubicacion_exacta" value="${esc(w.ubicacion_exacta)}">
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Alcance (metros reales)</label>
          <input class="pill-input" type="number" min="5" max="80" step="1" name="alcance_metros" value="${w.alcance_metros}">
        </div>
        <div class="field-group">
          <label>Banda</label>
          <input class="pill-input" name="banda" value="${esc(w.banda)}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Coordenada X (3D)</label>
          <input class="pill-input" type="number" step="0.1" name="pos_x" value="${w.pos_x}">
        </div>
        <div class="field-group">
          <label>Coordenada Z (3D)</label>
          <input class="pill-input" type="number" step="0.1" name="pos_z" value="${w.pos_z}">
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:8px;">
        <button type="button" id="btn-pick-wifi-3d" class="pill-btn is-outline">Elegir punto en Mapa 3D</button>
        <button type="submit" class="pill-btn is-neon">Guardar Red WiFi</button>
      </div>
    </form>
  `, (root) => {
    const form = $('#form-wifi', root);
    const readForm = () => {
      const fd = new FormData(form);
      const piso = Number(fd.get('piso')) || 1;
      return {
        id: w.id || null,
        ssid: fd.get('ssid'),
        contrasena: fd.get('contrasena'),
        tipo_acceso: fd.get('tipo_acceso'),
        estado: fd.get('estado'),
        pabellon_id: Number(fd.get('pabellon_id')) || null,
        piso,
        ubicacion_exacta: fd.get('ubicacion_exacta'),
        alcance_metros: Number(fd.get('alcance_metros')) || 25,
        banda: fd.get('banda'),
        pos_x: Number(fd.get('pos_x')) || 0,
        pos_y: piso === 1 ? 3.2 : piso === 2 ? 6.8 : 10.2,
        pos_z: Number(fd.get('pos_z')) || 0,
      };
    };

    $('#btn-pick-wifi-3d', root).addEventListener('click', () => {
      const draft = readForm();
      state.draftWifi = draft;
      closeModal();
      $('#pick-banner').classList.remove('is-hidden');
      $('#sec-mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
      scene3d.startPickPosition(draft.alcance_metros, (coords) => {
        $('#pick-banner').classList.add('is-hidden');
        openWifiFormModal(draft, coords);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = readForm();
      try {
        if (w.id) {
          await api(`/api/wifi/${w.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Red WiFi actualizada');
        } else {
          await api('/api/wifi', { method: 'POST', body: JSON.stringify(payload) });
          toast('Nueva red WiFi agregada');
        }
        state.draftWifi = null;
        closeModal();
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// =========================================================================
// 3. 6 LABORATORIOS DE CÓMPUTO & CUENTAS
// =========================================================================
function getActiveLab() {
  return state.campus.laboratorios.find((l) => l.numero === state.activeLabNum) || state.campus.laboratorios[0];
}

function renderLabs() {
  const labs = state.campus.laboratorios;
  const active = getActiveLab();

  $('#lab-selector').innerHTML = labs
    .map((l) => {
      const orb = l.estado === 'mantenimiento' ? 'is-red' : (l.estado === 'ocupado' ? 'is-amber' : '');
      return `
      <button type="button" class="lab-pill ${l.numero === active?.numero ? 'is-active' : ''}" data-lab-num="${l.numero}">
        <span class="signal-orb ${orb}"></span>
        <span>${esc(l.codigo)}</span>
        <span class="soft-chip">${l.cantidad_pcs} PCs</span>
      </button>`;
    })
    .join('');

  if (!active) return;

  const accountsHtml = (active.cuentas || []).length
    ? active.cuentas
        .map((c) => {
          const revealed = state.labRevealed.get(c.id);
          const passDisplay = c.es_sensible ? (revealed || '••••••••••••') : (c.contrasena || 'Sin clave');
          const lockAction = c.es_sensible && !revealed
            ? `<button type="button" class="pill-btn is-neon" data-acc-reveal="${c.id}">Revelar TI</button>`
            : `<button type="button" class="pill-btn is-active" data-acc-copy="${c.id}">Copiar Clave</button>`;

          return `
          <div class="flow-pill-row ${c.es_sensible ? 'is-maint' : ''}">
            <div class="row-main">
              <span class="signal-orb ${c.es_sensible ? 'is-red' : ''}"></span>
              <div>
                <div class="row-title">${esc(c.usuario)}</div>
                <div class="row-sub">${esc(c.rol_cuenta)} · ${esc(c.equipo_rango)} · ${esc(c.notas)}</div>
              </div>
            </div>
            <div class="row-chips">
              <span class="soft-chip ${c.es_sensible ? 'is-red' : ''}">${esc(c.rol_cuenta)}</span>
              <span class="soft-chip is-pass">${esc(passDisplay)}</span>
            </div>
            <div class="row-actions">
              ${lockAction}
              <button type="button" class="pill-btn is-outline" data-acc-edit="${c.id}">Editar</button>
              <button type="button" class="pill-btn is-outline" data-acc-del="${c.id}">Eliminar</button>
            </div>
          </div>`;
        })
        .join('')
    : `<div class="flow-pill-row"><div class="row-title">Sin cuentas registradas en este laboratorio.</div></div>`;

  $('#lab-stage').innerHTML = `
    <div class="lab-stage-top">
      <div>
        <div class="row-title" style="font-size:1.25rem;color:var(--celeste);">${esc(active.nombre)}</div>
        <div class="row-sub">
          ${esc(active.pabellon_nombre || '')} · Piso ${active.piso} · ${esc(active.sistema_operativo)} · Encargado: ${esc(active.encargado)}
        </div>
      </div>
      <div class="row-actions">
        <span class="soft-chip">WiFi: ${esc(active.wifi_ssid || '—')}</span>
        <button type="button" class="pill-btn is-outline" id="btn-lab-fly">Ver en 3D</button>
      </div>
    </div>
    <div class="flow-list">${accountsHtml}</div>
  `;

  $('#btn-lab-fly')?.addEventListener('click', () => {
    $('#sec-mapa').scrollIntoView({ behavior: 'smooth' });
    scene3d.flyTo(active.pos_x, active.pos_y, active.pos_z, 25);
    handleSelect3D('lab', active);
  });
}

function openLabEditModal(lab) {
  const pabOpts = state.campus.pabellones
    .map((p) => `<option value="${p.id}" ${lab.pabellon_id === p.id ? 'selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`)
    .join('');
  const wifiOpts = state.campus.redes_wifi
    .map((w) => `<option value="${w.id}" ${lab.red_wifi_id === w.id ? 'selected' : ''}>${esc(w.ssid)}</option>`)
    .join('');

  openModal(`Editar ${lab.codigo}`, `
    <form id="form-lab" class="form-flow">
      <div class="field-group">
        <label>Nombre</label>
        <input class="pill-input" name="nombre" required value="${esc(lab.nombre)}">
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Pabellón</label>
          <select class="pill-select" name="pabellon_id">${pabOpts}</select>
        </div>
        <div class="field-group">
          <label>Piso</label>
          <input class="pill-input" type="number" min="1" max="4" name="piso" value="${lab.piso}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Cantidad PCs</label>
          <input class="pill-input" type="number" min="1" max="120" name="cantidad_pcs" value="${lab.cantidad_pcs}">
        </div>
        <div class="field-group">
          <label>Estado</label>
          <select class="pill-select" name="estado">
            <option value="operativo" ${lab.estado === 'operativo' ? 'selected' : ''}>Operativo</option>
            <option value="ocupado" ${lab.estado === 'ocupado' ? 'selected' : ''}>Ocupado</option>
            <option value="mantenimiento" ${lab.estado === 'mantenimiento' ? 'selected' : ''}>Mantenimiento</option>
          </select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>WiFi asignado</label>
          <select class="pill-select" name="red_wifi_id"><option value="">Sin asignar</option>${wifiOpts}</select>
        </div>
        <div class="field-group">
          <label>Encargado</label>
          <input class="pill-input" name="encargado" value="${esc(lab.encargado)}">
        </div>
      </div>
      <div class="field-group">
        <label>Sistema Operativo</label>
        <input class="pill-input" name="sistema_operativo" value="${esc(lab.sistema_operativo)}">
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="submit" class="pill-btn is-neon">Guardar Cambios</button>
      </div>
    </form>
  `, (root) => {
    $('#form-lab', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/api/labs/${lab.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: fd.get('nombre'),
            pabellon_id: Number(fd.get('pabellon_id')) || null,
            piso: Number(fd.get('piso')) || 1,
            cantidad_pcs: Number(fd.get('cantidad_pcs')) || 24,
            estado: fd.get('estado'),
            red_wifi_id: fd.get('red_wifi_id') ? Number(fd.get('red_wifi_id')) : null,
            encargado: fd.get('encargado'),
            sistema_operativo: fd.get('sistema_operativo'),
          }),
        });
        closeModal();
        toast('Laboratorio actualizado');
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function openAccountModal(lab, acc = null) {
  openModal(acc ? `Editar Cuenta · ${acc.usuario}` : `Nueva Cuenta en ${lab.codigo}`, `
    <form id="form-acc" class="form-flow">
      <div class="form-row-2">
        <div class="field-group">
          <label>Usuario</label>
          <input class="pill-input" name="usuario" required value="${esc(acc?.usuario || '')}">
        </div>
        <div class="field-group">
          <label>Contraseña ${acc?.es_sensible ? '(vacío = mantener)' : ''}</label>
          <input class="pill-input" name="contrasena" value="${acc && !acc.es_sensible ? esc(acc.contrasena) : ''}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Rol</label>
          <select class="pill-select" name="rol_cuenta">
            <option value="estudiante" ${acc?.rol_cuenta === 'estudiante' ? 'selected' : ''}>Estudiante (libre)</option>
            <option value="docente" ${acc?.rol_cuenta === 'docente' ? 'selected' : ''}>Docente</option>
            <option value="invitado" ${acc?.rol_cuenta === 'invitado' ? 'selected' : ''}>Invitado</option>
            <option value="admin_local" ${acc?.rol_cuenta === 'admin_local' ? 'selected' : ''}>Admin Local (Protegida TI)</option>
          </select>
        </div>
        <div class="field-group">
          <label>Rango de PCs</label>
          <input class="pill-input" name="equipo_rango" value="${esc(acc?.equipo_rango || `PC-01 a PC-${lab.cantidad_pcs}`)}">
        </div>
      </div>
      <div class="field-group">
        <label>Notas</label>
        <input class="pill-input" name="notas" value="${esc(acc?.notas || '')}">
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="submit" class="pill-btn is-neon">Guardar Cuenta</button>
      </div>
    </form>
  `, (root) => {
    $('#form-acc', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        usuario: fd.get('usuario'),
        contrasena: fd.get('contrasena'),
        rol_cuenta: fd.get('rol_cuenta'),
        equipo_rango: fd.get('equipo_rango'),
        notas: fd.get('notas'),
      };
      try {
        if (acc) {
          await api(`/api/cuentas/${acc.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Cuenta actualizada');
        } else {
          await api(`/api/labs/${lab.id}/cuentas`, { method: 'POST', body: JSON.stringify(payload) });
          toast('Cuenta agregada al laboratorio');
        }
        closeModal();
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// =========================================================================
// 4. OFICINAS DE CARRERAS (10)
// =========================================================================
function renderCareers() {
  const area = state.careerArea;
  const items = state.campus.oficinas_carreras.filter((c) => area === 'all' || c.area === area);

  $('#careers-flow').innerHTML = items
    .map((c) => `
      <div class="career-bubble">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <span class="soft-chip ${c.area === 'Tecnología' ? 'is-red' : ''}">${esc(c.codigo)} · ${esc(c.area)}</span>
            <span class="soft-chip">${esc(c.numero_oficina)} · P${c.piso}</span>
          </div>
          <div class="row-title">${esc(c.nombre_carrera)}</div>
          <div class="row-sub" style="margin-top:6px;">${esc(c.coordinador)} · ${esc(c.pabellon_codigo || '')}</div>
          <div class="row-sub">WiFi: ${esc(c.wifi_ssid || '—')} · ${esc(c.horario)}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="pill-btn is-outline" data-career-fly="${c.id}">Ver 3D</button>
          <button type="button" class="pill-btn is-outline" data-career-edit="${c.id}">Editar</button>
          <button type="button" class="pill-btn is-outline" data-career-del="${c.id}">Eliminar</button>
        </div>
      </div>
    `)
    .join('');
}

function openCareerModal(career = null) {
  const pabOpts = state.campus.pabellones
    .map((p) => `<option value="${p.id}" ${career?.pabellon_id === p.id ? 'selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`)
    .join('');
  const wifiOpts = state.campus.redes_wifi
    .map((w) => `<option value="${w.id}" ${career?.red_wifi_id === w.id ? 'selected' : ''}>${esc(w.ssid)}</option>`)
    .join('');

  openModal(career ? `Editar ${career.codigo}` : 'Nueva Oficina de Carrera', `
    <form id="form-career" class="form-flow">
      <div class="form-row-2">
        <div class="field-group">
          <label>Código</label>
          <input class="pill-input" name="codigo" required value="${esc(career?.codigo || '')}">
        </div>
        <div class="field-group">
          <label>Área</label>
          <select class="pill-select" name="area">
            <option value="Tecnología" ${career?.area === 'Tecnología' ? 'selected' : ''}>Tecnología</option>
            <option value="Salud" ${career?.area === 'Salud' ? 'selected' : ''}>Salud</option>
            <option value="Gestión" ${career?.area === 'Gestión' ? 'selected' : ''}>Gestión</option>
          </select>
        </div>
      </div>
      <div class="field-group">
        <label>Nombre de Carrera</label>
        <input class="pill-input" name="nombre_carrera" required value="${esc(career?.nombre_carrera || '')}">
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Coordinador</label>
          <input class="pill-input" name="coordinador" value="${esc(career?.coordinador || '')}">
        </div>
        <div class="field-group">
          <label>N° Oficina</label>
          <input class="pill-input" name="numero_oficina" value="${esc(career?.numero_oficina || '')}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Pabellón</label>
          <select class="pill-select" name="pabellon_id">${pabOpts}</select>
        </div>
        <div class="field-group">
          <label>Piso</label>
          <input class="pill-input" type="number" min="1" max="4" name="piso" value="${career?.piso || 1}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>WiFi asignado</label>
          <select class="pill-select" name="red_wifi_id"><option value="">Sin asignar</option>${wifiOpts}</select>
        </div>
        <div class="field-group">
          <label>Horario</label>
          <input class="pill-input" name="horario" value="${esc(career?.horario || 'Lun-Vie 08:00 - 16:30')}">
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="submit" class="pill-btn is-neon">Guardar Oficina</button>
      </div>
    </form>
  `, (root) => {
    $('#form-career', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const pabId = Number(fd.get('pabellon_id')) || null;
      const pab = state.campus.pabellones.find((p) => p.id === pabId);
      const piso = Number(fd.get('piso')) || 1;
      const payload = {
        codigo: fd.get('codigo'),
        area: fd.get('area'),
        nombre_carrera: fd.get('nombre_carrera'),
        coordinador: fd.get('coordinador'),
        numero_oficina: fd.get('numero_oficina'),
        pabellon_id: pabId,
        piso,
        red_wifi_id: fd.get('red_wifi_id') ? Number(fd.get('red_wifi_id')) : null,
        horario: fd.get('horario'),
        pos_x: career ? career.pos_x : (pab ? pab.pos_x : 0),
        pos_y: piso === 1 ? 1.8 : piso === 2 ? 5.4 : 9.0,
        pos_z: career ? career.pos_z : (pab ? pab.pos_z : 0),
      };
      try {
        if (career) {
          await api(`/api/carreras/${career.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Oficina actualizada');
        } else {
          await api('/api/carreras', { method: 'POST', body: JSON.stringify(payload) });
          toast('Oficina creada');
        }
        closeModal();
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// =========================================================================
// 5. BÓVEDA TI AUTORIZADA (SIN LOGIN GENERAL — VALIDACIÓN EN BD)
// =========================================================================
function renderTiSection() {
  const { authorized, persona, items } = state.tiVault;
  const bar = $('#ti-auth-bar');
  const btnNewCred = $('#btn-ti-new-cred');
  const btnLock = $('#btn-ti-lock');
  const tabs = $('#ti-tabs');
  const btnTabAuths = $('#btn-tab-auths');

  btnNewCred.hidden = !(authorized && (persona?.rol_ti === 'superadmin_ti' || persona?.rol_ti === 'soporte_ti'));
  btnLock.hidden = !authorized;
  tabs.hidden = !authorized;
  btnTabAuths.hidden = !(authorized && persona?.rol_ti === 'superadmin_ti');

  if (!authorized) {
    bar.innerHTML = `
      <span class="soft-chip is-red">Bloqueada · AES-256-GCM</span>
      <input id="ti-dni" class="pill-input" maxlength="8" pattern="\\d{8}" placeholder="DNI autorizado (8 dígitos)" required style="flex:1 1 180px;">
      <input id="ti-pin" class="pill-input" type="password" placeholder="PIN personal TI" required style="flex:1 1 180px;">
      <button type="submit" class="pill-btn is-neon">Validar Autorización</button>
    `;
  } else {
    const mins = Math.ceil((persona.remaining_sec || 0) / 60);
    bar.innerHTML = `
      <span class="signal-orb"></span>
      <div style="flex:1 1 260px;">
        <div class="row-title">${esc(persona.nombre_completo)} · <span style="color:var(--celeste);">${esc(persona.rol_ti)}</span></div>
        <div class="row-sub">${esc(persona.cargo)} · Sesión activa (${mins} min)</div>
      </div>
      <span class="soft-chip">Descifrado autorizado</span>
    `;
  }

  if (!authorized || state.tiTab === 'creds') {
    $('#ti-content').innerHTML = (items || [])
      .map((c) => {
        const revealed = state.tiRevealed.get(c.id);
        const passText = revealed ? revealed.clave : c.clave_mascara;
        const actionBtn = !authorized
          ? `<span class="soft-chip is-red">Requiere PIN TI</span>`
          : !c.puede_revelar
            ? `<span class="soft-chip is-red">Solo ${esc(c.nivel_acceso)}</span>`
            : revealed
              ? `<button type="button" class="pill-btn is-active" data-ti-copy="${c.id}">Copiar</button>`
              : `<button type="button" class="pill-btn is-neon" data-ti-reveal="${c.id}">Revelar</button>`;

        const adminBtns = authorized && c.puede_revelar && (persona.rol_ti === 'superadmin_ti' || persona.rol_ti === 'soporte_ti')
          ? `<button type="button" class="pill-btn is-outline" data-ti-edit="${c.id}">Editar</button>
             <button type="button" class="pill-btn is-outline" data-ti-del="${c.id}">Eliminar</button>`
          : '';

        return `
        <div class="flow-pill-row ${!authorized ? 'is-maint' : ''}">
          <div class="row-main">
            <span class="signal-orb ${!authorized ? 'is-red' : ''}"></span>
            <div>
              <div class="row-title">${esc(c.titulo)}</div>
              <div class="row-sub">${esc(c.equipo_objetivo)} · ${esc(c.ip_o_host)} · ${esc(c.pabellon_codigo || 'Campus')}</div>
            </div>
          </div>
          <div class="row-chips">
            <span class="soft-chip">${esc(c.usuario_ti)}</span>
            <span class="soft-chip is-pass">${esc(passText)}</span>
          </div>
          <div class="row-actions">
            ${actionBtn}
            ${adminBtns}
          </div>
        </div>`;
      })
      .join('');
  } else if (state.tiTab === 'auths') {
    const rows = state.tiAuthorizedList
      .map((p) => `
      <div class="flow-pill-row ${!p.activo ? 'is-maint' : ''}">
        <div class="row-main">
          <span class="signal-orb ${!p.activo ? 'is-red' : ''}"></span>
          <div>
            <div class="row-title">${esc(p.nombre_completo)} (${esc(p.dni)})</div>
            <div class="row-sub">${esc(p.cargo)} · ${esc(p.rol_ti)} · Último acceso: ${esc(p.ultimo_acceso || 'Nunca')}</div>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="pill-btn ${p.activo ? 'is-outline' : 'is-active'}" data-auth-toggle="${p.id}">
            ${p.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>`)
      .join('');
    $('#ti-content').innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button type="button" class="pill-btn is-neon" id="btn-new-authorized">+ Autorizar Persona</button>
      </div>
      ${rows}
    `;
  } else if (state.tiTab === 'audit') {
    $('#ti-content').innerHTML = state.tiAuditList
      .map((a) => `
      <div class="flow-pill-row">
        <div class="row-main">
          <span class="signal-orb"></span>
          <div>
            <div class="row-title">${esc(a.accion)} · ${esc(a.persona_nombre || 'Sistema')}</div>
            <div class="row-sub">${esc(a.detalle)}</div>
          </div>
        </div>
        <div class="row-chips">
          <span class="soft-chip">${esc(a.created_at)}</span>
        </div>
      </div>`)
      .join('');
  }
}

function openTiCredentialModal(cred = null) {
  const pabOpts = state.campus.pabellones
    .map((p) => `<option value="${p.id}" ${cred?.pabellon_id === p.id ? 'selected' : ''}>${esc(p.codigo)}</option>`)
    .join('');

  openModal(cred ? `Editar ${cred.titulo}` : 'Nueva Credencial TI (AES-256-GCM)', `
    <form id="form-ti-cred" class="form-flow">
      <div class="field-group">
        <label>Título</label>
        <input class="pill-input" name="titulo" required value="${esc(cred?.titulo || '')}">
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Equipo / Servicio</label>
          <input class="pill-input" name="equipo_objetivo" required value="${esc(cred?.equipo_objetivo || '')}">
        </div>
        <div class="field-group">
          <label>IP / Host</label>
          <input class="pill-input" name="ip_o_host" value="${esc(cred?.ip_o_host || '')}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Usuario TI</label>
          <input class="pill-input" name="usuario_ti" required value="${esc(cred?.usuario_ti || '')}">
        </div>
        <div class="field-group">
          <label>Contraseña ${cred ? '(vacío = mantener)' : ''}</label>
          <input class="pill-input" name="clave" type="password" ${cred ? '' : 'required'}>
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Categoría</label>
          <select class="pill-select" name="categoria">
            <option value="router_ap" ${cred?.categoria === 'router_ap' ? 'selected' : ''}>Router / AP</option>
            <option value="switch_red" ${cred?.categoria === 'switch_red' ? 'selected' : ''}>Switch Red</option>
            <option value="servidor" ${cred?.categoria === 'servidor' ? 'selected' : ''}>Servidor</option>
            <option value="admin_lab" ${cred?.categoria === 'admin_lab' ? 'selected' : ''}>Admin Lab</option>
            <option value="firewall" ${cred?.categoria === 'firewall' ? 'selected' : ''}>Firewall</option>
            <option value="otro" ${cred?.categoria === 'otro' ? 'selected' : ''}>Otro</option>
          </select>
        </div>
        <div class="field-group">
          <label>Nivel mínimo</label>
          <select class="pill-select" name="nivel_acceso">
            <option value="soporte_ti" ${cred?.nivel_acceso === 'soporte_ti' ? 'selected' : ''}>soporte_ti</option>
            <option value="superadmin_ti" ${cred?.nivel_acceso === 'superadmin_ti' ? 'selected' : ''}>superadmin_ti</option>
          </select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Pabellón</label>
          <select class="pill-select" name="pabellon_id"><option value="">Campus</option>${pabOpts}</select>
        </div>
        <div class="field-group">
          <label>Notas</label>
          <input class="pill-input" name="notas" value="${esc(cred?.notas || '')}">
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="submit" class="pill-btn is-neon">Cifrar y Guardar</button>
      </div>
    </form>
  `, (root) => {
    $('#form-ti-cred', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        titulo: fd.get('titulo'),
        equipo_objetivo: fd.get('equipo_objetivo'),
        ip_o_host: fd.get('ip_o_host'),
        usuario_ti: fd.get('usuario_ti'),
        clave: fd.get('clave'),
        categoria: fd.get('categoria'),
        nivel_acceso: fd.get('nivel_acceso'),
        pabellon_id: fd.get('pabellon_id') ? Number(fd.get('pabellon_id')) : null,
        notas: fd.get('notas'),
      };
      try {
        if (cred) {
          await api(`/api/ti/credenciales/${cred.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          state.tiRevealed.delete(cred.id);
          toast('Credencial TI actualizada');
        } else {
          await api('/api/ti/credenciales', { method: 'POST', body: JSON.stringify(payload) });
          toast('Credencial cifrada y guardada');
        }
        closeModal();
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function openNewAuthorizedModal() {
  openModal('Autorizar Personal TI', `
    <form id="form-new-auth" class="form-flow">
      <div class="form-row-2">
        <div class="field-group">
          <label>DNI (8 dígitos)</label>
          <input class="pill-input" name="dni" maxlength="8" required pattern="\\d{8}">
        </div>
        <div class="field-group">
          <label>Rol TI</label>
          <select class="pill-select" name="rol_ti">
            <option value="soporte_ti">soporte_ti</option>
            <option value="coordinador_lab">coordinador_lab</option>
            <option value="superadmin_ti">superadmin_ti</option>
          </select>
        </div>
      </div>
      <div class="field-group">
        <label>Nombre completo</label>
        <input class="pill-input" name="nombre_completo" required>
      </div>
      <div class="form-row-2">
        <div class="field-group">
          <label>Cargo</label>
          <input class="pill-input" name="cargo" required>
        </div>
        <div class="field-group">
          <label>PIN personal (mín. 6 chars)</label>
          <input class="pill-input" name="pin" type="password" minlength="6" required>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="submit" class="pill-btn is-neon">Registrar Autorización</button>
      </div>
    </form>
  `, (root) => {
    $('#form-new-auth', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/ti/autorizados', {
          method: 'POST',
          body: JSON.stringify({
            dni: fd.get('dni'),
            nombre_completo: fd.get('nombre_completo'),
            cargo: fd.get('cargo'),
            rol_ti: fd.get('rol_ti'),
            pin: fd.get('pin'),
          }),
        });
        closeModal();
        toast('Persona autorizada registrada con Argon2id');
        state.tiAuthorizedList = await api('/api/ti/autorizados');
        renderTiSection();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// =========================================================================
// INICIALIZACIÓN & EVENTOS DELEGADOS
// =========================================================================
function bindEvents() {
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Dock 3D
  $$('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-mode]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      scene3d.setMode(btn.dataset.mode);
    });
  });

  $$('[data-floor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-floor]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      scene3d.applyFloorFilter(btn.dataset.floor);
    });
  });

  $('#btn-toggle-coverage').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('is-active');
    e.currentTarget.classList.toggle('is-active', next);
    scene3d.setCoverageVisible(next);
  });

  $('#btn-toggle-labels').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('is-active');
    e.currentTarget.classList.toggle('is-active', next);
    scene3d.setLabelsVisible(next);
  });

  $('#btn-probe-mode').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('is-neon');
    e.currentTarget.classList.toggle('is-neon', next);
    e.currentTarget.classList.toggle('is-outline', !next);
    scene3d.setProbeMode(next);
    if (next) toast('Haz clic en cualquier lugar del campus 3D para medir señal');
  });

  $('#btn-reset-cam').addEventListener('click', () => {
    scene3d.resetCamera();
    scene3d.selectWifi(null, false);
    hideInspector();
  });

  $('#btn-pause-3d')?.addEventListener('click', (e) => {
    if (!scene3d) return;
    const nextPaused = !scene3d.isPaused;
    scene3d.setPaused(nextPaused);
    e.currentTarget.textContent = nextPaused ? 'Reanudar 3D' : 'Pausar 3D';
    e.currentTarget.classList.toggle('is-active', nextPaused);
    e.currentTarget.classList.toggle('is-outline', !nextPaused);
  });

  $('#btn-model-info')?.addEventListener('click', () => openModelManagerModal());

  $('#btn-cancel-pick').addEventListener('click', () => {
    $('#pick-banner').classList.add('is-hidden');
    scene3d.cancelPickPosition();
    if (state.draftWifi) openWifiFormModal(state.draftWifi);
  });

  // Inspector 3D clicks
  $('#stage-inspector').addEventListener('click', (e) => {
    if (e.target.closest('[data-close-ins]')) {
      hideInspector();
      return;
    }
    const copyBtn = e.target.closest('[data-ins-copy]');
    if (copyBtn) {
      copyText(copyBtn.dataset.insCopy, 'Clave WiFi');
      return;
    }
    const qrBtn = e.target.closest('[data-ins-qr]');
    if (qrBtn) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(qrBtn.dataset.insQr));
      if (w) openWifiQrModal(w);
      return;
    }
    const editBtn = e.target.closest('[data-ins-edit-wifi]');
    if (editBtn) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(editBtn.dataset.insEditWifi));
      if (w) openWifiFormModal(w);
      return;
    }
    const gotoBtn = e.target.closest('[data-goto-sec]');
    if (gotoBtn) {
      motion.scrollToSection(gotoBtn.dataset.gotoSec);
    }
  });

  // WiFi lista y filtros
  $('#wifi-search').addEventListener('input', (e) => {
    state.wifiSearch = e.target.value;
    renderWifiList();
  });
  $('#wifi-filter').addEventListener('change', (e) => {
    state.wifiFilter = e.target.value;
    renderWifiList();
  });
  $('#btn-new-wifi').addEventListener('click', () => openWifiFormModal(null));

  $('#wifi-list').addEventListener('click', async (e) => {
    const idAttr = (sel) => e.target.closest(sel)?.getAttribute(sel.slice(1, -1));
    let id;
    if ((id = idAttr('[data-wifi-copy]'))) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(id));
      if (w) copyText(w.contrasena || '', 'Clave WiFi');
    } else if ((id = idAttr('[data-wifi-qr]'))) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(id));
      if (w) openWifiQrModal(w);
    } else if ((id = idAttr('[data-wifi-fly]'))) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(id));
      if (w) {
        motion.scrollToSection('sec-mapa');
        scene3d.selectWifi(w.id, true);
        handleSelect3D('wifi', w);
      }
    } else if ((id = idAttr('[data-wifi-edit]'))) {
      const w = state.campus.redes_wifi.find((x) => x.id === Number(id));
      if (w) openWifiFormModal(w);
    } else if ((id = idAttr('[data-wifi-del]'))) {
      try {
        await api(`/api/wifi/${Number(id)}`, { method: 'DELETE' });
        toast('Red WiFi eliminada');
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // Labs
  $('#lab-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lab-num]');
    if (!btn) return;
    state.activeLabNum = Number(btn.dataset.labNum);
    renderLabs();
  });

  $('#btn-edit-lab').addEventListener('click', () => {
    const lab = getActiveLab();
    if (lab) openLabEditModal(lab);
  });

  $('#btn-new-account').addEventListener('click', () => {
    const lab = getActiveLab();
    if (lab) openAccountModal(lab, null);
  });

  $('#lab-stage').addEventListener('click', async (e) => {
    const lab = getActiveLab();
    if (!lab) return;
    const findAcc = (id) => lab.cuentas.find((c) => c.id === Number(id));

    const copyBtn = e.target.closest('[data-acc-copy]');
    if (copyBtn) {
      const acc = findAcc(copyBtn.dataset.accCopy);
      const val = acc?.es_sensible ? state.labRevealed.get(acc.id) : acc?.contrasena;
      if (val) copyText(val, `Clave ${acc.usuario}`);
      return;
    }

    const revBtn = e.target.closest('[data-acc-reveal]');
    if (revBtn) {
      try {
        const res = await api(`/api/cuentas/${Number(revBtn.dataset.accReveal)}/revelar`, { method: 'POST' });
        state.labRevealed.set(res.id, res.contrasena);
        renderLabs();
        toast('Cuenta administrativa revelada');
      } catch (err) {
        toast(`${err.message} (Valida tu PIN abajo en Bóveda TI)`, true);
        motion.scrollToSection('sec-ti');
      }
      return;
    }

    const editBtn = e.target.closest('[data-acc-edit]');
    if (editBtn) {
      const acc = findAcc(editBtn.dataset.accEdit);
      if (acc) openAccountModal(lab, acc);
      return;
    }

    const delBtn = e.target.closest('[data-acc-del]');
    if (delBtn) {
      try {
        await api(`/api/cuentas/${Number(delBtn.dataset.accDel)}`, { method: 'DELETE' });
        toast('Cuenta eliminada');
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // Carreras
  $('#career-area-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-area]');
    if (!btn) return;
    $$('#career-area-filters [data-area]').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.careerArea = btn.dataset.area;
    renderCareers();
  });

  $('#btn-new-career').addEventListener('click', () => openCareerModal(null));

  $('#careers-flow').addEventListener('click', async (e) => {
    const flyBtn = e.target.closest('[data-career-fly]');
    if (flyBtn) {
      const c = state.campus.oficinas_carreras.find((x) => x.id === Number(flyBtn.dataset.careerFly));
      if (c) {
        motion.scrollToSection('sec-mapa');
        scene3d.flyTo(c.pos_x, c.pos_y, c.pos_z, 25);
        handleSelect3D('career', c);
      }
      return;
    }
    const editBtn = e.target.closest('[data-career-edit]');
    if (editBtn) {
      const c = state.campus.oficinas_carreras.find((x) => x.id === Number(editBtn.dataset.careerEdit));
      if (c) openCareerModal(c);
      return;
    }
    const delBtn = e.target.closest('[data-career-del]');
    if (delBtn) {
      try {
        await api(`/api/carreras/${Number(delBtn.dataset.careerDel)}`, { method: 'DELETE' });
        toast('Oficina eliminada');
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // Bóveda TI
  $('#btn-ti-demos').addEventListener('click', () => {
    $('#ti-demo-hints').classList.toggle('is-hidden');
  });

  $('#ti-demo-hints').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-demo-dni]');
    if (!btn || state.tiVault.authorized) return;
    $('#ti-dni').value = btn.dataset.demoDni;
    $('#ti-pin').value = btn.dataset.demoPin;
    toast('Credenciales demo cargadas, pulsa Validar Autorización');
  });

  $('#ti-auth-bar').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.tiVault.authorized) return;
    try {
      await api('/api/ti/autorizar', {
        method: 'POST',
        body: JSON.stringify({
          dni: $('#ti-dni').value,
          pin: $('#ti-pin').value,
        }),
      });
      toast('Autorización TI verificada');
      await loadAll();
      renderLabs();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#btn-ti-lock').addEventListener('click', async () => {
    await api('/api/ti/bloquear', { method: 'POST' });
    state.tiTab = 'creds';
    toast('Bóveda TI bloqueada');
    await loadAll();
  });

  $('#btn-ti-new-cred').addEventListener('click', () => openTiCredentialModal(null));

  $('#ti-tabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ti-tab]');
    if (!btn) return;
    $$('#ti-tabs [data-ti-tab]').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.tiTab = btn.dataset.tiTab;

    try {
      if (state.tiTab === 'auths') {
        state.tiAuthorizedList = await api('/api/ti/autorizados');
      } else if (state.tiTab === 'audit') {
        state.tiAuditList = await api('/api/ti/auditoria');
      }
      renderTiSection();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#ti-content').addEventListener('click', async (e) => {
    if (e.target.closest('#btn-new-authorized')) {
      openNewAuthorizedModal();
      return;
    }
    const revBtn = e.target.closest('[data-ti-reveal]');
    if (revBtn) {
      try {
        const res = await api(`/api/ti/credenciales/${Number(revBtn.dataset.tiReveal)}/revelar`, { method: 'POST' });
        state.tiRevealed.set(res.id, res);
        renderTiSection();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const copyBtn = e.target.closest('[data-ti-copy]');
    if (copyBtn) {
      const res = state.tiRevealed.get(Number(copyBtn.dataset.tiCopy));
      if (res) copyText(res.clave, 'Clave TI');
      return;
    }
    const editBtn = e.target.closest('[data-ti-edit]');
    if (editBtn) {
      const cred = state.tiVault.items.find((x) => x.id === Number(editBtn.dataset.tiEdit));
      if (cred) openTiCredentialModal(cred);
      return;
    }
    const delBtn = e.target.closest('[data-ti-del]');
    if (delBtn) {
      try {
        await api(`/api/ti/credenciales/${Number(delBtn.dataset.tiDel)}`, { method: 'DELETE' });
        toast('Credencial TI eliminada');
        await loadAll();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const togBtn = e.target.closest('[data-auth-toggle]');
    if (togBtn) {
      try {
        await api(`/api/ti/autorizados/${Number(togBtn.dataset.authToggle)}/estado`, { method: 'PATCH' });
        state.tiAuthorizedList = await api('/api/ti/autorizados');
        renderTiSection();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
}

async function openModelManagerModal() {
  let manifestData = null;
  try {
    manifestData = await api('/api/modelos');
  } catch {
    manifestData = { active: null, models: [] };
  }

  const tel = scene3d?.getTelemetry();
  const telHtml = tel
    ? `
      <div class="flow-pill-row" style="margin-bottom:14px;">
        <div class="row-main">
          <span class="signal-orb"></span>
          <div>
            <div class="row-title">${esc(tel.file)} (${esc(tel.grade)})</div>
            <div class="row-sub">
              ${tel.rawMeshes} mallas → ${tel.mergedDrawCalls} draw calls · ${Number(tel.triangles || 0).toLocaleString('es-PE')} triángulos · Carga ${tel.loadMs} ms
            </div>
          </div>
        </div>
        ${tel.sizeMB ? `<span class="soft-chip">${tel.sizeMB} MB</span>` : ''}
      </div>
    `
    : `<div class="row-sub" style="margin-bottom:12px;">Modo procedural activo (sin .glb).</div>`;

  const modelsHtml = (manifestData.models || []).length
    ? manifestData.models
        .map((m) => {
          const isAct = m.id === manifestData.active;
          return `
          <div class="flow-pill-row ${isAct ? '' : 'is-maint'}">
            <div class="row-main">
              <span class="signal-orb ${isAct ? '' : 'is-amber'}"></span>
              <div>
                <div class="row-title">${esc(m.id)} · ${esc(m.file)}</div>
                <div class="row-sub">${m.sizeMB} MB · Grado ${esc(m.grade)} · ${m.stats?.rawDrawCalls || 0}→${m.stats?.mergedDrawCalls || 0} DC · #${esc(m.hash)}</div>
              </div>
            </div>
            <div class="row-actions">
              ${
                isAct
                  ? '<span class="soft-chip">Activo</span>'
                  : `<button type="button" class="pill-btn is-active" data-model-activate="${esc(m.id)}">Activar</button>`
              }
            </div>
          </div>`;
        })
        .join('')
    : '<div class="row-sub">Sin versiones registradas. Ejecuta: <code>node glb-pipeline/cli.mjs apply &lt;modelo.glb&gt; --sync-db</code></div>';

  openModal('Gestor de Modelos 3D (.glb)', `
    <div style="margin-bottom:10px;font-size:0.84rem;color:var(--celeste-soft);font-weight:600;">Telemetría en ejecución</div>
    ${telHtml}
    <div style="margin:12px 0 8px;font-size:0.84rem;color:var(--celeste-soft);font-weight:600;">Versiones registradas (manifest.json)</div>
    <div id="modal-models-list" class="flow-list">${modelsHtml}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:16px;">
      <label class="pill-btn is-outline" style="cursor:pointer;">
        Probar .glb local
        <input id="input-preview-glb" type="file" accept=".glb,.gltf" hidden>
      </label>
      <span class="row-sub">También puedes arrastrar un .glb al mapa 3D</span>
    </div>
  `, (root) => {
    $('#input-preview-glb', root)?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !scene3d) return;
      const objUrl = URL.createObjectURL(file);
      closeModal();
      toast(`Previsualizando ${file.name}...`);
      await scene3d.loadFromBlob(objUrl, file.name);
    });

    $('#modal-models-list', root)?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-model-activate]');
      if (!btn) return;
      const id = btn.dataset.modelActivate;
      try {
        const res = await api('/api/modelos/activar', {
          method: 'POST',
          body: JSON.stringify({ id }),
        });
        closeModal();
        if (res.activeModel && scene3d) {
          await scene3d.switchModelByEntry(res.activeModel, false);
        }
        toast(`Modelo 3D activo: ${id}`);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function boot() {
  mountAllTechTexts();

  motion = initMotion({
    sections: ['sec-mapa', 'sec-wifi', 'sec-labs', 'sec-carreras', 'sec-ti'],
  });

  try {
    scene3d = new Campus3D($('#campus-canvas'), {
      onSelect: handleSelect3D,
      onProbe: handleProbe3D,
      onToast: (msg, isErr) => toast(msg, isErr),
      onModelLoaded: (tel) => {
        const btn = $('#btn-model-info');
        if (btn && tel) {
          btn.textContent = `3D · ${tel.id} (${tel.grade})`;
        }
      },
    });
  } catch (err) {
    console.error('Error iniciando visor 3D:', err);
    toast(`Error iniciando visor 3D: ${err.message}`, true);
  }

  bindEvents();
  try {
    await loadAll(false);
  } catch (err) {
    toast(`Error inicializando: ${err.message}`, true);
  }
}

boot();
