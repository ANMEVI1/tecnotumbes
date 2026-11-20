<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use App\Config\Database;
use App\Security\Crypto;

$fresh = in_array('--fresh', $argv ?? [], true);
$pdo = Database::connection();

if ($fresh) {
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach ([
        'auditoria_ti',
        'credenciales_ti',
        'personas_autorizadas',
        'oficinas_carreras',
        'cuentas_laboratorio',
        'laboratorios',
        'redes_wifi',
        'pabellones',
    ] as $table) {
        $pdo->exec("TRUNCATE TABLE {$table}");
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
} else {
    $existing = (int) $pdo->query('SELECT COUNT(*) FROM pabellones')->fetchColumn();
    if ($existing > 0) {
        echo "Base de datos db_tecno_tumbes ya contiene datos ({$existing} pabellones). Usa --fresh para reiniciar." . PHP_EOL;
        exit(0);
    }
}

$pdo->beginTransaction();

try {
    // 1. PABELLONES REALES DEL CAMPUS (Av. Tumbes Norte N° 1228)
    $pabellones = [
        ['PAB-ADM', 'Pabellón Administrativo', 'administrativo', 1, -38.5, 0.0, -8.5, 24.0, 4.8, 14.0, 0.0, '#38BDF8', 'plano', 'Dirección, Mesa de Partes y Plaza Cívica'],
        ['PAB-NAR', 'Pabellón Académico Naranja', 'academico', 2, -47.8, 0.0, -28.5, 26.0, 7.8, 14.0, 0.0, '#EA580C', 'plano', 'Aulas Gestión, Contabilidad, Asistencia y Turismo'],
        ['PAB-VER', 'Pabellón Académico Verde', 'laboratorios', 3, -40.3, 0.0, -58.0, 32.0, 11.2, 16.0, 0.0, '#16A34A', 'plano', 'Centro de Cómputo Labs 1-4 y TI'],
        ['PAB-INT', 'Pabellón Interior Salud & Labs', 'academico', 3, -40.3, 0.0, -73.0, 32.0, 11.2, 16.0, 0.0, '#F97316', 'plano', 'Laboratorios 5-6, Enfermería y Lab. Clínico'],
        ['PAB-BIB', 'Biblioteca & Sala Múltiple', 'servicios', 1, -24.0, 0.0, -95.0, 18.0, 4.5, 14.0, 0.0, '#38BDF8', 'plano', 'Zona de lectura y WiFi libre estudiantil'],
        ['PAB-POST', 'Pabellón Posterior Norte', 'academico', 2, -15.2, 0.0, -112.8, 28.0, 7.6, 12.0, 0.0, '#0284C7', 'plano', 'Aulas complementarias y sala docente'],
        ['PAB-AUD', 'Auditorio Institucional', 'auditorio', 1, 40.5, 0.0, -15.0, 26.0, 6.8, 18.0, 0.0, '#EF4444', 'plano', 'Auditorio principal, rampa y eventos'],
        ['PAB-TOR', 'Torre de Escaleras & Mirador', 'infraestructura', 3, 57.5, 0.0, -27.5, 7.0, 15.5, 7.0, 0.0, '#E2E8F0', 'torre', 'Torre vertical de circulación y tanque'],
        ['PAB-TAL1', 'Taller Industrial 1 (Lab Nave 1)', 'taller', 1, 29.0, 0.0, -50.5, 38.0, 7.8, 18.0, 0.0, '#38BDF8', 'escalonado', 'Electrónica Industrial y Mecatrónica Automotriz'],
        ['PAB-TAL2', 'Taller Industrial 2 (Lab Nave 2)', 'taller', 1, 29.0, 0.0, -85.5, 38.0, 7.8, 18.0, 0.0, '#38BDF8', 'escalonado', 'Mecánica de Producción Industrial'],
        ['PAB-TAL3', 'Nave Posterior de Talleres', 'taller', 1, 52.0, 0.0, -68.0, 16.0, 6.8, 26.0, 0.0, '#0EA5E9', 'escalonado', 'Maquinaria pesada y prácticas industriales'],
        ['PAB-DEP', 'Losa Deportiva Multiusos', 'deportivo', 1, -37.0, 0.0, -126.8, 24.0, 1.2, 34.0, 0.0, '#22C55E', 'cancha', 'Campo deportivo y tribuna'],
    ];

    $stmtPab = $pdo->prepare(
        'INSERT INTO pabellones (codigo, nombre, tipo, pisos, pos_x, pos_y, pos_z, ancho, alto, profundidad, rotacion_y, color_acento, forma_techo, descripcion_corta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $pabIds = [];
    foreach ($pabellones as $p) {
        $stmtPab->execute($p);
        $pabIds[$p[0]] = (int) $pdo->lastInsertId();
    }

    // 2. REDES WIFI (LIBRES Y DE LABORATORIOS CON ALCANCE REAL EN METROS)
    $wifis = [
        ['JAQ-PlazaLibre', 'JAQ-Libre2026', 'libre', '2.4 / 5 GHz', 'activa', $pabIds['PAB-ADM'], 1, 'Plaza Cívica Quiñones y Frontis', -15.5, 3.5, -18.0, 36.0, -42, 450, '#22D3EE', 'Acceso libre para estudiantes en ingreso y plaza'],
        ['JAQ-Auditorio-Free', 'Auditorio2026!', 'libre', '2.4 / 5 GHz', 'activa', $pabIds['PAB-AUD'], 1, 'Hall del Auditorio Institucional', 40.5, 4.0, -15.0, 30.0, -45, 400, '#22D3EE', 'Cobertura abierta para charlas y auditorio'],
        ['JAQ-Gestion-P2', 'GestionJAQ26', 'libre', '2.4 / 5 GHz', 'activa', $pabIds['PAB-NAR'], 2, 'Pabellón Naranja Piso 2 (Gestión/Contabilidad)', -47.8, 6.5, -28.5, 26.0, -46, 300, '#38BDF8', 'Uso libre áreas empresariales y turismo'],
        ['JAQ-LabTI-Norte', 'LabTI-2026*', 'laboratorio', '5 GHz', 'activa', $pabIds['PAB-VER'], 2, 'Centro de Cómputo Labs 1-4 (Pabellón U)', -40.3, 6.5, -58.0, 26.0, -38, 860, '#22D3EE', 'Alta velocidad para prácticas en Labs 1, 2, 3 y 4'],
        ['JAQ-APSTI-Dev', 'DevQuiñones26', 'libre', '5 GHz', 'activa', $pabIds['PAB-VER'], 3, 'Oficina y Aulas APSTI Piso 3 (Pabellón U)', -40.3, 10.5, -58.0, 24.0, -44, 600, '#38BDF8', 'Red académica para desarrollo y soporte TI'],
        ['JAQ-Salud-P2', 'SaludJAQ-2026', 'libre', '2.4 / 5 GHz', 'activa', $pabIds['PAB-INT'], 2, 'Pabellón Interior Salud y Labs 5-6', -40.3, 6.5, -73.0, 25.0, -45, 350, '#22D3EE', 'Cobertura Enfermería, Lab. Clínico y Labs 5-6'],
        ['JAQ-Biblioteca-Free', 'BiblioLibre26', 'libre', '2.4 / 5 GHz', 'activa', $pabIds['PAB-BIB'], 1, 'Zona Biblioteca y Pasillo Sur', -24.0, 3.5, -95.0, 34.0, -40, 500, '#22D3EE', 'Zona de estudio, Alameda y Pabellón Fondo'],
        ['JAQ-Talleres-Sur', 'TalleresJAQ26', 'libre', '2.4 GHz', 'activa', $pabIds['PAB-TAL1'], 1, 'Nave Taller Industrial 1 (Lab Nave 1)', 29.0, 5.0, -50.5, 36.0, -47, 300, '#38BDF8', 'Cobertura Electrónica y Mecatrónica Automotriz'],
        ['JAQ-Mecanica-Norte', 'MecProd-2026', 'institucional', '2.4 / 5 GHz', 'mantenimiento', $pabIds['PAB-TAL2'], 1, 'Nave Taller Industrial 2 (Lab Nave 2)', 29.0, 5.0, -85.5, 34.0, -52, 240, '#FF1E56', 'En ajuste de canal para Mecánica de Producción'],
    ];

    $stmtWifi = $pdo->prepare(
        'INSERT INTO redes_wifi (ssid, contrasena, tipo_acceso, banda, estado, pabellon_id, piso, ubicacion_exacta, pos_x, pos_y, pos_z, alcance_metros, potencia_dbm, velocidad_mbps, color_senal, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $wifiIds = [];
    foreach ($wifis as $w) {
        $stmtWifi->execute($w);
        $wifiIds[$w[0]] = (int) $pdo->lastInsertId();
    }

    // 3. 6 LABORATORIOS DE CÓMPUTO REALES
    $labs = [
        [1, 'LAB-01', 'Laboratorio de Cómputo 01 — Fundamentos & Ofimática', $pabIds['PAB-VER'], 1, 28, 'Windows 11 Pro 64-bit', $wifiIds['JAQ-LabTI-Norte'], 'operativo', -46.0, 2.5, -58.0, 'Ing. Carlos Mendoza'],
        [2, 'LAB-02', 'Laboratorio de Cómputo 02 — Programación & Web', $pabIds['PAB-VER'], 2, 30, 'Windows 11 Pro + Ubuntu WSL2', $wifiIds['JAQ-LabTI-Norte'], 'operativo', -35.0, 6.0, -58.0, 'Ing. Karla Jiménez'],
        [3, 'LAB-03', 'Laboratorio de Cómputo 03 — Redes & Infraestructura', $pabIds['PAB-VER'], 2, 24, 'Windows 11 Pro + Cisco Packet Tracer', $wifiIds['JAQ-APSTI-Dev'], 'ocupado', -46.0, 6.0, -62.0, 'Téc. Luis Paredes'],
        [4, 'LAB-04', 'Laboratorio de Cómputo 04 — Base de Datos & Diseño', $pabIds['PAB-VER'], 3, 28, 'Windows 11 Pro + Docker / MySQL', $wifiIds['JAQ-APSTI-Dev'], 'operativo', -35.0, 10.0, -62.0, 'Ing. Marco Távara'],
        [5, 'LAB-05', 'Laboratorio de Cómputo 05 — Gestión Contable & ERP', $pabIds['PAB-INT'], 2, 26, 'Windows 11 Pro + CONCAR / SISCONT', $wifiIds['JAQ-Salud-P2'], 'operativo', -46.0, 6.0, -73.0, 'Lic. Rosa Salazar'],
        [6, 'LAB-06', 'Laboratorio de Cómputo 06 — Simulación & Multiuso', $pabIds['PAB-INT'], 3, 24, 'Windows 11 Pro + AutoCAD / Proteus', $wifiIds['JAQ-Salud-P2'], 'mantenimiento', -35.0, 10.0, -73.0, 'Téc. Luis Paredes'],
    ];

    $stmtLab = $pdo->prepare(
        'INSERT INTO laboratorios (numero, codigo, nombre, pabellon_id, piso, cantidad_pcs, sistema_operativo, red_wifi_id, estado, pos_x, pos_y, pos_z, encargado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $labIds = [];
    foreach ($labs as $l) {
        $stmtLab->execute($l);
        $labIds[$l[1]] = (int) $pdo->lastInsertId();
    }

    // 4. CUENTAS DE USUARIOS DE LOS 6 LABORATORIOS (LIBRES + ADMIN CIFRADO)
    $stmtAcc = $pdo->prepare(
        'INSERT INTO cuentas_laboratorio (laboratorio_id, usuario, contrasena, rol_cuenta, equipo_rango, es_sensible, clave_cifrada, clave_iv, clave_tag, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $labAccountSeeds = [
        'LAB-01' => [
            ['estudiante01', 'JaqLab01*', 'estudiante', 'PC-01 a PC-28', 'Acceso libre para clases en Lab 01'],
            ['docente.lab01', 'DocJaq01#', 'docente', 'PC-Docente', 'Estación principal proyector'],
            ['invitado01', 'Libre2026', 'invitado', 'PC-01 a PC-10', 'Prácticas sin sesión personal'],
            ['admin.lab01', 'Adm!JaqL01#26', 'admin_local', 'PC-01 a PC-28', 'Cuenta soporte TI local', true],
        ],
        'LAB-02' => [
            ['dev.alumno', 'CodeJaq02*', 'estudiante', 'PC-01 a PC-30', 'Entorno PHP, VS Code y Node'],
            ['docente.dev', 'DocDev02#', 'docente', 'PC-Docente', 'Control de aula y servidor local'],
            ['invitado02', 'Libre2026', 'invitado', 'PC-25 a PC-30', 'Pruebas rápidas'],
            ['admin.lab02', 'Adm!JaqL02#26', 'admin_local', 'PC-01 a PC-30', 'Cuenta soporte TI local', true],
        ],
        'LAB-03' => [
            ['net.alumno', 'NetJaq03*', 'estudiante', 'PC-01 a PC-24', 'Acceso laboratorios de redes'],
            ['docente.redes', 'DocNet03#', 'docente', 'PC-Docente', 'Rack y simulación Cisco'],
            ['admin.lab03', 'Adm!JaqL03#26', 'admin_local', 'PC-01 a PC-24', 'Cuenta soporte TI local', true],
        ],
        'LAB-04' => [
            ['bd.alumno', 'DataJaq04*', 'estudiante', 'PC-01 a PC-28', 'Acceso SQL y modelado 3D'],
            ['docente.bd', 'DocData04#', 'docente', 'PC-Docente', 'Estación docente'],
            ['admin.lab04', 'Adm!JaqL04#26', 'admin_local', 'PC-01 a PC-28', 'Cuenta soporte TI local', true],
        ],
        'LAB-05' => [
            ['conta.alumno', 'ErpJaq05*', 'estudiante', 'PC-01 a PC-26', 'Acceso software contable y gestión'],
            ['docente.erp', 'DocErp05#', 'docente', 'PC-Docente', 'Estación docente'],
            ['invitado05', 'Libre2026', 'invitado', 'PC-20 a PC-26', 'Evaluaciones externas'],
            ['admin.lab05', 'Adm!JaqL05#26', 'admin_local', 'PC-01 a PC-26', 'Cuenta soporte TI local', true],
        ],
        'LAB-06' => [
            ['cad.alumno', 'SimJaq06*', 'estudiante', 'PC-01 a PC-24', 'Simulación CAD y electrónica'],
            ['docente.cad', 'DocSim06#', 'docente', 'PC-Docente', 'Estación docente'],
            ['admin.lab06', 'Adm!JaqL06#26', 'admin_local', 'PC-01 a PC-24', 'Cuenta soporte TI local', true],
        ],
    ];

    foreach ($labAccountSeeds as $labCode => $rows) {
        $lid = $labIds[$labCode];
        foreach ($rows as $row) {
            $sensible = $row[5] ?? false;
            if ($sensible) {
                $enc = Crypto::encrypt($row[1]);
                $stmtAcc->execute([$lid, $row[0], '', $row[2], $row[3], 1, $enc['ciphertext'], $enc['iv'], $enc['tag'], $row[4]]);
            } else {
                $stmtAcc->execute([$lid, $row[0], $row[1], $row[2], $row[3], 0, null, null, null, $row[4]]);
            }
        }
    }

    // 5. 10 OFICINAS DE CARRERAS REALES DEL IESTP JOSÉ ABELARDO QUIÑONES
    $carreras = [
        ['APSTI', 'Arquitectura de Plataformas y Servicios de TI', 'Tecnología', 'Ing. Carlos Mendoza R.', $pabIds['PAB-VER'], 3, 'Of. 301', 'Lun-Vie 08:00 - 17:00', $wifiIds['JAQ-APSTI-Dev'], -40.3, 10.0, -56.0, 'abierta'],
        ['ELIND', 'Electrónica Industrial', 'Tecnología', 'Ing. Jorge Preciado V.', $pabIds['PAB-TAL1'], 1, 'Of. T1-02', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Talleres-Sur'], 22.0, 2.5, -46.0, 'abierta'],
        ['MECAU', 'Mecatrónica Automotriz', 'Tecnología', 'Ing. Ricardo Cruz F.', $pabIds['PAB-TAL1'], 1, 'Of. T1-05', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Talleres-Sur'], 36.0, 2.5, -46.0, 'abierta'],
        ['MEPRO', 'Mecánica de Producción Industrial', 'Tecnología', 'Ing. Wilmer Peña G.', $pabIds['PAB-TAL2'], 1, 'Of. T2-01', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Mecanica-Norte'], 29.0, 2.5, -82.0, 'abierta'],
        ['ENFER', 'Enfermería Técnica', 'Salud', 'Lic. Patricia Alemán S.', $pabIds['PAB-INT'], 1, 'Of. S-102', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Salud-P2'], -45.0, 2.5, -70.0, 'abierta'],
        ['LABCL', 'Laboratorio Clínico y Anatomía Patológica', 'Salud', 'Blgo. Martín Oyola C.', $pabIds['PAB-INT'], 1, 'Of. S-105', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Salud-P2'], -35.0, 2.5, -70.0, 'abierta'],
        ['CONTA', 'Contabilidad', 'Gestión', 'CPC. Elena Mogollón T.', $pabIds['PAB-NAR'], 1, 'Of. N-104', 'Lun-Vie 08:00 - 17:00', $wifiIds['JAQ-Gestion-P2'], -47.8, 2.5, -24.0, 'abierta'],
        ['GESTA', 'Gestión Administrativa', 'Gestión', 'Lic. Fernando Ruiz L.', $pabIds['PAB-NAR'], 2, 'Of. N-201', 'Lun-Vie 08:00 - 17:00', $wifiIds['JAQ-Gestion-P2'], -47.8, 6.0, -28.0, 'abierta'],
        ['ASISA', 'Asistencia Administrativa', 'Gestión', 'Lic. Claudia Feijóo N.', $pabIds['PAB-NAR'], 2, 'Of. N-204', 'Lun-Vie 08:00 - 16:30', $wifiIds['JAQ-Gestion-P2'], -47.8, 6.0, -32.0, 'abierta'],
        ['TURIS', 'Guía Oficial de Turismo', 'Gestión', 'Lic. Diana Zárate M.', $pabIds['PAB-ADM'], 1, 'Of. A-106', 'Lun-Vie 08:00 - 16:00', $wifiIds['JAQ-PlazaLibre'], -38.5, 2.5, -6.0, 'abierta'],
    ];

    $stmtCar = $pdo->prepare(
        'INSERT INTO oficinas_carreras (codigo, nombre_carrera, area, coordinador, pabellon_id, piso, numero_oficina, horario, red_wifi_id, pos_x, pos_y, pos_z, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($carreras as $c) {
        $stmtCar->execute($c);
    }

    // 6. PERSONAS AUTORIZADAS PARA VER CONTRASEÑAS TI (PIN HASHEADO CON ARGON2ID)
    $personas = [
        ['45128901', 'Ing. Carlos Mendoza R.', 'Jefe de Unidad de TI', 'TI', 'superadmin_ti', 'TI-2026#Admin'],
        ['72345610', 'Téc. Luis Paredes M.', 'Soporte Redes y Campus', 'TI', 'soporte_ti', 'Redes#2026'],
        ['70981234', 'Lic. Rosa Salazar Q.', 'Coordinadora de Laboratorios', 'Laboratorios', 'coordinador_lab', 'Labs#2026'],
    ];

    $stmtPer = $pdo->prepare(
        'INSERT INTO personas_autorizadas (dni, nombre_completo, cargo, area, rol_ti, pin_hash, activo)
         VALUES (?, ?, ?, ?, ?, ?, 1)'
    );
    $personaIds = [];
    foreach ($personas as $per) {
        $hash = password_hash($per[5], PASSWORD_ARGON2ID);
        $stmtPer->execute([$per[0], $per[1], $per[2], $per[3], $per[4], $hash]);
        $personaIds[$per[0]] = (int) $pdo->lastInsertId();
    }

    // 7. CREDENCIALES TI CIFRADAS EN REPOSO CON AES-256-GCM
    $credenciales = [
        ['Router Core Campus (MikroTik CCR)', 'router_ap', 'MikroTik CCR2004-16G', '192.168.10.1', 'admin_core', 'Mk!JaqCore#2026$', $pabIds['PAB-VER'], null, null, 'superadmin_ti', 'Gateway principal fibra óptica institucional'],
        ['Controlador Central UniFi Campus', 'router_ap', 'UniFi Network Server', '192.168.10.10:8443', 'unifi_jaq', 'Unifi@Quiñones26', $pabIds['PAB-VER'], null, $wifiIds['JAQ-LabTI-Norte'], 'soporte_ti', 'Administra los 9 APs del campus'],
        ['Switch Core Capa 3 — Pabellón Verde', 'switch_red', 'Cisco Catalyst 9200L', '192.168.10.20', 'cisco_ti', 'Sw9200!Jaq#26', $pabIds['PAB-VER'], $labIds['LAB-03'], null, 'soporte_ti', 'Trunk VLANs Labs 1-6 y APs'],
        ['AP Enlace Talleres Industriales', 'router_ap', 'Ubiquiti U6-LR Talleres', '192.168.20.41', 'ubnt_tal', 'TalU6#Jaq2026', $pabIds['PAB-TAL1'], null, $wifiIds['JAQ-Talleres-Sur'], 'soporte_ti', 'Puente inalámbrico zona talleres'],
        ['Servidor Active Directory & DNS', 'servidor', 'Windows Server 2022 DC01', '192.168.10.5', 'JAQ\\ti_admin', 'AdDC01$Quiñones26', $pabIds['PAB-VER'], null, null, 'superadmin_ti', 'Controlador de dominio y políticas de red'],
        ['Firewall Perimetral Campus', 'firewall', 'FortiGate 100F', '192.168.10.254', 'fw_sec', 'Fg100F!Tumbes#26', $pabIds['PAB-ADM'], null, null, 'superadmin_ti', 'Filtrado web y balanceo de enlaces'],
        ['BIOS & Congelador DeepFreeze Labs 1-4', 'admin_lab', 'Estaciones Labs 1-4', 'Labs 1 al 4', 'df_master', 'Freeze!Labs14#26', $pabIds['PAB-VER'], $labIds['LAB-01'], null, 'soporte_ti', 'Descongelar equipos para mantenimiento'],
        ['BIOS & DeepFreeze Labs 5-6', 'admin_lab', 'Estaciones Labs 5-6', 'Labs 5 y 6', 'df_salud', 'Freeze!Labs56#26', $pabIds['PAB-INT'], $labIds['LAB-05'], null, 'soporte_ti', 'Mantenimiento de software contable y CAD'],
    ];

    $stmtCred = $pdo->prepare(
        'INSERT INTO credenciales_ti (titulo, categoria, equipo_objetivo, ip_o_host, usuario_ti, clave_cifrada, clave_iv, clave_tag, pabellon_id, laboratorio_id, red_wifi_id, nivel_acceso, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($credenciales as $cr) {
        $enc = Crypto::encrypt($cr[5]);
        $stmtCred->execute([
            $cr[0], $cr[1], $cr[2], $cr[3], $cr[4],
            $enc['ciphertext'], $enc['iv'], $enc['tag'],
            $cr[6], $cr[7], $cr[8], $cr[9], $cr[10],
        ]);
    }

    // Evento inicial en bitácora
    $stmtAud = $pdo->prepare('INSERT INTO auditoria_ti (persona_id, credencial_id, accion, detalle, ip_origen) VALUES (?, NULL, ?, ?, ?)');
    $stmtAud->execute([$personaIds['45128901'], 'inicializacion_boveda', 'Bóveda TI cifrada con AES-256-GCM y PINs Argon2id', '127.0.0.1']);

    $pdo->commit();
    echo 'Seed de db_tecno_tumbes completado con éxito.' . PHP_EOL;
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Error en seed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
