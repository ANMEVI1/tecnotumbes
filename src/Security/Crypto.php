<?php

declare(strict_types=1);

namespace App\Security;

use App\Config\Env;
use RuntimeException;

final class Crypto
{
    private const CIPHER = 'aes-256-gcm';
    private const IV_LEN = 12;
    private const TAG_LEN = 16;

    private static function key(): string
    {
        $hex = trim(Env::get('APP_KEY'));
        if (strlen($hex) !== 64 || !ctype_xdigit($hex)) {
            throw new RuntimeException('APP_KEY inválida. Debe tener 64 caracteres hexadecimales.');
        }
        $bin = hex2bin($hex);
        if ($bin === false || strlen($bin) !== 32) {
            throw new RuntimeException('No se pudo decodificar APP_KEY.');
        }
        return $bin;
    }

    /**
     * @return array{ciphertext: string, iv: string, tag: string}
     */
    public static function encrypt(string $plain): array
    {
        $iv = random_bytes(self::IV_LEN);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $plain,
            self::CIPHER,
            self::key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_LEN
        );

        if ($ciphertext === false || strlen($tag) !== self::TAG_LEN) {
            throw new RuntimeException('Error al cifrar credencial con AES-256-GCM.');
        }

        return [
            'ciphertext' => $ciphertext,
            'iv'         => $iv,
            'tag'        => $tag,
        ];
    }

    public static function decrypt(string $ciphertext, string $iv, string $tag): string
    {
        $plain = openssl_decrypt(
            $ciphertext,
            self::CIPHER,
            self::key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($plain === false) {
            throw new RuntimeException('No se pudo descifrar o verificar integridad de la credencial.');
        }

        return $plain;
    }
}
