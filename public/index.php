<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use App\Config\Env;
use App\View\TechText;

$cdnUrl = rtrim(Env::get('CDN_URL', ''), '/');
$modelGlbUrl = Env::get('MODEL_GLB_URL', '/assets/models/tecno-v1.glb');
$manifestFile = __DIR__ . '/assets/models/manifest.json';
if (is_file($manifestFile)) {
    $mRaw = json_decode((string) file_get_contents($manifestFile), true);
    if (is_array($mRaw) && !empty($mRaw['active']) && !empty($mRaw['models'])) {
        foreach ($mRaw['models'] as $entry) {
            if (($entry['id'] ?? null) === $mRaw['active'] && !empty($entry['url'])) {
                $modelGlbUrl = (string) $entry['url'] . (!empty($entry['hash']) ? '?v=' . $entry['hash'] : '');
                break;
            }
        }
    }
}
if ($cdnUrl !== '' && !str_starts_with($modelGlbUrl, 'http')) {
    $modelGlbFullUrl = $cdnUrl . '/' . ltrim($modelGlbUrl, '/');
} else {
    $modelGlbFullUrl = $modelGlbUrl;
}
$cssUrl = $cdnUrl !== '' ? $cdnUrl . '/assets/css/app.css' : '/assets/css/app.css';
$jsAppUrl = $cdnUrl !== '' ? $cdnUrl . '/assets/js/app.js' : '/assets/js/app.js';
?><!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TECNO · TUMBES — WiFi, Labs y Croquis 3D</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="<?= htmlspecialchars($cssUrl, ENT_QUOTES, 'UTF-8') ?>">
  <script type="importmap">
    {
      "imports": {
        "three": "<?= $cdnUrl !== '' ? 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js' : '/assets/vendor/three.module.min.js' ?>",
        "three/addons/": "<?= $cdnUrl !== '' ? 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/' : '/assets/vendor/' ?>"
      }
    }
  </script>
  <script>
    window.APP_CONFIG = {
      assetBase: <?= json_encode($cdnUrl) ?>,
      modelGlbUrl: <?= json_encode($modelGlbFullUrl) ?>
    };
  </script>
