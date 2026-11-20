SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS db_tecno_tumbes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE db_tecno_tumbes;

CREATE TABLE IF NOT EXISTS pabellones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(24) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  pisos TINYINT UNSIGNED NOT NULL DEFAULT 1,
  pos_x DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  pos_y DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  pos_z DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  ancho DECIMAL(7,2) NOT NULL DEFAULT 10.00,
  alto DECIMAL(7,2) NOT NULL DEFAULT 4.00,
  profundidad DECIMAL(7,2) NOT NULL DEFAULT 10.00,
  rotacion_y DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
  color_acento VARCHAR(20) NOT NULL DEFAULT '#38BDF8',
  forma_techo ENUM('plano','escalonado','dos_aguas','torre','cancha') NOT NULL DEFAULT 'plano',
  descripcion_corta VARCHAR(200) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS redes_wifi (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ssid VARCHAR(80) NOT NULL,
  contrasena VARCHAR(120) NOT NULL DEFAULT '',
  tipo_acceso ENUM('libre','laboratorio','institucional') NOT NULL DEFAULT 'libre',
  banda VARCHAR(30) NOT NULL DEFAULT '2.4 / 5 GHz',
  estado ENUM('activa','mantenimiento','inactiva') NOT NULL DEFAULT 'activa',
  pabellon_id INT UNSIGNED NULL,
  piso TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ubicacion_exacta VARCHAR(140) NOT NULL DEFAULT '',
  pos_x DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  pos_y DECIMAL(7,2) NOT NULL DEFAULT 3.20,
  pos_z DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  alcance_metros DECIMAL(6,2) NOT NULL DEFAULT 25.00,
  potencia_dbm SMALLINT NOT NULL DEFAULT -48,
  velocidad_mbps SMALLINT UNSIGNED NOT NULL DEFAULT 300,
  color_senal VARCHAR(20) NOT NULL DEFAULT '#22D3EE',
  notas VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wifi_pabellon FOREIGN KEY (pabellon_id) REFERENCES pabellones(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laboratorios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero TINYINT UNSIGNED NOT NULL UNIQUE,
  codigo VARCHAR(16) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  pabellon_id INT UNSIGNED NULL,
  piso TINYINT UNSIGNED NOT NULL DEFAULT 1,
  cantidad_pcs SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  sistema_operativo VARCHAR(80) NOT NULL DEFAULT 'Windows 11 Pro',
  red_wifi_id INT UNSIGNED NULL,
  estado ENUM('operativo','mantenimiento','ocupado') NOT NULL DEFAULT 'operativo',
  pos_x DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  pos_y DECIMAL(7,2) NOT NULL DEFAULT 1.50,
  pos_z DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  encargado VARCHAR(120) NOT NULL DEFAULT '',
  CONSTRAINT fk_lab_pabellon FOREIGN KEY (pabellon_id) REFERENCES pabellones(id) ON DELETE SET NULL,
  CONSTRAINT fk_lab_wifi FOREIGN KEY (red_wifi_id) REFERENCES redes_wifi(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cuentas_laboratorio (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  laboratorio_id INT UNSIGNED NOT NULL,
  usuario VARCHAR(80) NOT NULL,
  contrasena VARCHAR(120) NOT NULL DEFAULT '',
  rol_cuenta ENUM('estudiante','docente','invitado','admin_local') NOT NULL DEFAULT 'estudiante',
  equipo_rango VARCHAR(60) NOT NULL DEFAULT 'PC-01 a PC-24',
  es_sensible TINYINT(1) NOT NULL DEFAULT 0,
  clave_cifrada VARBINARY(512) NULL,
  clave_iv VARBINARY(16) NULL,
  clave_tag VARBINARY(16) NULL,
  notas VARCHAR(200) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cuenta_lab FOREIGN KEY (laboratorio_id) REFERENCES laboratorios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oficinas_carreras (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(24) NOT NULL UNIQUE,
  nombre_carrera VARCHAR(140) NOT NULL,
  area ENUM('Tecnología','Salud','Gestión') NOT NULL DEFAULT 'Tecnología',
  coordinador VARCHAR(120) NOT NULL DEFAULT '',
  pabellon_id INT UNSIGNED NULL,
  piso TINYINT UNSIGNED NOT NULL DEFAULT 1,
  numero_oficina VARCHAR(40) NOT NULL DEFAULT '',
  horario VARCHAR(80) NOT NULL DEFAULT 'Lun-Vie 08:00 - 16:30',
  red_wifi_id INT UNSIGNED NULL,
  pos_x DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  pos_y DECIMAL(7,2) NOT NULL DEFAULT 1.50,
  pos_z DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  CONSTRAINT fk_ofi_pabellon FOREIGN KEY (pabellon_id) REFERENCES pabellones(id) ON DELETE SET NULL,
  CONSTRAINT fk_ofi_wifi FOREIGN KEY (red_wifi_id) REFERENCES redes_wifi(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personas_autorizadas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dni CHAR(8) NOT NULL UNIQUE,
  nombre_completo VARCHAR(120) NOT NULL,
  cargo VARCHAR(100) NOT NULL,
  area VARCHAR(80) NOT NULL DEFAULT 'TI',
  rol_ti ENUM('superadmin_ti','soporte_ti','coordinador_lab') NOT NULL DEFAULT 'soporte_ti',
  pin_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credenciales_ti (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(120) NOT NULL,
  categoria ENUM('router_ap','switch_red','servidor','admin_lab','firewall','otro') NOT NULL DEFAULT 'router_ap',
  equipo_objetivo VARCHAR(120) NOT NULL,
  ip_o_host VARCHAR(120) NOT NULL DEFAULT '',
  usuario_ti VARCHAR(80) NOT NULL,
  clave_cifrada VARBINARY(512) NOT NULL,
  clave_iv VARBINARY(16) NOT NULL,
  clave_tag VARBINARY(16) NOT NULL,
  pabellon_id INT UNSIGNED NULL,
  laboratorio_id INT UNSIGNED NULL,
  red_wifi_id INT UNSIGNED NULL,
  nivel_acceso ENUM('soporte_ti','superadmin_ti') NOT NULL DEFAULT 'soporte_ti',
  notas VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cred_pabellon FOREIGN KEY (pabellon_id) REFERENCES pabellones(id) ON DELETE SET NULL,
  CONSTRAINT fk_cred_lab FOREIGN KEY (laboratorio_id) REFERENCES laboratorios(id) ON DELETE SET NULL,
  CONSTRAINT fk_cred_wifi FOREIGN KEY (red_wifi_id) REFERENCES redes_wifi(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria_ti (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  persona_id INT UNSIGNED NULL,
  credencial_id INT UNSIGNED NULL,
  accion VARCHAR(60) NOT NULL,
  detalle VARCHAR(255) NOT NULL DEFAULT '',
  ip_origen VARCHAR(45) NOT NULL DEFAULT '127.0.0.1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aud_persona FOREIGN KEY (persona_id) REFERENCES personas_autorizadas(id) ON DELETE SET NULL,
  CONSTRAINT fk_aud_cred FOREIGN KEY (credencial_id) REFERENCES credenciales_ti(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
