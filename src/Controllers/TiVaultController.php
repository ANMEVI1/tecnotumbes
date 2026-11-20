<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Database;
use App\Http\Response;
use App\Security\Crypto;
use App\Security\TiAuth;
use RuntimeException;

final class TiVaultController
{
    private const ALLOWED_CATS = ['router_ap', 'switch_red', 'servidor', 'admin_lab', 'firewall', 'otro'];
    private const ALLOWED_LEVELS = ['soporte_ti', 'superadmin_ti'];
    private const ALLOWED_ROLES = ['superadmin_ti', 'soporte_ti', 'coordinador_lab'];

    public function status(): void
    {
        Response::json([
            'authorized' => TiAuth::current() !== null,
            'persona'    => TiAuth::current(),
        ]);
    }

    public function authorize(): void
    {
        $data = Response::body();
        $dni = (string) ($data['dni'] ?? '');
        $pin = (string) ($data['pin'] ?? '');
        $persona = TiAuth::authorize($dni, $pin);

        Response::json([
            'authorized' => true,
            'persona'    => $persona,
        ]);
    }

    public function lock(): void
    {
        TiAuth::lock();
        Response::json([
            'authorized' => false,
            'persona'    => null,
        ]);
    }

    public function listCredentials(): void
    {
        $user = TiAuth::current();
        $rows = Database::connection()->query(
            'SELECT c.id, c.titulo, c.categoria, c.equipo_objetivo, c.ip_o_host, c.usuario_ti,
                    c.pabellon_id, p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre,
                    c.laboratorio_id, l.codigo AS laboratorio_codigo,
                    c.red_wifi_id, w.ssid AS wifi_ssid,
                    c.nivel_acceso, c.notas, c.updated_at
             FROM credenciales_ti c
             LEFT JOIN pabellones p ON p.id = c.pabellon_id
             LEFT JOIN laboratorios l ON l.id = c.laboratorio_id
             LEFT JOIN redes_wifi w ON w.id = c.red_wifi_id
             ORDER BY c.id ASC'
        )->fetchAll();

        $isAuth = $user !== null;
        $result = [];

        foreach ($rows as $r) {
            $nivel = (string) $r['nivel_acceso'];
            $canReveal = $isAuth && TiAuth::hasMinRole($user, $nivel);
            $result[] = [
                'id'                 => (int) $r['id'],
                'titulo'             => (string) $r['titulo'],
                'categoria'          => (string) $r['categoria'],
                'equipo_objetivo'    => (string) $r['equipo_objetivo'],
                'ip_o_host'          => $isAuth ? (string) $r['ip_o_host'] : '•••.•••.•••.•••',
                'usuario_ti'         => $isAuth ? (string) $r['usuario_ti'] : '••••••',
                'clave_mascara'      => '••••••••••••',
                'pabellon_id'        => $r['pabellon_id'] !== null ? (int) $r['pabellon_id'] : null,
                'pabellon_codigo'    => $r['pabellon_codigo'] !== null ? (string) $r['pabellon_codigo'] : null,
                'pabellon_nombre'    => $r['pabellon_nombre'] !== null ? (string) $r['pabellon_nombre'] : null,
                'laboratorio_id'     => $r['laboratorio_id'] !== null ? (int) $r['laboratorio_id'] : null,
                'laboratorio_codigo' => $r['laboratorio_codigo'] !== null ? (string) $r['laboratorio_codigo'] : null,
                'red_wifi_id'        => $r['red_wifi_id'] !== null ? (int) $r['red_wifi_id'] : null,
                'wifi_ssid'          => $r['wifi_ssid'] !== null ? (string) $r['wifi_ssid'] : null,
                'nivel_acceso'       => $nivel,
                'notas'              => $isAuth ? (string) $r['notas'] : 'Requiere autorización TI activa',
                'puede_revelar'      => $canReveal,
                'updated_at'         => (string) $r['updated_at'],
            ];
        }

        Response::json([
            'authorized' => $isAuth,
            'persona'    => $user,
            'items'      => $result,
        ]);
    }

    public function revealCredential(array $params): void
    {
        $user = TiAuth::requireAuthorized();
        $id = (int) ($params['id'] ?? 0);

        $stmt = Database::connection()->prepare('SELECT * FROM credenciales_ti WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Credencial TI no encontrada.', 404);
        }

