<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Database;
use App\Http\Response;
use App\Security\Crypto;
use App\Security\TiAuth;
use RuntimeException;

final class LabController
{
    private const LAB_STATES = ['operativo', 'mantenimiento', 'ocupado'];
    private const ACCOUNT_ROLES = ['estudiante', 'docente', 'invitado', 'admin_local'];

    public function index(): void
    {
        $pdo = Database::connection();
        $labs = $pdo->query(
            'SELECT l.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre, w.ssid AS wifi_ssid
             FROM laboratorios l
             LEFT JOIN pabellones p ON p.id = l.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = l.red_wifi_id
             ORDER BY l.numero ASC'
        )->fetchAll();

        $accounts = $pdo->query(
            'SELECT id, laboratorio_id, usuario, contrasena, rol_cuenta, equipo_rango, es_sensible, notas, updated_at
             FROM cuentas_laboratorio
             ORDER BY FIELD(rol_cuenta, "estudiante", "docente", "invitado", "admin_local"), id ASC'
        )->fetchAll();

        $grouped = [];
        foreach ($accounts as $a) {
            $sensible = (int) $a['es_sensible'] === 1;
            $grouped[(int) $a['laboratorio_id']][] = [
                'id'             => (int) $a['id'],
                'laboratorio_id' => (int) $a['laboratorio_id'],
                'usuario'        => (string) $a['usuario'],
                'contrasena'     => $sensible ? null : (string) $a['contrasena'],
                'rol_cuenta'     => (string) $a['rol_cuenta'],
                'equipo_rango'   => (string) $a['equipo_rango'],
                'es_sensible'    => $sensible,
                'notas'          => (string) $a['notas'],
                'updated_at'     => (string) $a['updated_at'],
            ];
        }

        $result = [];
        foreach ($labs as $l) {
            $result[] = $this->formatLab($l, $grouped[(int) $l['id']] ?? []);
        }

        Response::json($result);
    }

    public function update(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $current = $this->findLabOrFail($id);
        $data = Response::body();

        $nombre = trim((string) ($data['nombre'] ?? $current['nombre']));
        if ($nombre === '') {
            throw new RuntimeException('El nombre del laboratorio es obligatorio.', 422);
        }

        $estado = (string) ($data['estado'] ?? $current['estado']);
        if (!in_array($estado, self::LAB_STATES, true)) {
            throw new RuntimeException('Estado de laboratorio inválido.', 422);
        }

        $pabellonId = array_key_exists('pabellon_id', $data)
            ? ($data['pabellon_id'] ? (int) $data['pabellon_id'] : null)
            : $current['pabellon_id'];
        $wifiId = array_key_exists('red_wifi_id', $data)
            ? ($data['red_wifi_id'] ? (int) $data['red_wifi_id'] : null)
            : $current['red_wifi_id'];

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE laboratorios
             SET nombre = ?, pabellon_id = ?, piso = ?, cantidad_pcs = ?, sistema_operativo = ?, red_wifi_id = ?,
                 estado = ?, pos_x = ?, pos_y = ?, pos_z = ?, encargado = ?
             WHERE id = ?'
        );
        $stmt->execute([
            mb_substr($nombre, 0, 120),
            $pabellonId,
            max(1, min(4, (int) ($data['piso'] ?? $current['piso']))),
            max(1, min(120, (int) ($data['cantidad_pcs'] ?? $current['cantidad_pcs']))),
            mb_substr(trim((string) ($data['sistema_operativo'] ?? $current['sistema_operativo'])), 0, 80),
            $wifiId,
            $estado,
            isset($data['pos_x']) ? (float) $data['pos_x'] : (float) $current['pos_x'],
            isset($data['pos_y']) ? (float) $data['pos_y'] : (float) $current['pos_y'],
            isset($data['pos_z']) ? (float) $data['pos_z'] : (float) $current['pos_z'],
            mb_substr(trim((string) ($data['encargado'] ?? $current['encargado'])), 0, 120),
            $id,
        ]);

