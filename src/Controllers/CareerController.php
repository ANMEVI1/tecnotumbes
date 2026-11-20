<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Database;
use App\Http\Response;
use RuntimeException;

final class CareerController
{
    private const ALLOWED_AREAS = ['Tecnología', 'Salud', 'Gestión'];
    private const ALLOWED_STATES = ['abierta', 'cerrada'];

    public function index(): void
    {
        $rows = Database::connection()->query(
            'SELECT o.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre, w.ssid AS wifi_ssid
             FROM oficinas_carreras o
             LEFT JOIN pabellones p ON p.id = o.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = o.red_wifi_id
             ORDER BY o.area ASC, o.id ASC'
        )->fetchAll();

        Response::json(array_map([$this, 'formatRow'], $rows));
    }

    public function store(): void
    {
        $clean = $this->validate(Response::body());
        $pdo = Database::connection();

        $stmt = $pdo->prepare(
            'INSERT INTO oficinas_carreras
             (codigo, nombre_carrera, area, coordinador, pabellon_id, piso, numero_oficina, horario, red_wifi_id, pos_x, pos_y, pos_z, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $clean['codigo'],
            $clean['nombre_carrera'],
            $clean['area'],
            $clean['coordinador'],
            $clean['pabellon_id'],
            $clean['piso'],
            $clean['numero_oficina'],
            $clean['horario'],
            $clean['red_wifi_id'],
            $clean['pos_x'],
            $clean['pos_y'],
            $clean['pos_z'],
            $clean['estado'],
        ]);

        $id = (int) $pdo->lastInsertId();
        Response::json($this->findOrFail($id), 201);
    }

    public function update(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $current = $this->findOrFail($id);
        $data = array_merge($current, Response::body());
        $clean = $this->validate($data, $id);

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE oficinas_carreras
             SET codigo = ?, nombre_carrera = ?, area = ?, coordinador = ?, pabellon_id = ?, piso = ?,
                 numero_oficina = ?, horario = ?, red_wifi_id = ?, pos_x = ?, pos_y = ?, pos_z = ?, estado = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $clean['codigo'],
            $clean['nombre_carrera'],
            $clean['area'],
            $clean['coordinador'],
            $clean['pabellon_id'],
            $clean['piso'],
            $clean['numero_oficina'],
            $clean['horario'],
            $clean['red_wifi_id'],
            $clean['pos_x'],
            $clean['pos_y'],
            $clean['pos_z'],
            $clean['estado'],
            $id,
        ]);

        Response::json($this->findOrFail($id));
    }

    public function destroy(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $this->findOrFail($id);
        $stmt = Database::connection()->prepare('DELETE FROM oficinas_carreras WHERE id = ?');
        $stmt->execute([$id]);
        Response::json(['deleted_id' => $id]);
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function validate(array $data, ?int $ignoreId = null): array
    {
        $nombre = trim((string) ($data['nombre_carrera'] ?? ''));
        if ($nombre === '') {
            throw new RuntimeException('El nombre de la carrera es obligatorio.', 422);
        }

        $codigo = strtoupper(trim((string) ($data['codigo'] ?? '')));
        if ($codigo === '') {
            $codigo = 'CAR-' . substr(bin2hex(random_bytes(3)), 0, 5);
        }

        $pdo = Database::connection();
        $dupStmt = $pdo->prepare('SELECT id FROM oficinas_carreras WHERE codigo = ? LIMIT 1');
        $dupStmt->execute([$codigo]);
        $dup = $dupStmt->fetch();
        if ($dup && (int) $dup['id'] !== $ignoreId) {
            throw new RuntimeException('El código de oficina ya existe.', 422);
        }

        $area = (string) ($data['area'] ?? 'Tecnología');
        if (!in_array($area, self::ALLOWED_AREAS, true)) {
            throw new RuntimeException('Área de carrera inválida.', 422);
        }

        $estado = (string) ($data['estado'] ?? 'abierta');
        if (!in_array($estado, self::ALLOWED_STATES, true)) {
            throw new RuntimeException('Estado de oficina inválido.', 422);
        }

        return [
            'codigo'         => mb_substr($codigo, 0, 24),
            'nombre_carrera' => mb_substr($nombre, 0, 140),
            'area'           => $area,
            'coordinador'    => mb_substr(trim((string) ($data['coordinador'] ?? '')), 0, 120),
            'pabellon_id'    => !empty($data['pabellon_id']) ? (int) $data['pabellon_id'] : null,
            'piso'           => max(1, min(4, (int) ($data['piso'] ?? 1))),
            'numero_oficina' => mb_substr(trim((string) ($data['numero_oficina'] ?? '')), 0, 40),
            'horario'        => mb_substr(trim((string) ($data['horario'] ?? 'Lun-Vie 08:00 - 16:30')), 0, 80),
            'red_wifi_id'    => !empty($data['red_wifi_id']) ? (int) $data['red_wifi_id'] : null,
            'pos_x'          => max(-70.0, min(70.0, (float) ($data['pos_x'] ?? 0.0))),
            'pos_y'          => max(0.5, min(18.0, (float) ($data['pos_y'] ?? 1.5))),
            'pos_z'          => max(-70.0, min(70.0, (float) ($data['pos_z'] ?? 0.0))),
            'estado'         => $estado,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function findOrFail(int $id): array
    {
        $stmt = Database::connection()->prepare(
            'SELECT o.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre, w.ssid AS wifi_ssid
             FROM oficinas_carreras o
             LEFT JOIN pabellones p ON p.id = o.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = o.red_wifi_id
             WHERE o.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Oficina de carrera no encontrada.', 404);
        }
        return $this->formatRow($row);
    }

    /**
     * @param array<string, mixed> $o
     * @return array<string, mixed>
     */
    private function formatRow(array $o): array
    {
        return [
            'id'              => (int) $o['id'],
            'codigo'          => (string) $o['codigo'],
            'nombre_carrera'  => (string) $o['nombre_carrera'],
            'area'            => (string) $o['area'],
            'coordinador'     => (string) $o['coordinador'],
            'pabellon_id'     => $o['pabellon_id'] !== null ? (int) $o['pabellon_id'] : null,
            'pabellon_codigo' => $o['pabellon_codigo'] !== null ? (string) $o['pabellon_codigo'] : null,
            'pabellon_nombre' => $o['pabellon_nombre'] !== null ? (string) $o['pabellon_nombre'] : null,
            'piso'            => (int) $o['piso'],
            'numero_oficina'  => (string) $o['numero_oficina'],
            'horario'         => (string) $o['horario'],
            'red_wifi_id'     => $o['red_wifi_id'] !== null ? (int) $o['red_wifi_id'] : null,
            'wifi_ssid'       => $o['wifi_ssid'] !== null ? (string) $o['wifi_ssid'] : null,
            'pos_x'           => (float) $o['pos_x'],
            'pos_y'           => (float) $o['pos_y'],
            'pos_z'           => (float) $o['pos_z'],
            'estado'          => (string) $o['estado'],
        ];
    }
}
