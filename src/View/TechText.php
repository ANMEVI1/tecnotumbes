<?php

declare(strict_types=1);

namespace App\View;

/**
 * Componente reutilizable TechText (Canvas 2D interactivo, Vanilla JS, 0 dependencias de React/Tailwind).
 * Compatible con 1 línea (`text`) o múltiples líneas con paleta independiente (`lines`).
 */
final class TechText
{
    public static function render(array $options = []): string
    {
        $rawLines = $options['lines'] ?? null;
        $lines = null;
        $lineTexts = [];

        if (is_array($rawLines) && $rawLines !== []) {
            $lines = [];
            foreach ($rawLines as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $lineText = (string) ($item['text'] ?? '');
                $entry = ['text' => $lineText];
                if (isset($item['color']) && $item['color'] !== '') {
                    $entry['color'] = (string) $item['color'];
                }
                if (isset($item['accentColor']) && $item['accentColor'] !== '') {
                    $entry['accentColor'] = (string) $item['accentColor'];
                }
                $lines[] = $entry;
                if ($lineText !== '') {
                    $lineTexts[] = $lineText;
                }
            }
            if ($lines === []) {
                $lines = null;
            }
        }

        $text = (string) ($options['text'] ?? 'TECNO · TUMBES');
        $ariaLabel = (string) ($options['ariaLabel'] ?? '');
        if ($ariaLabel === '') {
            $ariaLabel = $lineTexts !== [] ? implode(' — ', $lineTexts) : str_replace("\n", ' ', $text);
        }

        $edgePadding = $options['edgePadding'] ?? null;

        $config = [
            'text' => $text,
            'fontFamily' => (string) ($options['fontFamily'] ?? ''),
            'fontWeight' => (int) ($options['fontWeight'] ?? 600),
            'fontSize' => (float) ($options['fontSize'] ?? 150),
            'letterSpacing' => (float) ($options['letterSpacing'] ?? -0.05),
            'lineHeight' => (float) ($options['lineHeight'] ?? 1.22),
            'edgePadding' => $edgePadding === null || $edgePadding === '' ? null : (float) $edgePadding,
            'color' => (string) ($options['color'] ?? 'currentColor'),
            'accentColor' => (string) ($options['accentColor'] ?? 'currentColor'),
            'align' => (string) ($options['align'] ?? 'center'),
            'reach' => (float) ($options['reach'] ?? 200),
            'softness' => (float) ($options['softness'] ?? 0.7),
            'dashLength' => (float) ($options['dashLength'] ?? 4),
            'dashGap' => (float) ($options['dashGap'] ?? 2),
            'strokeWidth' => (float) ($options['strokeWidth'] ?? 1.5),
            'lineStyle' => (string) ($options['lineStyle'] ?? 'dashed'),
            'reveal' => (string) ($options['reveal'] ?? 'letter'),
            'specks' => (int) ($options['specks'] ?? 15),
            'selection' => (bool) ($options['selection'] ?? true),
            'labels' => (bool) ($options['labels'] ?? true),
            'draggable' => (bool) ($options['draggable'] ?? true),
            'bounce' => (float) ($options['bounce'] ?? 0.4),
            'sweep' => (bool) ($options['sweep'] ?? true),
            'speed' => (float) ($options['speed'] ?? 1),
            'clickKick' => (bool) ($options['clickKick'] ?? true),
            'intro' => (string) ($options['intro'] ?? 'none'),
            'introDuration' => (float) ($options['introDuration'] ?? 2),
            'guides' => (bool) ($options['guides'] ?? false),
        ];

        if ($lines !== null) {
            $config['lines'] = $lines;
        }

        $extraClass = trim((string) ($options['className'] ?? ''));
        $classAttr = $extraClass !== '' ? 'tech-text ' . $extraClass : 'tech-text';
        $style = trim((string) ($options['style'] ?? ''));
        $styleAttr = $style !== '' ? ' style="' . self::esc($style) . '"' : '';

        $json = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            $json = '{}';
        }

        $ariaEsc = self::esc($ariaLabel);
        $jsonEsc = self::esc($json);
        $classEsc = self::esc($classAttr);

        return '<div class="' . $classEsc . '"' . $styleAttr . ' data-tech-text="' . $jsonEsc . '" role="img" aria-label="' . $ariaEsc . '">'
            . '<canvas class="tech-text-canvas"></canvas>'
            . '<span class="sr-only">' . $ariaEsc . '</span>'
            . '</div>';
    }

    private static function esc(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