</head>
<body>
  <div class="ambient-orbs" aria-hidden="true">
    <div class="orb orb-celeste-1" data-orb data-depth="34" data-dir="1"></div>
    <div class="orb orb-red-1" data-orb data-depth="42" data-dir="-1"></div>
    <div class="orb orb-celeste-2" data-orb data-depth="28" data-dir="1"></div>
  </div>

  <a class="brand-float" href="#sec-mapa">
    <span class="brand-dot"></span>
    <span>TECNO · TUMBES</span>
  </a>

  <!-- Header flotante derecho exactamente estilo cápsula pill -->
  <nav id="floating-nav" class="floating-nav" aria-label="Navegación principal">
    <span id="nav-pill-indicator" class="nav-pill-indicator" aria-hidden="true"></span>
    <a class="nav-pill-link is-active" href="#sec-mapa" data-target="sec-mapa">Mapa 3D</a>
    <a class="nav-pill-link" href="#sec-wifi" data-target="sec-wifi">WiFi</a>
    <a class="nav-pill-link" href="#sec-labs" data-target="sec-labs">Labs</a>
    <a class="nav-pill-link" href="#sec-carreras" data-target="sec-carreras">Carreras</a>
    <a class="nav-pill-link" href="#sec-ti" data-target="sec-ti">TI</a>
  </nav>

  <main>
    <!-- 1. CROQUIS 3D DINÁMICO -->
    <section id="sec-mapa" class="hero-section">
      <div class="shell">
        <div class="hero-top" data-flow>
          <div class="hero-heading-block">
            <h1 class="hero-title hero-title-tech">
              <?= TechText::render([
                  'lines' => [
                      ['text' => 'CAMPUS 3D', 'color' => '#22D3EE', 'accentColor' => '#7DD3FC'],
                      ['text' => 'WIFI · LABS · TI', 'color' => '#FF1E56', 'accentColor' => '#FF6B93'],
                  ],
                  'ariaLabel' => 'Campus 3D — WiFi · Labs · TI',
                  'fontFamily' => "'Outfit', 'Segoe UI', system-ui, sans-serif",
                  'fontWeight' => 800,
                  'fontSize' => 76,
                  'letterSpacing' => -0.025,
                  'lineHeight' => 1.24,
                  'edgePadding' => 14,
                  'align' => 'left',
                  'reveal' => 'letter',
                  'dashLength' => 4,
                  'dashGap' => 2,
                  'strokeWidth' => 1.5,
                  'lineStyle' => 'dashed',
                  'specks' => 15,
                  'reach' => 200,
                  'softness' => 0.7,
                  'speed' => 1,
                  'bounce' => 0.4,
                  'selection' => true,
                  'labels' => true,
                  'draggable' => true,
                  'clickKick' => true,
                  'sweep' => true,
                  'intro' => 'none',
                  'introDuration' => 2,
                  'guides' => false,
              ]) ?>
            </h1>
            <p class="hero-sub">IESTP Cap. FAP José Abelardo Quiñones — Av. Tumbes Norte N° 1228</p>
          </div>
          <div id="hero-metrics" class="hero-pills"></div>
        </div>

        <div class="stage-wrap" data-flow>
          <div id="campus-canvas" class="campus-canvas"></div>

          <div id="pick-banner" class="pick-banner is-hidden">
            <span>Haz clic en el croquis 3D para ubicar la antena WiFi</span>
            <button id="btn-cancel-pick" type="button" class="pill-btn is-outline">Cancelar</button>
          </div>

          <aside id="stage-inspector" class="stage-inspector is-hidden" aria-live="polite"></aside>

          <div class="stage-dock">
            <div class="dock-group" role="group" aria-label="Modo visual">
              <button type="button" class="pill-btn is-active" data-mode="neon">Neón</button>
              <button type="button" class="pill-btn" data-mode="real">Real</button>
            </div>
            <div class="dock-group" role="group" aria-label="Filtro por piso">
              <button type="button" class="pill-btn is-active" data-floor="0">Todos</button>
              <button type="button" class="pill-btn" data-floor="1">P1</button>
              <button type="button" class="pill-btn" data-floor="2">P2</button>
              <button type="button" class="pill-btn" data-floor="3">P3</button>
            </div>
            <button id="btn-toggle-coverage" type="button" class="pill-btn is-active">Alcance WiFi</button>
            <button id="btn-toggle-labels" type="button" class="pill-btn is-active">Pabellones</button>
            <button id="btn-probe-mode" type="button" class="pill-btn is-outline">Medir Señal</button>
            <button id="btn-reset-cam" type="button" class="pill-btn is-outline">Centrar</button>
            <button id="btn-pause-3d" type="button" class="pill-btn is-outline">Pausar 3D</button>
            <button id="btn-model-info" type="button" class="pill-btn is-outline">3D · Modelo</button>
          </div>
        </div>
      </div>
    </section>

    <svg class="wave-divider" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,32 C320,64 640,0 960,34 C1200,56 1340,20 1440,28 L1440,60 L0,60 Z" fill="rgba(34,211,238,0.06)"/>
    </svg>

    <!-- 2. WIFI & CONTRASEÑAS LIBRES -->
    <section id="sec-wifi" class="func-section">
      <div class="shell" data-flow>
        <div class="sec-header">
          <h2 class="sec-title">WiFi & <span>Claves Libres</span></h2>
          <div class="sec-toolbar">
            <input id="wifi-search" type="search" class="pill-input" placeholder="Buscar SSID o pabellón...">
            <select id="wifi-filter" class="pill-select" aria-label="Filtrar WiFi">
              <option value="all">Todas</option>
              <option value="libre">Libres</option>
              <option value="laboratorio">Laboratorios</option>
              <option value="mantenimiento">Mantenimiento</option>
            </select>
            <button id="btn-new-wifi" type="button" class="pill-btn is-neon">+ Nueva Red</button>
          </div>
        </div>
        <div id="wifi-list" class="flow-list"></div>
      </div>
    </section>

    <svg class="wave-divider" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,26 C400,4 780,58 1140,22 C1290,8 1380,26 1440,32 L1440,60 L0,60 Z" fill="rgba(255,30,86,0.05)"/>
    </svg>

    <!-- 3. 6 LABORATORIOS DE CÓMPUTO -->
    <section id="sec-labs" class="func-section">
      <div class="shell" data-flow>
        <div class="sec-header">
          <h2 class="sec-title">6 Laboratorios <span>de Cómputo</span></h2>
          <div class="sec-toolbar">
            <button id="btn-edit-lab" type="button" class="pill-btn is-outline">Editar Lab</button>
            <button id="btn-new-account" type="button" class="pill-btn is-neon">+ Cuenta de Lab</button>
          </div>
        </div>
        <div id="lab-selector" class="lab-selector"></div>
        <div id="lab-stage" class="lab-stage"></div>
      </div>
    </section>

    <svg class="wave-divider" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,18 C280,58 720,4 1080,44 C1260,60 1370,30 1440,18 L1440,60 L0,60 Z" fill="rgba(56,189,248,0.06)"/>
    </svg>

    <!-- 4. OFICINAS DE CARRERAS (10) -->
    <section id="sec-carreras" class="func-section">
      <div class="shell" data-flow>
        <div class="sec-header">
          <h2 class="sec-title">Oficinas de <span>Carreras</span></h2>
          <div class="sec-toolbar">
            <div class="dock-group" id="career-area-filters">
              <button type="button" class="pill-btn is-active" data-area="all">Todas</button>
              <button type="button" class="pill-btn" data-area="Tecnología">Tecnología</button>
              <button type="button" class="pill-btn" data-area="Salud">Salud</button>
              <button type="button" class="pill-btn" data-area="Gestión">Gestión</button>
            </div>
            <button id="btn-new-career" type="button" class="pill-btn is-neon">+ Oficina</button>
          </div>
        </div>
        <div id="careers-flow" class="careers-flow"></div>
      </div>
    </section>

    <svg class="wave-divider" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,36 C360,2 760,56 1120,16 C1280,0 1380,22 1440,30 L1440,60 L0,60 Z" fill="rgba(255,30,86,0.07)"/>
    </svg>

    <!-- 5. BÓVEDA TI SEGURA (SIN LOGIN GENERAL — SOLO VALIDACIÓN PERSONAL AUTORIZADO) -->
    <section id="sec-ti" class="func-section">
      <div class="shell" data-flow>
        <div class="ti-vault-shell">
          <div class="sec-header">
            <h2 class="sec-title">Bóveda <span>TI Autorizada</span></h2>
            <div class="sec-toolbar">
              <button id="btn-ti-demos" type="button" class="pill-btn is-outline">Accesos Demo</button>
              <button id="btn-ti-new-cred" type="button" class="pill-btn is-neon" hidden>+ Credencial TI</button>
              <button id="btn-ti-lock" type="button" class="pill-btn is-outline" hidden>Bloquear Bóveda</button>
            </div>
          </div>

          <div id="ti-demo-hints" class="ti-demo-hints is-hidden">
            <button type="button" class="pill-btn is-outline" data-demo-dni="45128901" data-demo-pin="TI-2026#Admin">Superadmin TI (45128901)</button>
            <button type="button" class="pill-btn is-outline" data-demo-dni="72345610" data-demo-pin="Redes#2026">Soporte Redes (72345610)</button>
            <button type="button" class="pill-btn is-outline" data-demo-dni="70981234" data-demo-pin="Labs#2026">Coord. Labs (70981234)</button>
          </div>

          <form id="ti-auth-bar" class="ti-auth-bar"></form>

          <div id="ti-tabs" class="sec-toolbar" style="margin-bottom: 16px;" hidden>
            <button type="button" class="pill-btn is-active" data-ti-tab="creds">Credenciales TI</button>
            <button type="button" class="pill-btn" data-ti-tab="auths" id="btn-tab-auths" hidden>Personal Autorizado</button>
            <button type="button" class="pill-btn" data-ti-tab="audit">Auditoría TI</button>
          </div>

          <div id="ti-content" class="flow-list"></div>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer-pill">
    TECNO · TUMBES — PHP 8.2.35 · MySQL 8 · AES-256-GCM · Argon2id · Three.js 3D
  </footer>

  <!-- Modal orgánico reutilizable -->
  <div id="modal-backdrop" class="modal-backdrop is-hidden" role="dialog" aria-modal="true">
    <div class="modal-bubble">
      <div class="modal-head">
        <h3 id="modal-title" class="modal-title"></h3>
        <button id="modal-close" type="button" class="inspector-close" aria-label="Cerrar">×</button>
      </div>
      <div id="modal-body"></div>
    </div>
  </div>

  <div id="toast-pill" class="toast-pill" role="status" aria-live="polite"></div>

  <script type="module" src="<?= htmlspecialchars($jsAppUrl, ENT_QUOTES, 'UTF-8') ?>"></script>
</body>
</html>
