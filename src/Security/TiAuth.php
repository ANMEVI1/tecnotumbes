<?php

declare(strict_types=1);

namespace App\Security;

use App\Config\Database;
use App\Config\Env;
use RuntimeException;

final class TiAuth
{
    private const ROLE_WEIGHT = [
        'coordinador_lab' => 1,
        'soporte_ti'      => 2,
        'superadmin_ti'   => 3,
    ];

    public static function ensureSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        ini_set('session.use_strict_mode', '1');
        session_name('tecno_tumbes_ti');
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function current(): ?array
    {
        self::ensureSession();
        $auth = $_SESSION['ti_auth'] ?? null;
        if (!is_array($auth)) {
            return null;
        }

        $expiresAt = (int) ($auth['expires_at'] ?? 0);
        if (time() >= $expiresAt) {
            unset($_SESSION['ti_auth']);
            return null;
        }

        // Verificar que la persona siga activa en base de datos
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT id, dni, nombre_completo, cargo, area, rol_ti, activo FROM personas_autorizadas WHERE id = ? LIMIT 1');
        $stmt->execute([(int) ($auth['id'] ?? 0)]);
        $person = $stmt->fetch();

        if (!$person || (int) $person['activo'] !== 1) {
            unset($_SESSION['ti_auth']);
            return null;
        }

        return [
            'id'              => (int) $person['id'],
            'dni'             => (string) $person['dni'],
            'nombre_completo' => (string) $person['nombre_completo'],
            'cargo'           => (string) $person['cargo'],
            'area'            => (string) $person['area'],
            'rol_ti'          => (string) $person['rol_ti'],
            'expires_at'      => $expiresAt,
            'remaining_sec'   => max(0, $expiresAt - time()),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function authorize(string $dni, string $pin): array
    {
        self::ensureSession();
        $cleanDni = trim($dni);
        if (!preg_match('/^\d{8}$/', $cleanDni)) {
            throw new RuntimeException('El DNI debe tener exactamente 8 dígitos.', 422);
        }
        if ($pin === '') {
            throw new RuntimeException('Ingresa tu PIN personal TI.', 422);
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT id, dni, nombre_completo, cargo, area, rol_ti, pin_hash, activo FROM personas_autorizadas WHERE dni = ? LIMIT 1');
        $stmt->execute([$cleanDni]);
        $person = $stmt->fetch();

        if (!$person || !password_verify($pin, (string) $person['pin_hash'])) {
            self::logAudit($person ? (int) $person['id'] : null, null, 'intento_fallido', 'Intento de acceso TI denegado para DNI ' . $cleanDni);
            throw new RuntimeException('DNI o PIN TI incorrecto.', 401);
        }

        if ((int) $person['activo'] !== 1) {
            self::logAudit((int) $person['id'], null, 'acceso_bloqueado', 'Persona inactiva intentó autorizarse');
            throw new RuntimeException('Esta autorización TI se encuentra desactivada.', 403);
        }

        if (password_needs_rehash((string) $person['pin_hash'], PASSWORD_ARGON2ID)) {
            $newHash = password_hash($pin, PASSWORD_ARGON2ID);
            $updHash = $pdo->prepare('UPDATE personas_autorizadas SET pin_hash = ? WHERE id = ?');
            $updHash->execute([$newHash, (int) $person['id']]);
        }

        $upd = $pdo->prepare('UPDATE personas_autorizadas SET ultimo_acceso = NOW() WHERE id = ?');
        $upd->execute([(int) $person['id']]);

        session_regenerate_id(true);
        $ttl = max(120, Env::getInt('TI_SESSION_TTL', 900));
        $expiresAt = time() + $ttl;

        $_SESSION['ti_auth'] = [
            'id'         => (int) $person['id'],
            'expires_at' => $expiresAt,
        ];

        self::logAudit((int) $person['id'], null, 'autorizar_boveda', 'Acceso autorizado como ' . $person['rol_ti']);

        return [
            'id'              => (int) $person['id'],
            'dni'             => (string) $person['dni'],
            'nombre_completo' => (string) $person['nombre_completo'],
            'cargo'           => (string) $person['cargo'],
            'area'            => (string) $person['area'],
            'rol_ti'          => (string) $person['rol_ti'],
            'expires_at'      => $expiresAt,
            'remaining_sec'   => $ttl,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function requireAuthorized(?string $minRole = null): array
    {
        $user = self::current();
        if ($user === null) {
            throw new RuntimeException('Validación TI requerida para esta operación.', 401);
        }

        if ($minRole !== null) {
            $userRank = self::ROLE_WEIGHT[$user['rol_ti']] ?? 0;
            $reqRank  = self::ROLE_WEIGHT[$minRole] ?? 99;
            if ($userRank < $reqRank) {
                throw new RuntimeException('Nivel TI insuficiente. Se requiere rol ' . $minRole . '.', 403);
            }
        }

        return $user;
    }

    public static function hasMinRole(array $user, string $minRole): bool
    {
        $userRank = self::ROLE_WEIGHT[$user['rol_ti'] ?? ''] ?? 0;
        $reqRank  = self::ROLE_WEIGHT[$minRole] ?? 99;
        return $userRank >= $reqRank;
    }

    public static function lock(): void
    {
        self::ensureSession();
        $current = self::current();
        if ($current !== null) {
            self::logAudit((int) $current['id'], null, 'bloquear_boveda', 'Cierre manual de sesión TI');
        }
        unset($_SESSION['ti_auth']);
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
    }

    public static function logAudit(?int $personaId, ?int $credencialId, string $accion, string $detalle = ''): void
    {
        $pdo = Database::connection();
        $ip = substr((string) ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1'), 0, 45);
        $stmt = $pdo->prepare('INSERT INTO auditoria_ti (persona_id, credencial_id, accion, detalle, ip_origen) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$personaId, $credencialId, substr($accion, 0, 60), substr($detalle, 0, 255), $ip]);
    }
}