        Response::json($this->findLabOrFail($id, true));
    }

    public function storeAccount(array $params): void
    {
        $labId = (int) ($params['id'] ?? 0);
        $this->findLabOrFail($labId);
        $data = Response::body();

        $usuario = trim((string) ($data['usuario'] ?? ''));
        if ($usuario === '' || mb_strlen($usuario) > 80) {
            throw new RuntimeException('El usuario de laboratorio es obligatorio.', 422);
        }

        $rol = (string) ($data['rol_cuenta'] ?? 'estudiante');
        if (!in_array($rol, self::ACCOUNT_ROLES, true)) {
            throw new RuntimeException('Rol de cuenta inválido.', 422);
        }

        $sensible = $rol === 'admin_local' || !empty($data['es_sensible']);
        if ($sensible) {
            TiAuth::requireAuthorized('coordinador_lab');
        }

        $pass = (string) ($data['contrasena'] ?? '');
        $plainStore = $sensible ? '' : mb_substr($pass, 0, 120);
        $cipher = null;
        $iv = null;
        $tag = null;

        if ($sensible) {
            if ($pass === '') {
                throw new RuntimeException('Una cuenta administrativa TI requiere contraseña.', 422);
            }
            $enc = Crypto::encrypt($pass);
            $cipher = $enc['ciphertext'];
            $iv = $enc['iv'];
            $tag = $enc['tag'];
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO cuentas_laboratorio
             (laboratorio_id, usuario, contrasena, rol_cuenta, equipo_rango, es_sensible, clave_cifrada, clave_iv, clave_tag, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $labId,
            $usuario,
            $plainStore,
            $rol,
            mb_substr(trim((string) ($data['equipo_rango'] ?? 'Todas las PCs')) ?: 'Todas las PCs', 0, 60),
            $sensible ? 1 : 0,
            $cipher,
            $iv,
            $tag,
            mb_substr(trim((string) ($data['notas'] ?? '')), 0, 200),
        ]);

        $newId = (int) $pdo->lastInsertId();
        Response::json($this->findAccountFormatted($newId), 201);
    }

    public function updateAccount(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $current = $this->findAccountRawOrFail($id);
        $data = Response::body();

        $usuario = trim((string) ($data['usuario'] ?? $current['usuario']));
        if ($usuario === '') {
            throw new RuntimeException('El usuario de laboratorio es obligatorio.', 422);
        }

        $rol = (string) ($data['rol_cuenta'] ?? $current['rol_cuenta']);
        if (!in_array($rol, self::ACCOUNT_ROLES, true)) {
            throw new RuntimeException('Rol de cuenta inválido.', 422);
        }

        $sensible = $rol === 'admin_local' || (array_key_exists('es_sensible', $data) ? !empty($data['es_sensible']) : ((int) $current['es_sensible'] === 1));
        if ($sensible || (int) $current['es_sensible'] === 1) {
            TiAuth::requireAuthorized('coordinador_lab');
        }

        $plainStore = (string) $current['contrasena'];
        $cipher = $current['clave_cifrada'];
        $iv = $current['clave_iv'];
        $tag = $current['clave_tag'];

        $incomingPass = array_key_exists('contrasena', $data) ? (string) $data['contrasena'] : null;

        if ($sensible) {
            $plainStore = '';
            if ($incomingPass !== null && $incomingPass !== '') {
                $enc = Crypto::encrypt($incomingPass);
                $cipher = $enc['ciphertext'];
                $iv = $enc['iv'];
                $tag = $enc['tag'];
            } elseif ($cipher === null) {
                throw new RuntimeException('Indica la contraseña para proteger esta cuenta TI.', 422);
            }
        } else {
            $cipher = null;
            $iv = null;
            $tag = null;
            if ($incomingPass !== null) {
                $plainStore = mb_substr($incomingPass, 0, 120);
            }
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE cuentas_laboratorio
             SET usuario = ?, contrasena = ?, rol_cuenta = ?, equipo_rango = ?, es_sensible = ?,
                 clave_cifrada = ?, clave_iv = ?, clave_tag = ?, notas = ?
             WHERE id = ?'
        );
        $stmt->execute([
            mb_substr($usuario, 0, 80),
            $plainStore,
            $rol,
            mb_substr(trim((string) ($data['equipo_rango'] ?? $current['equipo_rango'])), 0, 60),
            $sensible ? 1 : 0,
            $cipher,
            $iv,
            $tag,
            mb_substr(trim((string) ($data['notas'] ?? $current['notas'])), 0, 200),
            $id,
        ]);

        Response::json($this->findAccountFormatted($id));
    }

    public function deleteAccount(array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $current = $this->findAccountRawOrFail($id);
        if ((int) $current['es_sensible'] === 1) {
            TiAuth::requireAuthorized('coordinador_lab');
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare('DELETE FROM cuentas_laboratorio WHERE id = ?');
        $stmt->execute([$id]);

        Response::json(['deleted_id' => $id]);
    }

    public function revealAccount(array $params): void
    {
        $user = TiAuth::requireAuthorized('coordinador_lab');
        $id = (int) ($params['id'] ?? 0);
        $acc = $this->findAccountRawOrFail($id);

        $plain = (int) $acc['es_sensible'] === 1
            ? Crypto::decrypt((string) $acc['clave_cifrada'], (string) $acc['clave_iv'], (string) $acc['clave_tag'])
            : (string) $acc['contrasena'];

        TiAuth::logAudit((int) $user['id'], null, 'ver_cuenta_lab', 'Revelada cuenta ' . $acc['usuario'] . ' (Lab ID ' . $acc['laboratorio_id'] . ')');

        Response::json([
            'id'         => (int) $acc['id'],
            'usuario'    => (string) $acc['usuario'],
            'contrasena' => $plain,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function findLabOrFail(int $id, bool $withAccounts = false): array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT l.*, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre, w.ssid AS wifi_ssid
             FROM laboratorios l
             LEFT JOIN pabellones p ON p.id = l.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = l.red_wifi_id
             WHERE l.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Laboratorio no encontrado.', 404);
        }

        $accounts = [];
        if ($withAccounts) {
            $accStmt = $pdo->prepare(
                'SELECT id, laboratorio_id, usuario, contrasena, rol_cuenta, equipo_rango, es_sensible, notas, updated_at
                 FROM cuentas_laboratorio
                 WHERE laboratorio_id = ?
                 ORDER BY FIELD(rol_cuenta, "estudiante", "docente", "invitado", "admin_local"), id ASC'
            );
            $accStmt->execute([$id]);
            foreach ($accStmt->fetchAll() as $a) {
                $sensible = (int) $a['es_sensible'] === 1;
                $accounts[] = [
                    'id'             => (int) $a['id'],
                    'laboratorio_id' => (int) $a['laboratorio_id'],
                    'usuario'        => (string) $a['usuario'],
                    'contrasena'     => $sensible ? null : (string) $a['contrasena'],
                    'rol_cuenta'     => (string) $a['rol_cuenta'],
                    'equipo_rango'   => (string) $a['equipo_rango'],
                    'es_sensible'    => $sensible,
                    'notas'          => (string) $a['notas'],
                    'updated_at'     => (string) $a['updated_at'],
                ];
            }
        }

        return $this->formatLab($row, $accounts);
    }

    /**
     * @param array<string, mixed> $l
     * @param list<array<string, mixed>> $accounts
     * @return array<string, mixed>
     */
    private function formatLab(array $l, array $accounts): array
    {
        return [
            'id'                => (int) $l['id'],
            'numero'            => (int) $l['numero'],
            'codigo'            => (string) $l['codigo'],
            'nombre'            => (string) $l['nombre'],
            'pabellon_id'       => $l['pabellon_id'] !== null ? (int) $l['pabellon_id'] : null,
            'pabellon_codigo'   => $l['pabellon_codigo'] !== null ? (string) $l['pabellon_codigo'] : null,
            'pabellon_nombre'   => $l['pabellon_nombre'] !== null ? (string) $l['pabellon_nombre'] : null,
            'piso'              => (int) $l['piso'],
            'cantidad_pcs'      => (int) $l['cantidad_pcs'],
            'sistema_operativo' => (string) $l['sistema_operativo'],
            'red_wifi_id'       => $l['red_wifi_id'] !== null ? (int) $l['red_wifi_id'] : null,
            'wifi_ssid'         => $l['wifi_ssid'] !== null ? (string) $l['wifi_ssid'] : null,
            'estado'            => (string) $l['estado'],
            'pos_x'             => (float) $l['pos_x'],
            'pos_y'             => (float) $l['pos_y'],
            'pos_z'             => (float) $l['pos_z'],
            'encargado'         => (string) $l['encargado'],
            'cuentas'           => $accounts,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function findAccountRawOrFail(int $id): array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM cuentas_laboratorio WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Cuenta de laboratorio no encontrada.', 404);
        }
        return $row;
    }

    /**
     * @return array<string, mixed>
     */
    private function findAccountFormatted(int $id): array
    {
        $a = $this->findAccountRawOrFail($id);
        $sensible = (int) $a['es_sensible'] === 1;
        return [
            'id'             => (int) $a['id'],
            'laboratorio_id' => (int) $a['laboratorio_id'],
            'usuario'        => (string) $a['usuario'],
            'contrasena'     => $sensible ? null : (string) $a['contrasena'],
            'rol_cuenta'     => (string) $a['rol_cuenta'],
            'equipo_rango'   => (string) $a['equipo_rango'],
            'es_sensible'    => $sensible,
            'notas'          => (string) $a['notas'],
            'updated_at'     => (string) $a['updated_at'],
        ];
    }
}
