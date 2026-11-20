<?php

declare(strict_types=1);

namespace App\Config;

use RuntimeException;

final class Env
{
    private static bool $loaded = false;

    /** @var array<string, string> */
    private static array $values = [];

    public static function load(?string $path = null): void
    {
        if (self::$loaded) {
            return;
        }

        $envFile = $path ?? dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . '.env';
        if (!is_file($envFile)) {
            throw new RuntimeException('No se encontró el archivo .env del proyecto.');
        }

        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            throw new RuntimeException('No se pudo leer el archivo .env.');
        }

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '' || str_starts_with($trimmed, '#')) {
                continue;
            }
            $pos = strpos($trimmed, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($trimmed, 0, $pos));
            $val = trim(substr($trimmed, $pos + 1));
            if (
                (str_starts_with($val, '"') && str_ends_with($val, '"')) ||
                (str_starts_with($val, "'") && str_ends_with($val, "'"))
            ) {
                $val = substr($val, 1, -1);
            }
            self::$values[$key] = $val;
        }

        self::$loaded = true;
    }

    public static function get(string $key, string $default = ''): string
    {
        self::load();
        return self::$values[$key] ?? $default;
    }

    public static function getInt(string $key, int $default = 0): int
    {
        $val = self::get($key, (string) $default);
        return is_numeric($val) ? (int) $val : $default;
    }
}
