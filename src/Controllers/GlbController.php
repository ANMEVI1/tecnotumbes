<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Env;
use App\Http\Response;
use RuntimeException;

final class GlbController
{
    private function modelsDir(): string
    {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'models';
    }

    private function manifestPath(): string
    {
        return $this->modelsDir() . DIRECTORY_SEPARATOR . 'manifest.json';
    }

    /**
     * @return array<string, mixed>
     */
    private function readManifest(): array
    {
        $path = $this->manifestPath();
        if (!is_file($path)) {
            return [
                'schemaVersion' => 1,
                'active'        => null,
                'updatedAt'     => null,
                'models'        => [],
            ];
        }

        $raw = file_get_contents($path);
        $decoded = json_decode($raw ?: '', true);
        if (!is_array($decoded)) {
            return [
                'schemaVersion' => 1,
                'active'        => null,
                'updatedAt'     => null,
                'models'        => [],
            ];
        }
        return $decoded;
    }

    public function index(): void
    {
        $manifest = $this->readManifest();
        $activeId = $manifest['active'] ?? null;
        $activeModel = null;

        foreach ($manifest['models'] ?? [] as $m) {
            if (($m['id'] ?? null) === $activeId) {
                $activeModel = $m;
                break;
            }
        }

        $cdnUrl = rtrim(Env::get('CDN_URL', ''), '/');

        Response::json([
            'active'      => $activeId,
            'updatedAt'   => $manifest['updatedAt'] ?? null,
            'models'      => $manifest['models'] ?? [],
            'activeModel' => $activeModel,
            'assetBase'   => $cdnUrl,
        ]);
    }

    public function activate(): void
    {
        $data = Response::body();
        $targetId = trim((string) ($data['id'] ?? ''));
        if ($targetId === '') {
            throw new RuntimeException('Indica el ID del modelo 3D a activar.', 422);
        }

        $manifestPath = $this->manifestPath();
        $manifest = $this->readManifest();
        $found = null;

        foreach ($manifest['models'] ?? [] as $m) {
            if (($m['id'] ?? '') === $targetId) {
                $found = $m;
                break;
            }
        }

        if ($found === null) {
            throw new RuntimeException('Modelo no encontrado en manifest.json.', 404);
        }

        $modelFile = $this->modelsDir() . DIRECTORY_SEPARATOR . basename((string) $found['file']);
        if (!is_file($modelFile)) {
            throw new RuntimeException('El archivo .glb físico no existe en public/assets/models.', 404);
        }

        $manifest['active'] = $found['id'];
        $manifest['updatedAt'] = gmdate('c');

        $tmp = $manifestPath . '.tmp-' . getmypid();
        $encoded = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
        if (file_put_contents($tmp, $encoded, LOCK_EX) === false || !rename($tmp, $manifestPath)) {
            throw new RuntimeException('No se pudo actualizar manifest.json.', 500);
        }

        // Sincronizar MODEL_GLB_URL en .env si existe
        $envFile = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . '.env';
        if (is_file($envFile)) {
            $envRaw = file_get_contents($envFile);
            if ($envRaw !== false) {
                $newUrl = (string) ($found['url'] ?? ('/assets/models/' . $found['file']));
                if (preg_match('/^\s*MODEL_GLB_URL\s*=.*/m', $envRaw)) {
                    $updated = preg_replace('/^\s*MODEL_GLB_URL\s*=.*/m', 'MODEL_GLB_URL=' . $newUrl, $envRaw);
                } else {
                    $updated = rtrim($envRaw) . "\nMODEL_GLB_URL=" . $newUrl . "\n";
                }
                if ($updated !== null) {
                    file_put_contents($envFile, $updated, LOCK_EX);
                }
            }
        }

        Response::json([
            'active'      => $found['id'],
            'activeModel' => $found,
            'models'      => $manifest['models'] ?? [],
        ]);
    }

    public function meta(array $params): void
    {
        $targetId = trim((string) ($params['id'] ?? ''));
        if ($targetId === '') {
            throw new RuntimeException('Indica el ID del modelo.', 422);
        }

        $manifest = $this->readManifest();
        $found = null;
        foreach ($manifest['models'] ?? [] as $m) {
            if (($m['id'] ?? '') === $targetId) {
                $found = $m;
                break;
            }
        }

        if ($found === null) {
            throw new RuntimeException('Modelo no encontrado en manifest.json.', 404);
        }

        $metaFile = $this->modelsDir() . DIRECTORY_SEPARATOR . basename((string) ($found['metaFile'] ?? ''));
        if (!is_file($metaFile)) {
            throw new RuntimeException('El archivo de metadatos .meta.json no existe.', 404);
        }

        $raw = file_get_contents($metaFile);
        $decoded = json_decode($raw ?: '', true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Metadatos .meta.json corruptos.', 500);
        }

        Response::json($decoded);
    }
}
