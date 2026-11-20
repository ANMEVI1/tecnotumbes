<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use App\Config\Database;

/**
 * Sincroniza de forma segura las coordenadas y dimensiones de pabellones
 * desde el archivo .meta.json generado por el analizador GLB.
 * Nunca borra redes WiFi, cuentas de laboratorio, credenciales TI ni auditoría.
 * Soporta --dry-run (sin escribir en MySQL) y --json (salida estructurada para agentes IA).
 */

$args = array_slice($argv ?? [], 1);
$metaPath = null;
$reanchor = false;
$dryRun = false;
$asJson = false;

foreach ($args as $arg) {
    if ($arg === '--reanchor') {
        $reanchor = true;
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    } elseif ($arg === '--json') {
        $asJson = true;
    } elseif (!str_starts_with($arg, '--') && $metaPath === null) {
        $metaPath = $arg;
    }
}

$emitError = static function (string $msg, int $code = 1) use ($asJson): never {
    if ($asJson) {
        echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    } else {
        fwrite(STDERR, $msg . PHP_EOL);
    }
    exit($code);
};

if ($metaPath === null || !is_file($metaPath)) {
    $emitError('Uso: php sync-glb-db.php <ruta-al-meta.json> [--reanchor] [--dry-run] [--json]');
}

$raw = file_get_contents($metaPath);
$meta = json_decode($raw ?: '', true);
if (!is_array($meta) || empty($meta['detectedPabellones'])) {
    $emitError('El archivo meta.json no contiene detectedPabellones.');
}

$pdo = Database::connection();
$pdo->beginTransaction();

try {
    $selPab = $pdo->prepare('SELECT id, codigo, pos_x, pos_z, ancho, alto, profundidad FROM pabellones WHERE codigo = ? LIMIT 1');
    $updPab = $pdo->prepare(
        'UPDATE pabellones
         SET pos_x = ?, pos_y = ?, pos_z = ?, ancho = ?, alto = ?, profundidad = ?
         WHERE id = ?'
    );

    $updWifi = $pdo->prepare('UPDATE redes_wifi SET pos_x = pos_x + ?, pos_z = pos_z + ? WHERE pabellon_id = ?');
    $updLab  = $pdo->prepare('UPDATE laboratorios SET pos_x = pos_x + ?, pos_z = pos_z + ? WHERE pabellon_id = ?');
    $updCar  = $pdo->prepare('UPDATE oficinas_carreras SET pos_x = pos_x + ?, pos_z = pos_z + ? WHERE pabellon_id = ?');

    $updatedPabs = 0;
    $reanchoredPabs = 0;
    $changes = [];

    foreach ($meta['detectedPabellones'] as $p) {
        $codigo = (string) ($p['codigo'] ?? '');
        if ($codigo === '') {
            continue;
        }

        $selPab->execute([$codigo]);
        $existing = $selPab->fetch();
        if (!$existing) {
            continue;
        }

        $newX = (float) ($p['center'][0] ?? 0.0);
        $newY = 0.0;
        $newZ = (float) ($p['center'][2] ?? 0.0);
        $ancho = max(2.0, (float) ($p['size'][0] ?? 10.0));
        $alto = max(2.0, (float) ($p['size'][1] ?? 4.0));
        $prof = max(2.0, (float) ($p['size'][2] ?? 10.0));

        $oldX = (float) $existing['pos_x'];
        $oldZ = (float) $existing['pos_z'];
        $dx = round($newX - $oldX, 2);
        $dz = round($newZ - $oldZ, 2);

        $willReanchor = $reanchor && (abs($dx) > 0.25 || abs($dz) > 0.25);

        if (!$dryRun) {
            $updPab->execute([$newX, $newY, $newZ, $ancho, $alto, $prof, (int) $existing['id']]);
            if ($willReanchor) {
                $pid = (int) $existing['id'];
                $updWifi->execute([$dx, $dz, $pid]);
                $updLab->execute([$dx, $dz, $pid]);
                $updCar->execute([$dx, $dz, $pid]);
            }
        }

        $updatedPabs++;
        if ($willReanchor) {
            $reanchoredPabs++;
        }

        $changes[] = [
            'codigo'     => $codigo,
            'fromCenter' => [$oldX, $oldZ],
            'toCenter'   => [$newX, $newZ],
            'deltaXZ'    => [$dx, $dz],
            'size'       => [$ancho, $alto, $prof],
            'reanchored' => $willReanchor,
        ];
    }

    if ($dryRun) {
        $pdo->rollBack();
    } else {
        $pdo->commit();
    }

    if ($asJson) {
        echo json_encode([
            'ok'                   => true,
            'dryRun'               => $dryRun,
            'updatedPabellones'    => $updatedPabs,
            'reanchoredPabellones' => $reanchoredPabs,
            'changes'              => $changes,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    } else {
        $prefix = $dryRun ? '[DRY-RUN] ' : '';
        echo "{$prefix}Sincronización BD OK: {$updatedPabs} pabellones procesados" . ($reanchor ? " ({$reanchoredPabs} con pines re-anclados)" : '') . "." . PHP_EOL;
    }
} catch (Throwable $e) {
    $pdo->rollBack();
    $emitError('Error sincronizando BD: ' . $e->getMessage());
}
