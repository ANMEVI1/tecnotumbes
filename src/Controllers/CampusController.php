<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Database;
use App\Http\Response;
use App\Security\TiAuth;

final class CampusController
{
    public function index(): void
    {
        $pdo = Database::connection();

        $pabellones = $pdo->query(
            'SELECT id, codigo, nombre, tipo, pisos, pos_x, pos_y, pos_z, ancho, alto, profundidad, rotacion_y, color_acento, forma_techo, descripcion_corta
             FROM pabellones
             ORDER BY id ASC'
        )->fetchAll();

        foreach ($pabellones as &$p) {
            $p['id'] = (int) $p['id'];
            $p['pisos'] = (int) $p['pisos'];
            $p['pos_x'] = (float) $p['pos_x'];
            $p['pos_y'] = (float) $p['pos_y'];
            $p['pos_z'] = (float) $p['pos_z'];
            $p['ancho'] = (float) $p['ancho'];
            $p['alto'] = (float) $p['alto'];
            $p['profundidad'] = (float) $p['profundidad'];
            $p['rotacion_y'] = (float) $p['rotacion_y'];
        }
        unset($p);

        $wifis = $pdo->query(
            'SELECT w.id, w.ssid, w.contrasena, w.tipo_acceso, w.banda, w.estado, w.pabellon_id,
                    p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre,
                    w.piso, w.ubicacion_exacta, w.pos_x, w.pos_y, w.pos_z,
                    w.alcance_metros, w.potencia_dbm, w.velocidad_mbps, w.color_senal, w.notas, w.updated_at
             FROM redes_wifi w
             LEFT JOIN pabellones p ON p.id = w.pabellon_id
             ORDER BY w.tipo_acceso ASC, w.id ASC'
        )->fetchAll();

        foreach ($wifis as &$w) {
            $w['id'] = (int) $w['id'];
            $w['pabellon_id'] = $w['pabellon_id'] !== null ? (int) $w['pabellon_id'] : null;
            $w['piso'] = (int) $w['piso'];
            $w['pos_x'] = (float) $w['pos_x'];
            $w['pos_y'] = (float) $w['pos_y'];
            $w['pos_z'] = (float) $w['pos_z'];
            $w['alcance_metros'] = (float) $w['alcance_metros'];
            $w['potencia_dbm'] = (int) $w['potencia_dbm'];
            $w['velocidad_mbps'] = (int) $w['velocidad_mbps'];
        }
        unset($w);

        $labs = $pdo->query(
            'SELECT l.id, l.numero, l.codigo, l.nombre, l.pabellon_id,
                    p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre,
                    l.piso, l.cantidad_pcs, l.sistema_operativo, l.red_wifi_id,
                    w.ssid AS wifi_ssid, l.estado, l.pos_x, l.pos_y, l.pos_z, l.encargado
             FROM laboratorios l
             LEFT JOIN pabellones p ON p.id = l.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = l.red_wifi_id
             ORDER BY l.numero ASC'
        )->fetchAll();

        $accountsRaw = $pdo->query(
            'SELECT id, laboratorio_id, usuario, contrasena, rol_cuenta, equipo_rango, es_sensible, notas, updated_at
             FROM cuentas_laboratorio
             ORDER BY FIELD(rol_cuenta, "estudiante", "docente", "invitado", "admin_local"), id ASC'
        )->fetchAll();

        $accountsByLab = [];
        foreach ($accountsRaw as $acc) {
            $labId = (int) $acc['laboratorio_id'];
            $sensible = (int) $acc['es_sensible'] === 1;
            $accountsByLab[$labId][] = [
                'id'             => (int) $acc['id'],
                'laboratorio_id' => $labId,
                'usuario'        => (string) $acc['usuario'],
                'contrasena'     => $sensible ? null : (string) $acc['contrasena'],
                'rol_cuenta'     => (string) $acc['rol_cuenta'],
                'equipo_rango'   => (string) $acc['equipo_rango'],
                'es_sensible'    => $sensible,
                'notas'          => (string) $acc['notas'],
                'updated_at'     => (string) $acc['updated_at'],
            ];
        }

        $totalPcs = 0;
        foreach ($labs as &$l) {
            $l['id'] = (int) $l['id'];
            $l['numero'] = (int) $l['numero'];
            $l['pabellon_id'] = $l['pabellon_id'] !== null ? (int) $l['pabellon_id'] : null;
            $l['piso'] = (int) $l['piso'];
            $l['cantidad_pcs'] = (int) $l['cantidad_pcs'];
            $l['red_wifi_id'] = $l['red_wifi_id'] !== null ? (int) $l['red_wifi_id'] : null;
            $l['pos_x'] = (float) $l['pos_x'];
            $l['pos_y'] = (float) $l['pos_y'];
            $l['pos_z'] = (float) $l['pos_z'];
            $l['cuentas'] = $accountsByLab[$l['id']] ?? [];
            $totalPcs += $l['cantidad_pcs'];
        }
        unset($l);

        $carreras = $pdo->query(
            'SELECT o.id, o.codigo, o.nombre_carrera, o.area, o.coordinador, o.pabellon_id,
                    p.codigo AS pabellon_codigo, p.nombre AS pabellon_nombre,
                    o.piso, o.numero_oficina, o.horario, o.red_wifi_id, w.ssid AS wifi_ssid,
                    o.pos_x, o.pos_y, o.pos_z, o.estado
             FROM oficinas_carreras o
             LEFT JOIN pabellones p ON p.id = o.pabellon_id
             LEFT JOIN redes_wifi w ON w.id = o.red_wifi_id
             ORDER BY o.area ASC, o.id ASC'
        )->fetchAll();

        foreach ($carreras as &$c) {
            $c['id'] = (int) $c['id'];
            $c['pabellon_id'] = $c['pabellon_id'] !== null ? (int) $c['pabellon_id'] : null;
            $c['piso'] = (int) $c['piso'];
            $c['red_wifi_id'] = $c['red_wifi_id'] !== null ? (int) $c['red_wifi_id'] : null;
            $c['pos_x'] = (float) $c['pos_x'];
            $c['pos_y'] = (float) $c['pos_y'];
            $c['pos_z'] = (float) $c['pos_z'];
        }
        unset($c);

        $wifiActivos = count(array_filter($wifis, static fn(array $w): bool => $w['estado'] === 'activa'));
        $wifiLibres = count(array_filter($wifis, static fn(array $w): bool => $w['tipo_acceso'] === 'libre'));

        Response::json([
            'institucion' => [
                'nombre'    => 'IESTP Cap. FAP José Abelardo Quiñones',
                'siglas'    => 'TECNO · TUMBES',
                'direccion' => 'Av. Tumbes Norte N° 1228, Tumbes',
            ],
            'pabellones'        => $pabellones,
            'redes_wifi'        => $wifis,
            'laboratorios'      => $labs,
            'oficinas_carreras' => $carreras,
            'ti_status'         => TiAuth::current(),
            'stats'             => [
                'pabellones_total'   => count($pabellones),
                'wifi_total'         => count($wifis),
                'wifi_activos'       => $wifiActivos,
                'wifi_libres'        => $wifiLibres,
                'laboratorios_total' => count($labs),
                'pcs_total'          => $totalPcs,
                'carreras_total'     => count($carreras),
            ],
        ]);
    }
}
