<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Database;
use App\Http\Response;
use RuntimeException;

final class WifiController
{
    private const ALLOWED_TYPES = ['libre', 'laboratorio', 'institucional'];
    private const ALLOWED_STATES = ['activa', 'mantenimiento', 'inactiva'];

    public function index(): void
    {
        $pdo = Database::connection();
        $rows = $pdo->query(
            'SELECT w.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre
             FROM redes_wifi w
             LEFT JOIN pabellones p ON p.id = w.pabellon_id
             ORDER BY w.id ASC'
        )->fetchAll();

        Response::json(array_map([$this, 'formatRow'], $rows));
    }

    public function store(): void
    {
        $data = Response::body();
        $clean = $this->validate($data);

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO redes_wifi
             (ssid, contrasena, tipo_acceso, banda, estado, pabellon_id, piso, ubicacion_exacta, pos_x, pos_y, pos_z, alcance_metros, potencia_dbm, velocidad_mbps, color_senal, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $clean['ssid'],
            $clean['contrasena'],
            $clean['tipo_acceso'],
            $clean['banda'],
            $clean['estado'],
            $clean['pabellon_id'],
            $clean['piso'],
            $clean['ubicacion_exacta'],
            $clean['pos_x'],
            $clean['pos_y'],
            $clean['pos_z'],
            $clean['alcance_metros'],
            $clean['potencia_dbm'],
            $clean['velocidad_mbps'],
            $clean['color_senal'],
            $clean['notas'],
        ]);

