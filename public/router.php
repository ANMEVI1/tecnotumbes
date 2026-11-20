<?php

declare(strict_types=1);

$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$publicFile = __DIR__ . $uriPath;

// Servir archivos estáticos reales directamente
if ($uriPath !== '/' && is_file($publicFile)) {
    return false;
}

if (str_starts_with($uriPath, '/assets/') || $uriPath === '/favicon.ico') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '404 Not Found';
    exit;
}

if (str_starts_with($uriPath, '/api/')) {
    require_once dirname(__DIR__) . '/src/bootstrap.php';

    $router = new \App\Http\Router();

    $campus = new \App\Controllers\CampusController();
    $wifi   = new \App\Controllers\WifiController();
    $labs   = new \App\Controllers\LabController();
    $career = new \App\Controllers\CareerController();
    $ti     = new \App\Controllers\TiVaultController();
    $glb    = new \App\Controllers\GlbController();

    // Campus snapshot
    $router->add('GET', '/api/campus', [$campus, 'index']);

    // Modelos Blender (.glb) y telemetría
    $router->add('GET', '/api/modelos', [$glb, 'index']);
    $router->add('GET', '/api/modelos/{id}/meta', [$glb, 'meta']);
    $router->add('POST', '/api/modelos/activar', [$glb, 'activate']);

    // WiFi & alcance 3D
    $router->add('GET', '/api/wifi', [$wifi, 'index']);
    $router->add('POST', '/api/wifi', [$wifi, 'store']);
    $router->add('PUT', '/api/wifi/{id}', [$wifi, 'update']);
    $router->add('PATCH', '/api/wifi/{id}/posicion', [$wifi, 'updatePosition']);
    $router->add('DELETE', '/api/wifi/{id}', [$wifi, 'destroy']);

    // 6 Laboratorios de Cómputo y cuentas
    $router->add('GET', '/api/labs', [$labs, 'index']);
    $router->add('PUT', '/api/labs/{id}', [$labs, 'update']);
    $router->add('POST', '/api/labs/{id}/cuentas', [$labs, 'storeAccount']);
    $router->add('PUT', '/api/cuentas/{id}', [$labs, 'updateAccount']);
    $router->add('DELETE', '/api/cuentas/{id}', [$labs, 'deleteAccount']);
    $router->add('POST', '/api/cuentas/{id}/revelar', [$labs, 'revealAccount']);

    // 10 Oficinas de Carreras
    $router->add('GET', '/api/carreras', [$career, 'index']);
    $router->add('POST', '/api/carreras', [$career, 'store']);
    $router->add('PUT', '/api/carreras/{id}', [$career, 'update']);
    $router->add('DELETE', '/api/carreras/{id}', [$career, 'destroy']);

    // Bóveda TI segura (sin login de sitio, validación inline por BD)
    $router->add('GET', '/api/ti/estado', [$ti, 'status']);
    $router->add('POST', '/api/ti/autorizar', [$ti, 'authorize']);
    $router->add('POST', '/api/ti/bloquear', [$ti, 'lock']);
    $router->add('GET', '/api/ti/credenciales', [$ti, 'listCredentials']);
    $router->add('POST', '/api/ti/credenciales', [$ti, 'storeCredential']);
    $router->add('PUT', '/api/ti/credenciales/{id}', [$ti, 'updateCredential']);
    $router->add('DELETE', '/api/ti/credenciales/{id}', [$ti, 'deleteCredential']);
    $router->add('POST', '/api/ti/credenciales/{id}/revelar', [$ti, 'revealCredential']);
    $router->add('GET', '/api/ti/autorizados', [$ti, 'listAuthorized']);
    $router->add('POST', '/api/ti/autorizados', [$ti, 'storeAuthorized']);
    $router->add('PATCH', '/api/ti/autorizados/{id}/estado', [$ti, 'toggleAuthorized']);
    $router->add('GET', '/api/ti/auditoria', [$ti, 'listAudit']);

    $router->dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $uriPath);
    exit;
}

require __DIR__ . '/index.php';