        $nivel = (string) $row['nivel_acceso'];
        if (!TiAuth::hasMinRole($user, $nivel)) {
            TiAuth::logAudit((int) $user['id'], $id, 'revelar_denegado', 'Nivel insuficiente para ' . $row['titulo']);
            throw new RuntimeException('Se requiere rol ' . $nivel . ' para revelar esta clave.', 403);
        }

        $plain = Crypto::decrypt((string) $row['clave_cifrada'], (string) $row['clave_iv'], (string) $row['clave_tag']);
        TiAuth::logAudit((int) $user['id'], $id, 'ver_clave', 'Visualizó clave TI: ' . $row['titulo']);

        Response::json([
            'id'         => $id,
            'usuario_ti' => (string) $row['usuario_ti'],
            'ip_o_host'  => (string) $row['ip_o_host'],
            'clave'      => $plain,
        ]);
    }

    public function storeCredential(): void
    {
        $user = TiAuth::requireAuthorized('soporte_ti');
        $data = Response::body();
        $clean = $this->validateCredential($data, true);

        if ($clean['nivel_acceso'] === 'superadmin_ti' && !TiAuth::hasMinRole($user, 'superadmin_ti')) {
            throw new RuntimeException('Solo Superadmin TI puede crear credenciales de nivel superadmin_ti.', 403);
        }

        $enc = Crypto::encrypt($clean['clave']);
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO credenciales_ti
             (titulo, categoria, equipo_objetivo, ip_o_host, usuario_ti, clave_cifrada, clave_iv, clave_tag, pabellon_id, laboratorio_id, red_wifi_id, nivel_acceso, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $clean['titulo'],
            $clean['categoria'],
            $clean['equipo_objetivo'],
            $clean['ip_o_host'],
            $clean['usuario_ti'],
            $enc['ciphertext'],
            $enc['iv'],
            $enc['tag'],
            $clean['pabellon_id'],
            $clean['laboratorio_id'],
            $clean['red_wifi_id'],
            $clean['nivel_acceso'],
            $clean['notas'],
        ]);

        $newId = (int) $pdo->lastInsertId();
        TiAuth::logAudit((int) $user['id'], $newId, 'crear_credencial', 'Registró credencial TI: ' . $clean['titulo']);
        Response::json(['id' => $newId], 201);
    }

    public function updateCredential(array $params): void
    {
        $user = TiAuth::requireAuthorized('soporte_ti');
        $id = (int) ($params['id'] ?? 0);

        $pdo = Database::connection();
        $curStmt = $pdo->prepare('SELECT * FROM credenciales_ti WHERE id = ? LIMIT 1');
        $curStmt->execute([$id]);
        $current = $curStmt->fetch();
        if (!$current) {
            throw new RuntimeException('Credencial TI no encontrada.', 404);
        }

        if (!TiAuth::hasMinRole($user, (string) $current['nivel_acceso'])) {
            throw new RuntimeException('No tienes permisos para editar esta credencial.', 403);
        }

        $data = Response::body();
        $clean = $this->validateCredential(array_merge([
            'titulo'          => $current['titulo'],
            'categoria'       => $current['categoria'],
            'equipo_objetivo' => $current['equipo_objetivo'],
            'ip_o_host'       => $current['ip_o_host'],
            'usuario_ti'      => $current['usuario_ti'],
            'pabellon_id'     => $current['pabellon_id'],
            'laboratorio_id'  => $current['laboratorio_id'],
            'red_wifi_id'     => $current['red_wifi_id'],
            'nivel_acceso'    => $current['nivel_acceso'],
            'notas'           => $current['notas'],
        ], $data), false);

        if ($clean['nivel_acceso'] === 'superadmin_ti' && !TiAuth::hasMinRole($user, 'superadmin_ti')) {
            throw new RuntimeException('Solo Superadmin TI puede asignar nivel superadmin_ti.', 403);
        }

        $cipher = $current['clave_cifrada'];
        $iv = $current['clave_iv'];
        $tag = $current['clave_tag'];
        if ($clean['clave'] !== '') {
            $enc = Crypto::encrypt($clean['clave']);
            $cipher = $enc['ciphertext'];
            $iv = $enc['iv'];
            $tag = $enc['tag'];
        }

        $stmt = $pdo->prepare(
            'UPDATE credenciales_ti
             SET titulo = ?, categoria = ?, equipo_objetivo = ?, ip_o_host = ?, usuario_ti = ?,
                 clave_cifrada = ?, clave_iv = ?, clave_tag = ?,
                 pabellon_id = ?, laboratorio_id = ?, red_wifi_id = ?, nivel_acceso = ?, notas = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $clean['titulo'],
            $clean['categoria'],
            $clean['equipo_objetivo'],
            $clean['ip_o_host'],
            $clean['usuario_ti'],
            $cipher,
            $iv,
            $tag,
            $clean['pabellon_id'],
            $clean['laboratorio_id'],
            $clean['red_wifi_id'],
            $clean['nivel_acceso'],
            $clean['notas'],
            $id,
        ]);

        TiAuth::logAudit((int) $user['id'], $id, 'editar_credencial', 'Actualizó credencial TI: ' . $clean['titulo']);
        Response::json(['id' => $id]);
    }

    public function deleteCredential(array $params): void
    {
        $user = TiAuth::requireAuthorized('soporte_ti');
        $id = (int) ($params['id'] ?? 0);
        $pdo = Database::connection();

        $curStmt = $pdo->prepare('SELECT id, titulo, nivel_acceso FROM credenciales_ti WHERE id = ? LIMIT 1');
        $curStmt->execute([$id]);
        $current = $curStmt->fetch();
        if (!$current) {
            throw new RuntimeException('Credencial TI no encontrada.', 404);
        }
        if (!TiAuth::hasMinRole($user, (string) $current['nivel_acceso'])) {
            throw new RuntimeException('No tienes permisos para eliminar esta credencial.', 403);
        }

        TiAuth::logAudit((int) $user['id'], null, 'eliminar_credencial', 'Eliminó credencial TI: ' . $current['titulo']);
        $del = $pdo->prepare('DELETE FROM credenciales_ti WHERE id = ?');
        $del->execute([$id]);

        Response::json(['deleted_id' => $id]);
    }

    public function listAuthorized(): void
    {
        TiAuth::requireAuthorized('superadmin_ti');
        $rows = Database::connection()->query(
            'SELECT id, dni, nombre_completo, cargo, area, rol_ti, activo, ultimo_acceso, created_at
             FROM personas_autorizadas
             ORDER BY id ASC'
        )->fetchAll();

        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['activo'] = (int) $r['activo'] === 1;
        }
        unset($r);

        Response::json($rows);
    }

    public function storeAuthorized(): void
    {
        $user = TiAuth::requireAuthorized('superadmin_ti');
        $data = Response::body();

        $dni = trim((string) ($data['dni'] ?? ''));
        if (!preg_match('/^\d{8}$/', $dni)) {
            throw new RuntimeException('El DNI debe tener 8 dígitos numéricos.', 422);
        }
        $nombre = trim((string) ($data['nombre_completo'] ?? ''));
        $cargo = trim((string) ($data['cargo'] ?? ''));
        $area = trim((string) ($data['area'] ?? 'TI')) ?: 'TI';
        $rol = (string) ($data['rol_ti'] ?? 'soporte_ti');
        $pin = (string) ($data['pin'] ?? '');

        if ($nombre === '' || $cargo === '') {
            throw new RuntimeException('Nombre completo y cargo son obligatorios.', 422);
        }
        if (!in_array($rol, self::ALLOWED_ROLES, true)) {
            throw new RuntimeException('Rol TI inválido.', 422);
        }
        if (mb_strlen($pin) < 6) {
            throw new RuntimeException('El PIN personal debe tener al menos 6 caracteres.', 422);
        }

        $pdo = Database::connection();
        $dup = $pdo->prepare('SELECT id FROM personas_autorizadas WHERE dni = ? LIMIT 1');
        $dup->execute([$dni]);
        if ($dup->fetch()) {
            throw new RuntimeException('Ese DNI ya está registrado como personal autorizado.', 422);
        }

        $pinHash = password_hash($pin, PASSWORD_ARGON2ID);
        $stmt = $pdo->prepare(
            'INSERT INTO personas_autorizadas (dni, nombre_completo, cargo, area, rol_ti, pin_hash, activo)
             VALUES (?, ?, ?, ?, ?, ?, 1)'
        );
        $stmt->execute([$dni, mb_substr($nombre, 0, 120), mb_substr($cargo, 0, 100), mb_substr($area, 0, 80), $rol, $pinHash]);

        $newId = (int) $pdo->lastInsertId();
        TiAuth::logAudit((int) $user['id'], null, 'alta_personal_ti', 'Autorizó a ' . $nombre . ' (DNI ' . $dni . ', ' . $rol . ')');
        Response::json(['id' => $newId], 201);
    }

    public function toggleAuthorized(array $params): void
    {
        $user = TiAuth::requireAuthorized('superadmin_ti');
        $id = (int) ($params['id'] ?? 0);
        if ($id === (int) $user['id']) {
            throw new RuntimeException('No puedes desactivar tu propia autorización mientras estás activo.', 422);
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT id, nombre_completo, activo FROM personas_autorizadas WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new RuntimeException('Persona autorizada no encontrada.', 404);
        }

        $data = Response::body();
        $nextActive = array_key_exists('activo', $data) ? ((bool) $data['activo'] ? 1 : 0) : ((int) $row['activo'] === 1 ? 0 : 1);

        $upd = $pdo->prepare('UPDATE personas_autorizadas SET activo = ? WHERE id = ?');
        $upd->execute([$nextActive, $id]);

        TiAuth::logAudit((int) $user['id'], null, 'estado_personal_ti', $row['nombre_completo'] . ' -> ' . ($nextActive === 1 ? 'activo' : 'inactivo'));
        Response::json(['id' => $id, 'activo' => $nextActive === 1]);
    }

    public function listAudit(): void
    {
        TiAuth::requireAuthorized();
        $rows = Database::connection()->query(
            'SELECT a.id, a.accion, a.detalle, a.ip_origen, a.created_at,
                    p.nombre_completo AS persona_nombre, p.dni AS persona_dni,
                    c.titulo AS credencial_titulo
             FROM auditoria_ti a
             LEFT JOIN personas_autorizadas p ON p.id = a.persona_id
             LEFT JOIN credenciales_ti c ON c.id = a.credencial_id
             ORDER BY a.id DESC
             LIMIT 50'
        )->fetchAll();

        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
        }
        unset($r);

        Response::json($rows);
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function validateCredential(array $data, bool $requirePassword): array
    {
        $titulo = trim((string) ($data['titulo'] ?? ''));
        $equipo = trim((string) ($data['equipo_objetivo'] ?? ''));
        $usuario = trim((string) ($data['usuario_ti'] ?? ''));
        $clave = (string) ($data['clave'] ?? '');
        $cat = (string) ($data['categoria'] ?? 'router_ap');
        $nivel = (string) ($data['nivel_acceso'] ?? 'soporte_ti');

        if ($titulo === '' || $equipo === '' || $usuario === '') {
            throw new RuntimeException('Título, equipo objetivo y usuario TI son obligatorios.', 422);
        }
        if ($requirePassword && $clave === '') {
            throw new RuntimeException('La contraseña TI es obligatoria.', 422);
        }
        if (!in_array($cat, self::ALLOWED_CATS, true)) {
            throw new RuntimeException('Categoría TI inválida.', 422);
        }
        if (!in_array($nivel, self::ALLOWED_LEVELS, true)) {
            throw new RuntimeException('Nivel de acceso inválido.', 422);
        }

        return [
            'titulo'          => mb_substr($titulo, 0, 120),
            'categoria'       => $cat,
            'equipo_objetivo' => mb_substr($equipo, 0, 120),
            'ip_o_host'       => mb_substr(trim((string) ($data['ip_o_host'] ?? '')), 0, 120),
            'usuario_ti'      => mb_substr($usuario, 0, 80),
            'clave'           => $clave,
            'pabellon_id'     => !empty($data['pabellon_id']) ? (int) $data['pabellon_id'] : null,
            'laboratorio_id'  => !empty($data['laboratorio_id']) ? (int) $data['laboratorio_id'] : null,
            'red_wifi_id'     => !empty($data['red_wifi_id']) ? (int) $data['red_wifi_id'] : null,
            'nivel_acceso'    => $nivel,
            'notas'           => mb_substr(trim((string) ($data['notas'] ?? '')), 0, 255),
        ];
    }
}