        $id = (int) $pdo->lastInsertId();
        Response::json($this->findOrFail($id), 201);
    }

    public function update(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $this->findOrFail($id);
        $clean = $this->validate(Response::body());

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE redes_wifi
             SET ssid = ?, contrasena = ?, tipo_acceso = ?, banda = ?, estado = ?, pabellon_id = ?, piso = ?,
                 ubicacion_exacta = ?, pos_x = ?, pos_y = ?, pos_z = ?, alcance_metros = ?, potencia_dbm = ?,
                 velocidad_mbps = ?, color_senal = ?, notas = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $clean['ssid'],
            $clean['contrasena'],
            $clean['tipo_acceso'],
            $clean['banda'],
            $clean['estado'],
            $clean['pabellon_id'],
            $clean['piso'],
            $clean['ubicacion_exacta'],
            $clean['pos_x'],
            $clean['pos_y'],
            $clean['pos_z'],
            $clean['alcance_metros'],
            $clean['potencia_dbm'],
            $clean['velocidad_mbps'],
            $clean['color_senal'],
            $clean['notas'],
            $id,
        ]);

        Response::json($this->findOrFail($id));
    }

    public function updatePosition(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $current = $this->findOrFail($id);
        $data = Response::body();

        $posX = isset($data['pos_x']) ? (float) $data['pos_x'] : (float) $current['pos_x'];
        $posY = isset($data['pos_y']) ? (float) $data['pos_y'] : (float) $current['pos_y'];
        $posZ = isset($data['pos_z']) ? (float) $data['pos_z'] : (float) $current['pos_z'];
        $piso = isset($data['piso']) ? max(1, min(4, (int) $data['piso'])) : (int) $current['piso'];
        $alcance = isset($data['alcance_metros'])
            ? max(5.0, min(80.0, (float) $data['alcance_metros']))
            : (float) $current['alcance_metros'];

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE redes_wifi SET pos_x = ?, pos_y = ?, pos_z = ?, piso = ?, alcance_metros = ? WHERE id = ?'
        );
        $stmt->execute([$posX, $posY, $posZ, $piso, $alcance, $id]);

        Response::json($this->findOrFail($id));
    }

    public function destroy(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $this->findOrFail($id);

        $pdo = Database::connection();
        $stmt = $pdo->prepare('DELETE FROM redes_wifi WHERE id = ?');
        $stmt->execute([$id]);

        Response::json(['deleted_id' => $id]);
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function validate(array $data): array
    {
        $ssid = trim((string) ($data['ssid'] ?? ''));
        if ($ssid === '' || mb_strlen($ssid) > 80) {
            throw new RuntimeException('El nombre de red (SSID) es obligatorio (máx. 80 caracteres).', 422);
        }

        $tipo = (string) ($data['tipo_acceso'] ?? 'libre');
        if (!in_array($tipo, self::ALLOWED_TYPES, true)) {
            throw new RuntimeException('Tipo de acceso WiFi inválido.', 422);
        }

        $estado = (string) ($data['estado'] ?? 'activa');
        if (!in_array($estado, self::ALLOWED_STATES, true)) {
            throw new RuntimeException('Estado WiFi inválido.', 422);
        }

        $pabellonId = isset($data['pabellon_id']) && $data['pabellon_id'] !== '' && $data['pabellon_id'] !== null
            ? (int) $data['pabellon_id']
            : null;

        if ($pabellonId !== null) {
            $chk = Database::connection()->prepare('SELECT id FROM pabellones WHERE id = ? LIMIT 1');
            $chk->execute([$pabellonId]);
            if (!$chk->fetch()) {
                throw new RuntimeException('El pabellón indicado no existe.', 422);
            }
        }

        $color = trim((string) ($data['color_senal'] ?? '#22D3EE'));
        if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            $color = $tipo === 'libre' ? '#22D3EE' : '#38BDF8';
        }

        return [
            'ssid'             => $ssid,
            'contrasena'       => mb_substr(trim((string) ($data['contrasena'] ?? '')), 0, 120),
            'tipo_acceso'      => $tipo,
            'banda'            => mb_substr(trim((string) ($data['banda'] ?? '2.4 / 5 GHz')) ?: '2.4 / 5 GHz', 0, 30),
            'estado'           => $estado,
            'pabellon_id'      => $pabellonId,
            'piso'             => max(1, min(4, (int) ($data['piso'] ?? 1))),
            'ubicacion_exacta' => mb_substr(trim((string) ($data['ubicacion_exacta'] ?? '')), 0, 140),
            'pos_x'            => max(-70.0, min(70.0, (float) ($data['pos_x'] ?? 0.0))),
            'pos_y'            => max(1.0, min(18.0, (float) ($data['pos_y'] ?? 3.2))),
            'pos_z'            => max(-70.0, min(70.0, (float) ($data['pos_z'] ?? 0.0))),
            'alcance_metros'   => max(5.0, min(80.0, (float) ($data['alcance_metros'] ?? 25.0))),
            'potencia_dbm'     => max(-90, min(-20, (int) ($data['potencia_dbm'] ?? -46))),
            'velocidad_mbps'   => max(10, min(2400, (int) ($data['velocidad_mbps'] ?? 300))),
            'color_senal'      => $color,
            'notas'            => mb_substr(trim((string) ($data['notas'] ?? '')), 0, 255),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function findOrFail(int $id): array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT w.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre
             FROM redes_wifi w
             LEFT JOIN pabellones p ON p.id = w.pabellon_id
             WHERE w.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Red WiFi no encontrada.', 404);
        }
        return $this->formatRow($row);
    }

    /**
     * @param array<string, mixed> $w
     * @return array<string, mixed>
     */
    private function formatRow(array $w): array
    {
        return [
            'id'               => (int) $w['id'],
            'ssid'             => (string) $w['ssid'],
            'contrasena'       => (string) $w['contrasena'],
            'tipo_acceso'      => (string) $w['tipo_acceso'],
            'banda'            => (string) $w['banda'],
            'estado'           => (string) $w['estado'],
            'pabellon_id'      => $w['pabellon_id'] !== null ? (int) $w['pabellon_id'] : null,
            'pabellon_codigo'  => $w['pabellon_codigo'] !== null ? (string) $w['pabellon_codigo'] : null,
            'pabellon_nombre'  => $w['pabellon_nombre'] !== null ? (string) $w['pabellon_nombre'] : null,
            'piso'             => (int) $w['piso'],
            'ubicacion_exacta' => (string) $w['ubicacion_exacta'],
            'pos_x'            => (float) $w['pos_x'],
            'pos_y'            => (float) $w['pos_y'],
            'pos_z'            => (float) $w['pos_z'],
            'alcance_metros'   => (float) $w['alcance_metros'],
            'potencia_dbm'     => (int) $w['potencia_dbm'],
            'velocidad_mbps'   => (int) $w['velocidad_mbps'],
            'color_senal'      => (string) $w['color_senal'],
            'notas'            => (string) $w['notas'],
            'updated_at'       => (string) $w['updated_at'],
        ];
    }
}
